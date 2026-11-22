// Выпуск версии: npm run release X.Y.Z — заметки из «Не выпущено» (CHANGELOG.md) → под номер с сегодняшней датой,
// версия в package.json и package-lock.json, коммит «Выпуск X.Y.Z» (только эти три файла) и тег vX.Y.Z в локальном git
// (никуда не пушим). Потом — npm run app:mac и dist:win (→ dist/X.Y.Z/). Выпуск — только из чистого репозитория (всё
// закоммичено, новых файлов нет) и после npm test: версия = закоммиченный и проверенный код.
// HEALTH_RELEASE_DIR / HEALTH_TODAY / HEALTH_RELEASE_TEST — другая папка, дата и команда тестов (тесты самого скрипта).
const fs = require('node:fs');
const path = require('node:path');
const {execFileSync, spawnSync} = require('node:child_process');
const cl = require('../changelog');

const HERE = process.env.HEALTH_RELEASE_DIR || path.join(__dirname, '..');
const FILES = ['CHANGELOG.md', 'package.json', 'package-lock.json'];
const fail = msg => { console.error(msg); process.exit(1); };
const git = (...a) => execFileSync('git', a, {cwd: HERE, encoding: 'utf8'}).trim();
const readJson = f => JSON.parse(fs.readFileSync(path.join(HERE, f), 'utf8'));
const writeJson = (f, j) => fs.writeFileSync(path.join(HERE, f), JSON.stringify(j, null, 2) + '\n');

function today() {
  if (process.env.HEALTH_TODAY) return process.env.HEALTH_TODAY;
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Заметки версии простым текстом — для сообщения тега. */
const notes = r => r.sections.map(s => s.title + ':\n' + s.items.map(i => '- ' + i.replace(/\*\*/g, '')).join('\n')).join('\n\n');

const v = process.argv[2];
const pkg = readJson('package.json');
if (!cl.valid(v)) fail('Номер версии — X.Y.Z, например 1.0.0');
if (cl.cmp(v, pkg.version) <= 0) fail(`Версия ${v} должна быть больше текущей ${pkg.version}`);
if (git('tag', '-l', 'v' + v)) fail(`Тег v${v} уже есть`);
let md;
try { md = cl.release(fs.readFileSync(path.join(HERE, 'CHANGELOG.md'), 'utf8'), v, today()); } catch (e) { fail(e.message); }
const dirty = git('status', '--porcelain', '--untracked-files=all');
if (dirty) fail(`В репозитории незакоммиченные изменения — закоммитьте или уберите их, потом выпускайте:\n${dirty}`);
console.log('Тесты перед выпуском…');
const t = spawnSync(process.env.HEALTH_RELEASE_TEST || 'npm test', {cwd: HERE, shell: true, stdio: 'inherit'});
if (t.status !== 0) fail('Тесты не прошли — выпуск отменён');

fs.writeFileSync(path.join(HERE, 'CHANGELOG.md'), md);
pkg.version = v;
writeJson('package.json', pkg);
const lock = readJson('package-lock.json');
lock.version = v;
if (lock.packages && lock.packages['']) lock.packages[''].version = v;
writeJson('package-lock.json', lock);
git('commit', '-q', '-m', `Выпуск ${v}`, '--', ...FILES);
git('tag', '-a', 'v' + v, '-m', `SEL ${v}\n\n${notes(cl.entry(md, v))}`);
console.log(`Выпущена ${v}: коммит «Выпуск ${v}», тег v${v}. Дальше — npm run app:mac и npm run dist:win (→ dist/${v}/)`);
