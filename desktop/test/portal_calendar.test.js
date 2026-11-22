// Календари страниц (.hm) — типовой элемент: подсказка у ячейки только через calTips из common.js.
// Своя подсказка внутри прокручиваемого .hm обрезается снизу (нижние ячейки) — так было до 22.11.2026.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const {PORTAL, source} = require('./_portal');

test('common.js defines calTips: tip outside the scroll, above the cell if it does not fit below', () => {
  const js = source('common.js');
  assert.ok(js.includes('function calTips(el, html)'));
  const body = js.split('function calTips(el, html)')[1].split('\n}\n')[0];
  assert.ok(body.includes('el.parentElement'));
  assert.ok(body.includes('rb.top-bb.top-th-g'));
});

test('every calendar uses calTips', () => {
  const pages = {};
  for (const p of fs.readdirSync(PORTAL).filter(f => f.endsWith('.html')).sort()) {
    const html = source(p);
    const n = (html.match(/class="hm\b/g) || []).length;
    if (!n) continue;
    pages[p] = n;
    assert.strictEqual(html.split('calTips(').length - 1, n, `${p}: календарей ${n} — столько же calTips(…)`);
    assert.ok(!html.includes('tip.cloneNode'), `${p}: своя подсказка календаря — только calTips`);
  }
  assert.deepStrictEqual(pages, {'nutrition.html': 1, 'recovery.html': 2, 'training.html': 1});
});
