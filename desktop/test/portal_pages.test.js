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
  for (const p of [...PAGES, 'settings.html', 'whatsnew.html']) {
    const inline = [...source(p).matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]).join('\n');
    const code = (!PAGES.includes(p) || p === 'photos.html' ? '' : head + '\n' + source('common.js')) + '\n' + inline;
    assert.doesNotThrow(() => new vm.Script(code, {filename: p}), p);
  }
});
