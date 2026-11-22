// После сборки: zip (Mac) и portable .exe (Windows) из папки сборки (вне «Документов» — там macOS вешает на файлы атрибуты,
// и codesign падает) → dist/<версия>/ вместе с release-notes.md; проверочная сборка (есть «Не выпущено») → dist/dev/ (scripts/dist.js).
// HEALTH_BUILD_DIR / HEALTH_DIST_DIR — другие папки (тесты).
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const dist = require('./dist');

const HERE = path.join(__dirname, '..');
const OUT = process.env.HEALTH_BUILD_DIR || path.join(os.homedir(), 'Library', 'Caches', 'sleep-eat-lift-build');
const DIST = process.env.HEALTH_DIST_DIR || path.join(HERE, '..', 'dist');
const VERSION = require('../package.json').version;
const t = dist.target(fs.readFileSync(path.join(HERE, 'CHANGELOG.md'), 'utf8'), VERSION);
const dir = path.join(DIST, t.folder);

fs.mkdirSync(dir, {recursive: true});
const mine = f => /\.(zip|exe)$/.test(f) && f.includes(`-${VERSION}-`);
if (t.folder === 'dev') {                                    // в dev — только сборки текущей версии
  for (const f of fs.readdirSync(dir)) if (/\.(zip|exe)$/.test(f) && !mine(f)) fs.rmSync(path.join(dir, f));
} else fs.rmSync(path.join(DIST, 'dev'), {recursive: true, force: true});   // выпустили — проверочная сборка больше не нужна
fs.writeFileSync(path.join(dir, dist.NOTES), dist.notes(t));
for (const f of fs.readdirSync(OUT).filter(mine)) {
  fs.copyFileSync(path.join(OUT, f), path.join(dir, f));
  console.log(`→ dist/${t.folder}/${f} (${Math.round(fs.statSync(path.join(dir, f)).size / 1048576)} МБ)`);
}
console.log(`→ dist/${t.folder}/${dist.NOTES}`);
