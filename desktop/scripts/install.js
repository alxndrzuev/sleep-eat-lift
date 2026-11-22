// Свежую сборку — в /Applications и открыть для проверки: npm run app:mac (= dist:mac + этот скрипт).
// Запущенное SEL (любая копия, по bundle id — и прежнее «Здоровье») закрывается, старое приложение заменяется сборкой из dist/
// под этот Mac; прежнее «Здоровье.app» (так приложение называлось до SEL) удаляется.
// HEALTH_INSTALL_DIR / HEALTH_DIST_DIR — другие папки, HEALTH_NO_LAUNCH=1 — не закрывать и не открывать (тесты).
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {execFileSync, spawnSync} = require('node:child_process');

const NAME = 'SEL', OLD = 'Здоровье', ID = 'local.health.app';
const DEST = process.env.HEALTH_INSTALL_DIR || '/Applications';
const DIST = process.env.HEALTH_DIST_DIR || path.join(__dirname, '..', '..', 'dist');
const LAUNCH = process.env.HEALTH_NO_LAUNCH !== '1';
const VERSION = require('../package.json').version;
const ZIP = path.join(DIST, `${NAME}-${VERSION}-mac-${os.arch() === 'arm64' ? 'arm64' : 'x64'}.zip`);
const APP = path.join(DEST, NAME + '.app');
const fail = msg => { console.error(msg); process.exit(1); };
const osa = s => spawnSync('osascript', ['-e', s], {encoding: 'utf8'}).stdout.trim();
const running = () => osa(`application id "${ID}" is running`) === 'true';

if (!fs.existsSync(ZIP)) fail(`Нет сборки ${ZIP} — сначала npm run dist:mac`);

if (LAUNCH && running()) {                                   // закрыть старое: вежливо, через 10 с — принудительно
  osa(`tell application id "${ID}" to quit`);
  for (let i = 0; i < 40 && running(); i++) spawnSync('sleep', ['0.25']);
  if (running()) for (const n of [NAME, OLD]) spawnSync('pkill', ['-f', `${n}.app/Contents/MacOS/`]);
  console.log('Старое окно закрыто');
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'health-install-'));
try {
  execFileSync('ditto', ['-x', '-k', ZIP, tmp]);
  if (!fs.existsSync(path.join(tmp, NAME + '.app'))) fail(`В ${path.basename(ZIP)} нет ${NAME}.app`);
  fs.rmSync(APP, {recursive: true, force: true});
  execFileSync('ditto', [path.join(tmp, NAME + '.app'), APP]);
} finally { fs.rmSync(tmp, {recursive: true, force: true}); }
console.log(`Установлено: ${APP} (${VERSION})`);
if (fs.existsSync(path.join(DEST, OLD + '.app'))) {
  fs.rmSync(path.join(DEST, OLD + '.app'), {recursive: true, force: true});
  console.log(`Удалено прежнее ${OLD}.app`);
}

if (LAUNCH) { execFileSync('open', [APP]); console.log('Открыто — проверяйте'); }
