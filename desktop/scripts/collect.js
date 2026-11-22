// После сборки: zip (Mac) и portable .exe (Windows) из папки сборки (вне «Документов» — там macOS вешает на файлы атрибуты, и codesign падает) → ../dist/.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const OUT = path.join(os.homedir(), 'Library', 'Caches', 'health-app-build');
const DIST = path.join(__dirname, '..', '..', 'dist');
const VERSION = require('../package.json').version;         // только текущая версия, старые сборки в папке не трогаем
fs.mkdirSync(DIST, {recursive: true});
for (const f of fs.readdirSync(OUT).filter(f => /\.(zip|exe)$/.test(f) && f.includes(`-${VERSION}-`))) {
  fs.copyFileSync(path.join(OUT, f), path.join(DIST, f));
  console.log(`→ dist/${f} (${Math.round(fs.statSync(path.join(DIST, f)).size / 1048576)} МБ)`);
}
