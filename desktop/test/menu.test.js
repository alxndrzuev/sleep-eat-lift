// Меню по-русски: на Mac — как было, на Windows — без пунктов Mac, с «Выходом», «О программе» в «Справке», назад/вперёд — Alt+←/→.
const test = require('node:test');
const assert = require('node:assert');
const {template} = require('../menu');

const make = (platform, packaged = true, calls = []) =>
  template({platform, packaged, go: d => calls.push(d), whatsNew: () => calls.push('whatsnew')});
const labels = t => t.map(m => m.label);
const roles = t => t.flatMap(m => m.submenu.map(x => x.role).filter(Boolean));
const item = (t, menu, label) => t.find(m => m.label === menu).submenu.find(x => x.label === label);

test('Mac: меню программы, «Окно», ⌘[ / ⌘]', () => {
  const t = make('darwin');
  assert.deepStrictEqual(labels(t), ['Здоровье', 'Файл', 'Правка', 'Вид', 'Окно', 'Справка']);
  for (const r of ['about', 'services', 'hide', 'quit', 'front', 'pasteAndMatchStyle']) assert.ok(roles(t).includes(r), r);
  assert.strictEqual(item(t, 'Вид', 'Назад').accelerator, 'Cmd+[');
  assert.strictEqual(item(t, 'Правка', 'Скопировать').role, 'copy');
});

test('Windows: без пунктов Mac, «Выход» в «Файле», «О программе» в «Справке», Alt+← / Alt+→', () => {
  const t = make('win32');
  assert.deepStrictEqual(labels(t), ['Файл', 'Правка', 'Вид', 'Справка']);
  for (const r of ['services', 'hide', 'hideOthers', 'unhide', 'front', 'zoom', 'pasteAndMatchStyle'])
    assert.ok(!roles(t).includes(r), r);
  assert.strictEqual(item(t, 'Файл', 'Выход').role, 'quit');
  assert.strictEqual(item(t, 'Справка', 'О программе «Здоровье»').role, 'about');
  assert.strictEqual(item(t, 'Вид', 'Назад').accelerator, 'Alt+Left');
  assert.strictEqual(item(t, 'Вид', 'Вперёд').accelerator, 'Alt+Right');
  assert.strictEqual(item(t, 'Правка', 'Копировать').role, 'copy');
});

test('пункты вызывают назад/вперёд и «Что нового»; инструменты разработчика — только не в сборке', () => {
  for (const p of ['darwin', 'win32']) {
    const calls = [], t = make(p, true, calls);
    item(t, 'Вид', 'Назад').click(); item(t, 'Вид', 'Вперёд').click(); item(t, 'Справка', 'Что нового в «Здоровье»').click();
    assert.deepStrictEqual(calls, ['goBack', 'goForward', 'whatsnew']);
    assert.ok(!roles(t).includes('toggleDevTools'));
    assert.ok(roles(make(p, false)).includes('toggleDevTools'));
  }
});
