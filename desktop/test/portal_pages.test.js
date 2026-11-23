// Страницы приложения: порядок подключения скриптов, меню, синтаксис кода страниц.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const {PORTAL, source} = require('./_portal');

const PAGES = ['dashboard.html', 'nutrition.html', 'training.html', 'recovery.html', 'photos.html'];
const order = (h, tags) => assert.deepStrictEqual(tags.map(t => h.indexOf(t)), tags.map(t => h.indexOf(t)).sort((a, b) => a - b));

test('pages load data, dataset and common in order', () => {
  for (const p of PAGES.slice(0, -1)) {
    const h = source(p);
    assert.ok(h.includes('<link rel="stylesheet" href="common.css">'), p);
    order(h, ['<script src="../data/data.js"></script>', '<script src="dataset.js"></script>', '<script src="common.js"></script>']);
    assert.doesNotMatch(h, /\/\*(COMMON_CSS|COMMON_JS|DATA)\*\//, p);
  }
});

test('photos page scripts: data, photo index, logic, processing — in order', () => {
  const h = source('photos.html');
  order(h, ['<script src="../data/data.js"></script>', '<script src="dataset.js"></script>', '<script src="../data/photos/photos.js"></script>',
            '<script src="photos_core.js"></script>', '<script src="photos_app.js"></script>']);
  assert.ok(!h.includes('photos_data.js'));
});

test('settings page scripts in order, without common.js', () => {
  const h = source('settings.html');
  order(h, ['<script src="../data/data.js"></script>', '<script src="dataset.js"></script>', '<script src="nav.js"></script>']);
  assert.ok(h.includes('<nav class="nav" id="nav"></nav>'));
});

test('menu: every page has an empty <nav id="nav"> and loads nav.js; links point to existing pages', () => {
  for (const p of PAGES) {
    const h = source(p);
    assert.ok(h.includes('<nav class="nav" id="nav"></nav>'), p);
    assert.ok(h.indexOf('<script src="dataset.js"></script>') < h.indexOf('<script src="nav.js"></script>'), p);
  }
  for (const [, href] of source('nav.js').matchAll(/\["([a-z]+\.html)"/g)) assert.ok(fs.existsSync(path.join(PORTAL, href)), href);
});

test('empty period on «Тренировки» shows the last workouts', () => {
  const h = source('training.html');
  assert.ok(h.includes('За период тренировок нет. Последняя —'));
  assert.ok(h.includes('table(all.slice(0,5))'));
});

test('workouts only on their own page, not on «Восстановление»', () => {
  assert.ok(!source('recovery.html').includes('Тренировки за период'));
  assert.ok(!source('recovery.html').includes('whoop_workouts'));
  assert.ok(source('nav.js').includes('"training.html"'));
});

test('page JavaScript parses (data.js + dataset + common + inline code)', () => {
  const head = 'const RAW = {"tables": {}, "meta": {"plan": {}}, "modules": [], "updated": "2026-11-21"};\n' + source('dataset.js');
  for (const p of [...PAGES, 'settings.html', 'whatsnew.html', 'profile.html']) {
    const inline = [...source(p).matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]).join('\n');
    const code = (!PAGES.includes(p) || p === 'photos.html' ? '' : head + '\n' + source('common.js')) + '\n' + inline;
    assert.doesNotThrow(() => new vm.Script(code, {filename: p}), p);
  }
});

test('every page: window title «<section> · SEL» (Electron shows the page title in the window bar)', () => {
  for (const p of fs.readdirSync(PORTAL).filter(f => f.endsWith('.html'))) {
    const t = /<title>([^<]*)<\/title>/.exec(source(p));
    assert.ok(t && / · SEL$/.test(t[1]), p + ': ' + (t && t[1]));
  }
});

test('profile.html — the name screen: no menu, name field up to 40, creates the profile, three modes', () => {
  const h = source('profile.html');
  assert.ok(!h.includes('id="nav"'), 'на экране имени меню нет');
  assert.match(h, /<input[^>]*id="name"[^>]*maxlength="40"/);
  assert.ok(h.includes('health.createProfile('));
  assert.ok(h.includes('health.skipAdopt('));
  for (const m of ['migrate', 'new', 'adopt']) assert.ok(h.includes(`${m}:`), m);
});

test('settings are only about the open profile: no profiles card there (it is a window from the menu); photos report writing', () => {
  const h = source('settings.html');
  assert.ok(!h.includes('id="profiles"'));
  for (const call of ['renameProfile(', 'removeProfile(', 'createProfile(']) assert.ok(!h.includes(call), call);
  const nav = source('nav.js');
  for (const call of ['renameProfile(', 'removeProfile(', 'profileInfo(', 'createProfile(']) assert.ok(nav.includes(call), call);
  assert.ok(source('photos.html').includes('window.pageBusy'));
});

test('no prompt() in pages: Electron does not support it (throws «prompt() is not supported») — Nav.ask instead', () => {
  for (const f of fs.readdirSync(PORTAL).filter(f => /\.(html|js)$/.test(f))) assert.ok(!/(^|[^.\w])prompt\(/.test(source(f)), f);
  assert.ok(source('nav.js').includes('function ask('));
});

test('«Обновить данные» is not in the top menu: time and the button sit at the end of the line under the heading', () => {
  const nav = source('nav.js');
  const line = nav.slice(nav.indexOf('function updateLine('), nav.indexOf('// ---------- профили'));
  assert.ok(line.includes('getElementById("sub")'), 'строка под заголовком');
  assert.ok(!line.includes('nav.appendChild'), 'не в меню');
  for (const p of ['nutrition.html', 'training.html', 'recovery.html']) assert.ok(source(p).includes('id="sub"'), p);
  // на «Питании» «обновлено» было датой открытия страницы, а не загрузки — теперь настоящее время из строки обновления
  assert.ok(!source('nutrition.html').includes('обновлено ${fmtDY(today)}'));
});

test('period dates sit next to the period buttons, not under the heading; no «N дней», no «данные Whoop по», no «Обновлено» on the dashboard', () => {
  for (const p of ['nutrition.html', 'training.html', 'recovery.html', 'dashboard.html']) {
    const h = source(p);
    assert.match(h, /<div class="controls">\s*<span class="period" id="period"><\/span>/, p);
    assert.ok(!h.includes('dni(S.n)'), p);
    assert.ok(h.includes("$('#period').textContent"), p);
    assert.ok(!h.includes('данные Whoop по'), p);
  }
  assert.ok(!source('dashboard.html').includes('id="updated"'));
  assert.ok(!source('nav.js').includes('syncText'));
});

test('theme is chosen in «Настройки» (light / dark / auto), not by a button on every page; every page applies it', () => {
  for (const f of fs.readdirSync(PORTAL).filter(f => f.endsWith('.html'))) {
    const h = source(f);
    assert.ok(!h.includes('id="theme"'), f + ': кнопки «Тема» на странице нет');
    assert.ok(!h.includes("localStorage.getItem('theme')"), f + ': тему применяет nav.js');
    assert.ok(h.includes('src="nav.js"'), f + ': nav.js применяет тему');
  }
  assert.ok(!source('common.js').includes("$('#theme')"));
  const s = source('settings.html');
  assert.match(s, /<div class="seg" id="themes">\s*<button data-t="light">Светлая<\/button><button data-t="dark">Тёмная<\/button><button data-t="auto">Авто<\/button>/);
  assert.ok(source('photos.html').includes(':root[data-theme="dark"] .viz-root'), '«Фото» — и выбранная тёмная тема');
});

test('name screen opened again (e.g. «Назад» after the first launch) with a profile already open → goes to the dashboard', () => {
  const h = source('profile.html');
  assert.match(h, /health\.profiles\(\)\.then\(i => \{ if \(i\.current\) location\.replace\('dashboard\.html'\)/);
});
