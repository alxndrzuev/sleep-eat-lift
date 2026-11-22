#!/usr/bin/env node
// Проверка перед коммитом в публичный репозиторий: в файлах проекта нет личного из папки данных.
//
// Ищет в каждом файле, который попадёт в git (отслеживаемые и новые, не игнорируемые; кроме portal/vendor — сторонние
// библиотеки с хэшами) — и в рабочей копии, и в версии из индекса git (её заберёт коммит), строки CSV, id тренировок Whoop, значения из secrets/*.json, текст из meta.json и строки личных
// документов data/docs/*.md. Почта автора коммитов — только noreply GitHub.
//
//   node scripts/public_check.js            # код выхода 1 — нашлось личное (что и где; значения секретов не печатаются)
const fs = require('node:fs');
const path = require('node:path');
const {execFileSync} = require('node:child_process');
const {dataDir} = require('./csv');

const ROOT = path.join(__dirname, '..');
const DATE = /^\d{4}-\d{2}-\d{2}([T ][\d:.]+)?(Z|[+-]\d{2}:?\d{2})?$/;
const SKIP = ['portal/vendor/'];

/** Все строки и числа из JSON (вглубь), кроме true/false и null. */
function strings(v, out = []) {
  if (Array.isArray(v)) v.forEach(x => strings(x, out));
  else if (v && typeof v === 'object') Object.values(v).forEach(x => strings(x, out));
  else if (typeof v === 'string' || typeof v === 'number') out.push(String(v));
  return out;
}

const lines = f => fs.readFileSync(f, 'utf8').split(/\r?\n/);
const list = (dir, ext) => fs.existsSync(dir) ? fs.readdirSync(dir).filter(f => f.endsWith(ext)).sort() : [];

/** Map {строка: вид} — что не должно встречаться в публичных файлах. */
function needles(data) {
  const out = new Map();
  for (const f of list(data, '.csv')) {
    const rows = lines(path.join(data, f)).slice(1);
    for (const r of rows) if (r.length >= 25) out.set(r, `строка ${f}`);
    if (f === 'whoop_workouts.csv')
      for (const r of rows) { const id = r.split(',')[0]; if (id.length >= 12) out.set(id, 'id тренировки Whoop'); }
  }
  const sec = path.join(data, 'secrets');
  for (const f of list(sec, '.json')) {
    let j;
    try { j = JSON.parse(fs.readFileSync(path.join(sec, f), 'utf8')); } catch (e) { continue; }
    for (const s of strings(j))
      if (s.length >= 8 && !DATE.test(s) && !s.startsWith('http')) out.set(s, `значение из secrets/${f}`);
  }
  const meta = path.join(data, 'meta.json');
  if (fs.existsSync(meta))
    for (const s of strings(JSON.parse(fs.readFileSync(meta, 'utf8')))) if (s.length >= 30) out.set(s, 'текст из meta.json');
  const docs = path.join(data, 'docs');
  for (const f of list(docs, '.md'))
    for (let line of lines(path.join(docs, f))) {
      line = line.trim();
      if (line.length >= 40 && !line.startsWith('|---') && !line.startsWith('---')) out.set(line, `строка личного документа ${f}`);
    }
  return out;
}

/** Файлы, которые попадут в git: в индексе (даже если в рабочей папке их уже нет) и новые не игнорируемые
 *  (кроме сторонних библиотек). */
function publicFiles(root) {
  const z = a => execFileSync('git', a, {cwd: root}).toString().split('\0').filter(Boolean);
  const staged = new Set(z(['ls-files', '-z', '--cached']));
  return [...new Set([...staged, ...z(['ls-files', '-z', '--others', '--exclude-standard'])])]
    .filter(p => !SKIP.some(s => p.startsWith(s)) && (staged.has(p) || fs.statSync(path.join(root, p), {throwIfNoEntry: false})?.isFile()));
}

/** Что проверять в файле: рабочая копия и версия в индексе git (её и заберёт коммит), если она другая. */
function contents(root, p) {
  const out = [];
  const st = fs.statSync(path.join(root, p), {throwIfNoEntry: false});
  if (st && st.isFile()) out.push(fs.readFileSync(path.join(root, p)));
  try {
    const idx = execFileSync('git', ['show', ':' + p], {cwd: root, stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 1 << 28});
    if (!out.some(b => b.equals(idx))) out.push(idx);
  } catch (e) { /* не в индексе (новый файл) */ }
  return out;
}

/** [[файл, вид]] — что из папки данных нашлось в файлах (в рабочей копии или в индексе). */
function leaks(root, files, data) {
  const ns = [...needles(data)].map(([s, kind]) => [Buffer.from(s), kind]);
  const out = [];
  for (const p of files) {
    const bufs = contents(root, p);
    for (const [n, kind] of ns) if (bufs.some(b => b.includes(n))) out.push([p, kind]);
  }
  return out;
}

/** Ссылки (symlink) в индексе git → пути. Ссылка уносит в публичный репозиторий путь этого компьютера. */
function symlinks(root) {
  return execFileSync('git', ['ls-files', '-s', '-z'], {cwd: root}).toString().split('\0')
    .filter(l => l.startsWith('120000 ')).map(l => l.slice(l.indexOf('\t') + 1));
}

/** Почта для коммитов в этом репозитории — noreply GitHub. */
function authorOk(root) {
  try { return execFileSync('git', ['config', 'user.email'], {cwd: root}).toString().trim().endsWith('@users.noreply.github.com'); }
  catch (e) { return false; }
}

function main() {
  const data = dataDir();
  if (!data || (!fs.existsSync(path.join(data, 'secrets')) && !list(data, '.csv').length)) {
    console.log(`Папка данных не найдена (${data || 'не выбрана в SEL'}) — сверять не с чем`);
    return 0;
  }
  const files = publicFiles(ROOT);
  const found = leaks(ROOT, files, data);
  for (const [p, kind] of found) console.log(`ЛИЧНОЕ: ${p} — ${kind}`);
  for (const p of symlinks(ROOT)) {
    console.log(`ЛИЧНОЕ: ${p} — ссылка в git (путь этого компьютера): git rm --cached ${p}`);
    found.push([p, 'ссылка']);
  }
  if (!authorOk(ROOT)) {
    console.log('ЛИЧНОЕ: почта автора коммитов не noreply GitHub — git config user.email <id>+<логин>@users.noreply.github.com');
    found.push(['git config', 'почта']);
  }
  if (!found.length) console.log(`Чисто: ${files.length} файлов проверено`);
  return found.length ? 1 : 0;
}

if (require.main === module) process.exit(main());

module.exports = {needles, publicFiles, leaks, symlinks, authorOk, ROOT};
