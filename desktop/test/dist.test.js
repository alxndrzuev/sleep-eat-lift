// Раскладка dist/ (scripts/dist.js, scripts/collect.js): выпущенная версия — dist/<версия>/ с release-notes.md и сборками;
// пока есть «Не выпущено» — dist/dev/; после выпуска dev удаляется, старые версии не трогаются.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {spawnSync} = require('node:child_process');
const dist = require('../scripts/dist');

const MD = (unreleased) => `# Что нового в SEL

## [Не выпущено]
${unreleased ? '\n### Исправлено\n- Починили график\n' : ''}
## [1.2.0] — 2026-11-23

### Новое
- План в «Настройках»: свободный текст,
  с выбранной даты.

### Удалено
- Талия.

## [1.1.0] — 2026-11-22

### Изменено
- Логотип.
`;

test('released version → its own folder and notes', () => {
  const t = dist.target(MD(false), '1.2.0');
  assert.strictEqual(t.folder, '1.2.0');
  assert.strictEqual(dist.notes(t),
    '# SEL 1.2.0 — 2026-11-23\n\n### Новое\n\n- План в «Настройках»: свободный текст, с выбранной даты.\n\n### Удалено\n\n- Талия.\n');
});

test('unreleased items → dev folder with unreleased notes', () => {
  const t = dist.target(MD(true), '1.2.0');
  assert.strictEqual(t.folder, 'dev');
  assert.match(dist.notes(t), /проверочная сборка[\s\S]*Починили график/);
});

test('no notes for the version → error', () => {
  assert.throws(() => dist.target(MD(false), '9.9.9'), /Нет заметок к версии 9\.9\.9/);
});

test('collect: builds of this version + notes into dist/<version>/, dev removed, old versions kept', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sel-collect-'));
  const build = path.join(root, 'build'), out = path.join(root, 'dist');
  const version = require('../package.json').version;
  const t = dist.target(fs.readFileSync(path.join(__dirname, '..', 'CHANGELOG.md'), 'utf8'), version);
  fs.mkdirSync(build); fs.mkdirSync(path.join(out, 'dev'), {recursive: true}); fs.mkdirSync(path.join(out, '0.0.1'));
  for (const f of [`SEL-${version}-mac-arm64.zip`, `SEL-${version}-win-x64.exe`, `SEL-${version}-mac-arm64.zip.blockmap`, 'SEL-0.0.1-mac-x64.zip'])
    fs.writeFileSync(path.join(build, f), f);
  fs.writeFileSync(path.join(out, 'dev', 'SEL-0.0.1-mac-x64.zip'), 'old dev');
  fs.writeFileSync(path.join(out, '0.0.1', 'SEL-0.0.1-mac-x64.zip'), 'old');
  const r = spawnSync(process.execPath, [path.join(__dirname, '..', 'scripts', 'collect.js')], {encoding: 'utf8',
    env: Object.assign({}, process.env, {HEALTH_BUILD_DIR: build, HEALTH_DIST_DIR: out})});
  assert.strictEqual(r.status, 0, r.stderr);
  assert.deepStrictEqual(fs.readdirSync(path.join(out, t.folder)).sort(),
    [`SEL-${version}-mac-arm64.zip`, `SEL-${version}-win-x64.exe`, dist.NOTES].sort());
  assert.strictEqual(fs.readFileSync(path.join(out, t.folder, dist.NOTES), 'utf8'), dist.notes(t));
  assert.ok(fs.existsSync(path.join(out, '0.0.1', 'SEL-0.0.1-mac-x64.zip')), 'старые версии не трогаем');
  if (t.folder !== 'dev') assert.ok(!fs.existsSync(path.join(out, 'dev')), 'после выпуска dev не нужна');
});
