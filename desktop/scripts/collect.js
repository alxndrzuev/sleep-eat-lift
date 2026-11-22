// После сборки: zip из папки сборки (вне «Документов» — там macOS вешает на файлы атрибуты, и codesign падает) → ../dist/.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const OUT = path.join(os.homedir(), 'Library', 'Caches', 'health-app-build');
const DIST = path.join(__dirname, '..', '..', 'dist');
fs.mkdirSync(DIST, {recursive: true});
for (const f of fs.readdirSync(OUT).filter(f => f.endsWith('.zip'))) {
  fs.copyFileSync(path.join(OUT, f), path.join(DIST, f));
  console.log(`→ dist/${f} (${Math.round(fs.statSync(path.join(DIST, f)).size / 1048576)} МБ)`);
}
