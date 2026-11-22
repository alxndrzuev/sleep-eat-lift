// portal/whatsnew.js — вёрстка заметок «Что нового», крестик «назад» и подключение на всех страницах.
const test = require('node:test');
const assert = require('node:assert');
const {load, source, J} = require('./_portal');

const js = load('nav.js', 'whatsnew.js');
const PAGES = ['dashboard.html', 'nutrition.html', 'training.html', 'recovery.html', 'photos.html', 'settings.html', 'whatsnew.html'];
const REL = [{version: '1.1.0', date: '2026-12-01', sections: [{title: 'Новое', items: ['**Сон** <b>не тег</b> & ко']}]},
             {version: '1.0.0', date: '2026-11-22', sections: [{title: 'Исправлено', items: ['Ошибка']}]}];

test('escapes text, keeps **bold**', () => {
  assert.ok(js(`WhatsNew.html(${J(REL)})`).includes('<li><b>Сон</b> &lt;b&gt;не тег&lt;/b&gt; &amp; ко</li>'));
});

test('versions in given order, with dates', () => {
  const h = js(`WhatsNew.html(${J(REL)})`);
  assert.ok(h.indexOf('Версия 1.1.0') < h.indexOf('Версия 1.0.0'));
  for (const s of ['1 декабря 2026', '22 ноября 2026', '<h4>Исправлено</h4>']) assert.ok(h.includes(s), s);
});

test('draft without date', () => {
  assert.ok(js('WhatsNew.html([{"version": "Не выпущено", "date": null, "sections": [{"title": "Новое", "items": ["А"]}]}])')
    .includes('Не выпущено (черновик)'));
  assert.strictEqual(js('WhatsNew.date("2026-01-05")'), '5 января 2026');
  assert.strictEqual(js('WhatsNew.html([])'), '');
});

test('close button goes back to the page we came from', () => {
  assert.deepStrictEqual(js('WhatsNew.back("settings.html")'), {href: 'settings.html', title: 'Настройки', history: true});
  assert.strictEqual(js('WhatsNew.back("recovery.html")').title, 'Восстановление');
});

test('unknown previous page → dashboard', () => {
  for (const last of [null, '', 'whatsnew.html', 'x.html', 'https://evil.example/settings.html'])
    assert.deepStrictEqual(js(`WhatsNew.back(${J(last)})`), {href: 'dashboard.html', title: 'Сводка', history: false}, String(last));
});

test('history page: close button and Esc, no section menu', () => {
  const h = source('whatsnew.html');
  for (const s of ['class="close" id="back"', 'aria-label="Закрыть"', 'WhatsNew.back(last)', "'Escape'"]) assert.ok(h.includes(s), s);
  assert.ok(!h.includes('id="nav"'));
  assert.ok(source('nav.js').includes('sessionStorage.setItem("navLast", cur)'));
});

test('every page loads whatsnew.js after nav.js', () => {
  for (const p of PAGES) {
    const h = source(p);
    assert.ok(h.includes('<script src="whatsnew.js"></script>'), p);
    assert.ok(h.indexOf('<script src="nav.js"></script>') < h.indexOf('<script src="whatsnew.js"></script>'), p);
  }
});

test('settings link to the history', () => {
  assert.ok(source('settings.html').includes('href="whatsnew.html"'));
});
