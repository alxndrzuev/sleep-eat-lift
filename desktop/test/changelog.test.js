// Заметки к версиям (CHANGELOG.md): разбор, сравнение версий, что показать после обновления, выпуск.
const test = require('node:test');
const assert = require('node:assert');
const cl = require('../changelog');

const MD = `# Что нового

Шапка — не версия.

## [Не выпущено]

### Новое
- Будущее

## [1.1.0] — 2026-12-10

### Новое
- Страница «Сон»
  с продолжением строки
- Пункт с **жирным**

### Удалено

### Исправлено
- Ошибка

## [1.0.0] — 2026-11-25

### Новое
- Всё основное

## [0.1.0] — 2026-11-21

### Новое
- Проверка
`;

test('parse: versions newest first, continuation lines, empty sections dropped, header ignored', () => {
  const r = cl.parse(MD);
  assert.deepStrictEqual(r.unreleased, [{title: 'Новое', items: ['Будущее']}]);
  assert.deepStrictEqual(r.releases.map(x => [x.version, x.date]), [['1.1.0', '2026-12-10'], ['1.0.0', '2026-11-25'], ['0.1.0', '2026-11-21']]);
  assert.deepStrictEqual(r.releases[0].sections, [
    {title: 'Новое', items: ['Страница «Сон» с продолжением строки', 'Пункт с **жирным**']},
    {title: 'Исправлено', items: ['Ошибка']}]);
});

test('parse: hyphen instead of em dash and CRLF', () => {
  const r = cl.parse('## [1.2.3] - 2026-01-02\r\n\r\n### Новое\r\n- А\r\n');
  assert.deepStrictEqual(r.releases, [{version: '1.2.3', date: '2026-01-02', sections: [{title: 'Новое', items: ['А']}]}]);
  assert.deepStrictEqual(r.unreleased, []);
});

test('cmp and valid', () => {
  assert.strictEqual(cl.cmp('1.10.0', '1.9.9'), 1);
  assert.strictEqual(cl.cmp('1.0.0', '1.0.0'), 0);
  assert.strictEqual(cl.cmp('0.1.0', '1.0.0'), -1);
  assert.ok(cl.valid('1.0.0'));
  for (const v of ['1.0', 'v1.0.0', '1.0.0-beta', '01.0.0', '', null]) assert.ok(!cl.valid(v), String(v));
});

test('history: released versions not newer than current, newest first', () => {
  const {releases} = cl.parse(MD);
  assert.deepStrictEqual(cl.history(releases, '1.0.0').map(r => r.version), ['1.0.0', '0.1.0']);
});

test('toShow: new user — nothing; from 0.1.0 (no lastSeen) — newer versions; skipped versions — all, newest first', () => {
  const {releases} = cl.parse(MD);
  const v = o => cl.toShow(Object.assign({releases}, o)).map(r => r.version);
  assert.deepStrictEqual(v({current: '1.1.0', lastSeen: null, isNew: true}), []);
  assert.deepStrictEqual(v({current: '1.0.0', lastSeen: null, isNew: false}), ['1.0.0']);
  assert.deepStrictEqual(v({current: '1.1.0', lastSeen: '0.1.0', isNew: false}), ['1.1.0', '1.0.0']);
  assert.deepStrictEqual(v({current: '1.1.0', lastSeen: '1.1.0', isNew: false}), []);
});

test('toShow: downgrade shows nothing, lastSeen never goes down', () => {
  const {releases} = cl.parse(MD);
  assert.deepStrictEqual(cl.toShow({releases, current: '1.0.0', lastSeen: '1.1.0', isNew: false}), []);
  assert.strictEqual(cl.seenAfter('1.1.0', '1.0.0'), '1.1.0');
  assert.strictEqual(cl.seenAfter('1.0.0', '1.1.0'), '1.1.0');
  assert.strictEqual(cl.seenAfter(null, '1.0.0'), '1.0.0');
  assert.strictEqual(cl.seenAfter('мусор', '1.0.0'), '1.0.0');
});

test('release: unreleased notes move under the new version, empty «Не выпущено» stays on top', () => {
  const md = cl.release(MD, '1.2.0', '2026-12-20');
  const r = cl.parse(md);
  assert.deepStrictEqual(r.unreleased, []);
  assert.deepStrictEqual(r.releases[0], {version: '1.2.0', date: '2026-12-20', sections: [{title: 'Новое', items: ['Будущее']}]});
  assert.strictEqual(r.releases[1].version, '1.1.0');
  assert.ok(md.indexOf('## [Не выпущено]') < md.indexOf('## [1.2.0] — 2026-12-20'));
  assert.ok(md.startsWith('# Что нового\n\nШапка — не версия.\n'));
});

test('release: errors — bad number, existing version, empty unreleased', () => {
  assert.throws(() => cl.release(MD, '1.2', '2026-12-20'), {message: 'Номер версии — X.Y.Z, например 1.0.0'});
  assert.throws(() => cl.release(MD, '1.1.0', '2026-12-20'), {message: 'Версия 1.1.0 уже есть в CHANGELOG'});
  const empty = cl.release(MD, '1.2.0', '2026-12-20');
  assert.throws(() => cl.release(empty, '1.3.0', '2026-12-21'), {message: 'Раздел «Не выпущено» пуст — нечего выпускать'});
  assert.throws(() => cl.release('# Пусто\n', '1.0.0', '2026-12-21'), {message: 'Раздел «Не выпущено» пуст — нечего выпускать'});
});
