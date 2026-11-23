// portal/nav.js — меню приложения: пункты по данным, знак SEL.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const {load, J, ROOT} = require('./_portal');

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

test('menu brand: three tiles (sleep, eat, lift colours) and the word SEL, title for hover and screen reader, not a menu item', () => {
  const mark = js('Nav.MARK');
  assert.strictEqual(mark.split('width="20" height="20"').length - 1, 3);
  for (const color of ['#7F77DD', '#1D9E75', '#D85A30']) assert.ok(mark.includes(color), color);
  assert.ok(mark.includes('title="SEL — sleep · eat · lift"'));
  assert.ok(mark.includes('<b class="wm">SEL</b>'));
  assert.ok(!mark.includes('<a'));
});

test('square mark: three arcs of the given size', () => {
  const m = js('Nav.mark(40)');
  assert.strictEqual(m.split('<circle').length - 1, 3);
  assert.ok(m.includes('width="40" height="40"'));
});

test('logo: tiles, SEL centred over the tagline and as wide as it; page logo uses theme colours', () => {
  const svg = js('Nav.logoSvg("#000", "#555")');
  const texts = [...svg.matchAll(/<text x="([\d.]+)"[^>]*textLength="(\d+)"[^>]*>([^<]+)</g)].map(m => [m[1], m[2], m[3]]);
  assert.deepStrictEqual(texts.map(t => t[2]), ['SEL', 'sleep · eat · lift']);
  assert.strictEqual(texts[0][0], texts[1][0], 'same centre');
  assert.strictEqual(texts[0][1], texts[1][1], 'same width');
  assert.ok(svg.includes('text-anchor="middle"'));
  const page = js('Nav.logo(48)');
  assert.ok(page.includes('fill:var(--text-primary)') && page.includes('height="48"'));
});

test('docs/logo light and dark files are built from Nav.logoSvg', () => {
  const read = f => fs.readFileSync(path.join(ROOT, 'docs', 'logo', f), 'utf8').trim();
  assert.strictEqual(read('sel-logo-light.svg'), js('Nav.logoSvg("#2C2C2A", "#5F5E5A")'));
  assert.strictEqual(read('sel-logo-dark.svg'), js('Nav.logoSvg("#F1EFE8", "#B4B2A9")'));
});

test('page titles', () => {
  assert.deepStrictEqual(js('[Nav.title("photos.html"), Nav.title("whatsnew.html")]'), ['Фото', null]);
});

test('broken data file: one line for every page, file and line named', () => {
  assert.strictEqual(js('Nav.dataErrors([])'), '');
  assert.strictEqual(js('Nav.dataErrors(undefined)'), '');
  assert.strictEqual(js('Nav.dataErrors(["nutrition_daily.csv, строка 3: «kcal» = «abc» — не число"])'),
    'Не читается файл в папке данных — эти данные не показаны, пока его не поправить: nutrition_daily.csv, строка 3: «kcal» = «abc» — не число');
});

test('profile menu: names escaped, current marked, new and «Профили…» links', () => {
  const h = js(`Nav.profileMenu({list: [{id: 'a', name: '<b>Ив</b>'}, {id: 'b', name: 'Мария'}], current: 'a', locked: null})`);
  assert.ok(h.includes('&lt;b&gt;Ив&lt;/b&gt;'));
  assert.ok(!h.includes('<b>Ив'));
  assert.match(h, /data-prof="a"[^>]*aria-current="true"/);
  assert.ok(!/data-prof="b"[^>]*aria-current/.test(h));
  assert.ok(h.includes('data-prof-new'));
  assert.ok(h.includes('data-prof-manage'));                         // «Профили…» — окно управления, не «Настройки»
  assert.ok(!h.includes('settings.html'));
  assert.ok(!h.includes('disabled'));
});

test('profile menu while locked: items disabled, the reason is shown', () => {
  const h = js(`Nav.profileMenu({list: [{id: 'a', name: 'Ив'}, {id: 'b', name: 'Мария'}], current: 'a', locked: 'Идёт обновление данных'})`);
  assert.ok(h.includes('Идёт обновление данных'));
  assert.match(h, /data-prof="b"[^>]*disabled/);
  assert.match(h, /data-prof-new[^>]*disabled/);
});

test('profile menu closes on a click outside it and on Esc (not only on its own button)', () => {
  const src = require('node:fs').readFileSync(require('node:path').join(ROOT, 'portal', 'nav.js'), 'utf8');
  const bar = src.slice(src.indexOf('function profileBar('), src.indexOf('function footer('));
  assert.match(bar, /addEventListener\("click", e => \{ if \(!box\.contains\(e\.target\)\) close\(\)/);
  assert.match(bar, /e\.key === "Escape"/);
});

test('profile menu refresh keeps its <details> (re-creating or re-opening it fires «toggle» again — an endless redraw)', () => {
  const src = require('node:fs').readFileSync(require('node:path').join(ROOT, 'portal', 'nav.js'), 'utf8');
  const draw = src.slice(src.indexOf('const draw = info =>'), src.indexOf('const refresh ='));
  assert.ok(draw.includes('replaceChildren('), draw);
  assert.ok(!/\.open = true/.test(draw) && !/box\.innerHTML =/.test(draw), draw);
});

test('ask dialog lives inside .viz-root (theme colours and font are defined there; in <body> it is transparent and Times)', () => {
  const src = require('node:fs').readFileSync(require('node:path').join(ROOT, 'portal', 'nav.js'), 'utf8');
  const ask = src.slice(src.indexOf('function ask('), src.indexOf('function profileMenu('));
  assert.match(ask, /document\.querySelector\("\.viz-root"\) \|\| document\.body\)\.appendChild\(d\)/);
});

test('profiles window table: names escaped, current «открыт», delete only when more than one, locked → disabled', () => {
  const h = js(`Nav.profilesTable({list: [{id: 'a', name: '<i>Ив</i>'}, {id: 'b', name: 'Мария'}], current: 'a', locked: null})`);
  assert.ok(h.includes('&lt;i&gt;Ив&lt;/i&gt;') && !h.includes('<i>Ив'));
  assert.ok(h.includes('открыт'));
  assert.ok(!h.includes('data-open="a"') && h.includes('data-open="b"'));
  assert.ok(h.includes('data-ren="a"') && h.includes('data-ren="b"'));
  assert.ok(h.includes('data-del="a"') && h.includes('data-del="b"'));
  const one = js(`Nav.profilesTable({list: [{id: 'a', name: 'Ив'}], current: 'a', locked: null})`);
  assert.ok(!one.includes('data-del'));
  const locked = js(`Nav.profilesTable({list: [{id: 'a', name: 'Ив'}, {id: 'b', name: 'М'}], current: 'a', locked: 'Идёт обновление'})`);
  assert.match(locked, /data-open="b"[^>]*disabled/);
  assert.match(locked, /data-del="b"[^>]*disabled/);
});

test('profiles window closes on a click outside it, not on a click on its own padding (that click also targets <dialog>)', () => {
  const src = require('node:fs').readFileSync(require('node:path').join(ROOT, 'portal', 'nav.js'), 'utf8');
  const win = src.slice(src.indexOf('function profilesWindow('), src.indexOf('function profileBar('));
  assert.match(win, /e\.target === d && outside/);
  assert.match(win, /getBoundingClientRect\(\)/);
});

test('theme: light / dark / auto (auto — like the system: no data-theme); unknown → auto', () => {
  assert.strictEqual(js(`Nav.themeAttr("light")`), 'light');
  assert.strictEqual(js(`Nav.themeAttr("dark")`), 'dark');
  assert.strictEqual(js(`Nav.themeAttr("auto")`), null);
  assert.strictEqual(js(`Nav.themeAttr(null)`), null);
  assert.strictEqual(js(`Nav.themeAttr("pink")`), null);
});
