// Установка сборки (scripts/install.js) во временные папки: старое приложение заменяется целиком сборкой из dist/
// под этот Mac; нет сборки — ошибка, установленное не трогается. Закрытие и запуск окна здесь выключены.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {execFileSync, spawnSync} = require('node:child_process');

const SCRIPT = path.join(__dirname, '..', 'scripts', 'install.js');
const VERSION = require('../package.json').version;
const ARCH = os.arch() === 'arm64' ? 'arm64' : 'x64';

function dirs() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'health-inst-'));
  const dist = path.join(root, 'dist'), apps = path.join(root, 'Applications');
  fs.mkdirSync(dist); fs.mkdirSync(path.join(apps, 'Здоровье.app', 'Contents'), {recursive: true});
  fs.writeFileSync(path.join(apps, 'Здоровье.app', 'Contents', 'old.txt'), 'old');
  const run = () => spawnSync(process.execPath, [SCRIPT], {encoding: 'utf8',
    env: Object.assign({}, process.env, {HEALTH_INSTALL_DIR: apps, HEALTH_DIST_DIR: dist, HEALTH_NO_LAUNCH: '1'})});
  return {root, dist, apps, run};
}

function zipApp(dist, arch, file) {
  const src = fs.mkdtempSync(path.join(os.tmpdir(), 'health-src-'));
  fs.mkdirSync(path.join(src, 'Здоровье.app', 'Contents'), {recursive: true});
  fs.writeFileSync(path.join(src, 'Здоровье.app', 'Contents', file), file);
  execFileSync('ditto', ['-c', '-k', '--keepParent', path.join(src, 'Здоровье.app'),
    path.join(dist, `Здоровье-${VERSION}-mac-${arch}.zip`)]);
}

test('replaces installed app with the build for this Mac', {skip: process.platform !== 'darwin'}, () => {
  const {dist, apps, run} = dirs();
  zipApp(dist, ARCH, 'new.txt');
  zipApp(dist, ARCH === 'arm64' ? 'x64' : 'arm64', 'other_arch.txt');
  const r = run();
  assert.strictEqual(r.status, 0, r.stderr);
  assert.deepStrictEqual(fs.readdirSync(path.join(apps, 'Здоровье.app', 'Contents')), ['new.txt']);
});

test('no build — error, installed app untouched', {skip: process.platform !== 'darwin'}, () => {
  const {apps, run} = dirs();
  const r = run();
  assert.notStrictEqual(r.status, 0);
  assert.match(r.stderr, /npm run dist:mac/);
  assert.ok(fs.existsSync(path.join(apps, 'Здоровье.app', 'Contents', 'old.txt')));
});
