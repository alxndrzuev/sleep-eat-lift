// portal/nav.js — меню приложения: пункты по данным, знак SEL.
const test = require('node:test');
const assert = require('node:assert');
const {load, J} = require('./_portal');

const js = load('nav.js');
const hrefs = (data, inApp) => js(`Nav.items(${J(data)}, ${J(inApp)}).map(x => x[0])`);

test('all services, outside the app', () => {
  assert.deepStrictEqual(hrefs({nutrition: [1], weight: [], whoop_daily: [1]}, false),
    ['dashboard.html', 'nutrition.html', 'training.html', 'recovery.html', 'photos.html']);
});

test('FatSecret only, in the app', () => {
  assert.deepStrictEqual(hrefs({nutrition: [], weight: [1], whoop_daily: []}, true),
    ['dashboard.html', 'nutrition.html', 'photos.html', 'settings.html']);
});

test('Whoop only, in the app', () => {
  assert.deepStrictEqual(hrefs({nutrition: [], weight: [], whoop_daily: [1]}, true),
    ['dashboard.html', 'training.html', 'recovery.html', 'photos.html', 'settings.html']);
});

test('no data, in the app', () => {
  assert.deepStrictEqual(hrefs({nutrition: [], weight: [], whoop_daily: []}, true), ['dashboard.html', 'photos.html', 'settings.html']);
});

test('SEL mark: three arcs in sleep/eat/lift colours, title for hover and screen reader, not a menu item', () => {
  const mark = js('Nav.MARK');
  assert.strictEqual(mark.split('<circle').length - 1, 3);
  for (const color of ['#7F77DD', '#1D9E75', '#D85A30']) assert.ok(mark.includes(color), color);
  assert.ok(mark.includes('title="SEL — sleep · eat · lift"'));
  assert.ok(!mark.includes('<a'));
  assert.ok(mark.includes('<b class="wm">SEL</b>'), 'word SEL next to the mark');
});

test('SEL logo: mark of the given size, SEL, tagline and optional extra line', () => {
  assert.ok(js('Nav.mark(40)').includes('width="40" height="40"'));
  const logo = js('Nav.logo(44, "версия 1.2.0")');
  assert.ok(logo.includes('width="44"') && logo.includes('>SEL</b>'));
  assert.ok(logo.includes('sleep · eat · lift · версия 1.2.0'));
  assert.ok(js('Nav.logo(44)').includes('sleep · eat · lift</div>'));
});

test('page titles', () => {
  assert.deepStrictEqual(js('[Nav.title("photos.html"), Nav.title("whatsnew.html")]'), ['Фото', null]);
});
