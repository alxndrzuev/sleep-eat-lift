// «Что нового» на этот запуск: что показать в окне, что запомнить показанным, вся история; черновик — только в разработке.
const test = require('node:test');
const assert = require('node:assert');
const whatsnew = require('../whatsnew');

const MD = `## [Не выпущено]

### Новое
- Черновик

## [1.1.0] — 2026-12-10

### Новое
- Сон

## [1.0.0] — 2026-11-25

### Новое
- Всё

## [0.1.0] — 2026-11-21

### Новое
- Проверка
`;

function run(o) {
  const saved = [];
  const n = whatsnew.create(Object.assign({md: MD, version: '1.1.0', save: v => saved.push(v)}, o));
  return {n, saved, shown: () => n.show().releases.map(r => r.version)};
}

test('update from 0.1.0 (no lastSeen): both versions, newest first; current version saved at once', () => {
  const {n, saved, shown} = run({lastSeen: null, isNew: false});
  assert.deepStrictEqual(shown(), ['1.1.0', '1.0.0']);
  assert.deepStrictEqual(saved, ['1.1.0']);
  assert.strictEqual(n.show().version, '1.1.0');
});

test('window survives page reloads until «Понятно»', () => {
  const {n, shown} = run({lastSeen: '1.0.0', isNew: false});
  assert.deepStrictEqual(shown(), ['1.1.0']);
  assert.deepStrictEqual(shown(), ['1.1.0']);         // страница перезагрузилась после обновления данных
  n.seen();
  assert.deepStrictEqual(shown(), []);
});

test('new user: no window, version remembered', () => {
  const {saved, shown} = run({lastSeen: null, isNew: true});
  assert.deepStrictEqual(shown(), []);
  assert.deepStrictEqual(saved, ['1.1.0']);
});

test('downgrade: no window, lastSeen not lowered', () => {
  const {saved, shown} = run({version: '1.0.0', lastSeen: '1.1.0', isNew: false});
  assert.deepStrictEqual(shown(), []);
  assert.deepStrictEqual(saved, ['1.1.0']);
});

test('no save function (test runs) — nothing written; history — released up to current', () => {
  const n = whatsnew.create({md: MD, version: '1.0.0', lastSeen: '0.1.0', isNew: false, save: null});
  assert.deepStrictEqual(n.history().releases.map(r => r.version), ['1.0.0', '0.1.0']);
  assert.strictEqual(n.history().version, '1.0.0');
});

test('development: draft «Не выпущено» on top of history and of a forced window', () => {
  const n = whatsnew.create({md: MD, version: '1.1.0', lastSeen: '1.0.0', isNew: false, dev: true, save: null});
  assert.deepStrictEqual(n.history().releases.map(r => r.version), ['Не выпущено', '1.1.0', '1.0.0', '0.1.0']);
  assert.deepStrictEqual(n.show().releases.map(r => r.version), ['Не выпущено', '1.1.0']);
  const released = whatsnew.create({md: MD, version: '1.1.0', lastSeen: '1.0.0', isNew: false, save: null});
  assert.deepStrictEqual(released.history().releases.map(r => r.version), ['1.1.0', '1.0.0', '0.1.0']);
});

test('broken or missing changelog — empty, no crash', () => {
  const n = whatsnew.create({md: '', version: '1.0.0', lastSeen: null, isNew: false, save: null});
  assert.deepStrictEqual(n.show(), {version: '1.0.0', releases: []});
  assert.deepStrictEqual(n.history(), {version: '1.0.0', releases: []});
});
