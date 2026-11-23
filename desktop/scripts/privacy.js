// Проверка приватности сборки: в приложении нет путей с личным (data/, data.js, docs/, tests/, CLAUDE.md, .git)
// и нет ни одного значения из data/secrets (токены, секреты), кроме ключей приложений FatSecret и Whoop.
const fs = require('node:fs');
const path = require('node:path');

// дата или метка времени (2026-11-21, …T09:00:00Z) — не секрет, а такие же даты есть в CHANGELOG.md
const DATE = /^\d{4}-\d{2}-\d{2}([T ]\d{2}:\d{2}(:\d{2}(\.\d+)?)?)?(Z|[+-]\d{2}:?\d{2})?$/;

/** Строки длиной ≥ 8 из data/secrets/*.json (вглубь), кроме полей ключей приложений (appFields: {сервис: [поля]}) и дат. */
function secretValues(secretsDir, appFields) {
  const out = new Set();
  const walk = (v, skip) => {
    if (v == null) return;
    if (typeof v === 'object') { for (const [k, x] of Object.entries(v)) if (!skip.includes(k)) walk(x, []); return; }
    const s = String(v);
    if (s.length >= 8 && !DATE.test(s)) out.add(s);
  };
  for (const f of fs.readdirSync(secretsDir)) {
    if (!f.endsWith('.json')) continue;
    const svc = f.replace(/(_app)?\.json$/, '');
    if (f.endsWith('_app.json')) continue;                          // только ключ приложения — он и должен быть внутри
    let j;
    try { j = JSON.parse(fs.readFileSync(path.join(secretsDir, f), 'utf8')); } catch (e) { continue; }
    walk(j, appFields[svc] || []);
  }
  return [...out];
}

function files(dir, base = dir) {
  const out = [];
  for (const d of fs.readdirSync(dir, {withFileTypes: true})) {
    const p = path.join(dir, d.name);
    if (d.isDirectory()) out.push(...files(p, base)); else out.push(path.relative(base, p).split(path.sep).join('/'));
  }
  return out;
}

const PERSONAL = rel => /(^|\/)(data|docs|tests|\.git)\//.test(rel) || /(^|\/)(CLAUDE\.md|data\.js)$/.test(rel);

/** Бросает, если в папке приложения есть личное. */
function check(appDir, values) {
  for (const rel of files(appDir)) {
    if (PERSONAL(rel)) throw new Error(`Сборка: личное внутри приложения — ${rel}`);
    const buf = fs.readFileSync(path.join(appDir, rel));
    for (const v of values)
      if (buf.includes(v)) throw new Error(`Сборка: секрет внутри приложения — ${rel}: ${v.slice(0, 4)}…`);
  }
}

/** Секреты всей папки данных: корневой secrets/ и secrets/ каждого профиля (с 2.0 токены людей — в profiles/<id>/secrets). */
function dataSecretValues(root, appFields) {
  if (!root) return [];
  const {list, dir} = require('../profiles');
  const dirs = [path.join(root, 'secrets'), ...list(root).map(p => path.join(dir(root, p.id), 'secrets'))];
  return [...new Set(dirs.filter(d => fs.existsSync(d)).flatMap(d => secretValues(d, appFields)))];
}

module.exports = {secretValues, dataSecretValues, check, files};
