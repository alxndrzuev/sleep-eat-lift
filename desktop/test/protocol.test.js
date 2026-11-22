// Протокол app://h/ — белый список: страницы приложения, data.js и фото; остальное — null (404).
const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const {resolve} = require('../protocol');

const PORTAL = '/app/portal', DATA = '/Users/u/Documents тест/Здоровье/data';

test('allowed', () => {
  assert.strictEqual(resolve('app://h/portal/dashboard.html', PORTAL, DATA), path.join(PORTAL, 'dashboard.html'));
  assert.strictEqual(resolve('app://h/portal/vendor/libheif.js', PORTAL, DATA), path.join(PORTAL, 'vendor/libheif.js'));
  assert.strictEqual(resolve('app://h/data/data.js', PORTAL, DATA), path.join(DATA, 'data.js'));
  assert.strictEqual(resolve('app://h/data/photos/aligned/a%20b.jpg', PORTAL, DATA), path.join(DATA, 'photos/aligned/a b.jpg'));
  assert.strictEqual(resolve('app://h/data/photos/photos.js?v=3', PORTAL, DATA), path.join(DATA, 'photos/photos.js'));
});

test('denied', () => {
  for (const u of ['app://h/data/body.csv', 'app://h/data/meta.json', 'app://h/data/secrets/fatsecret.json',
                   'app://h/data/../data/secrets/x', 'app://h/data/photos/../secrets/x', 'app://h/data/photos/%2e%2e/secrets/x',
                   'app://h/portal/../../etc/passwd', 'app://h/portal/%2e%2e/%2e%2e/etc/passwd', 'app://other/portal/dashboard.html',
                   'app://h/', 'app://h/data/photos'])
    assert.strictEqual(resolve(u, PORTAL, DATA), null, u);
});

test('CSP: nothing from outside, no plugins, wasm allowed for photos', () => {
  const {CSP} = require('../protocol');
  const dir = Object.fromEntries(CSP.split('; ').map(x => { const [k, ...v] = x.split(' '); return [k, v]; }));
  assert.deepStrictEqual(dir['default-src'], ["'self'"]);
  assert.deepStrictEqual(dir['object-src'], ["'none'"]);
  for (const k of ['script-src', 'connect-src', 'img-src', 'style-src', 'worker-src', 'font-src'])
    for (const v of dir[k]) assert.ok(!/^(https?:|\*|ws)/.test(v), `${k}: ${v}`);
  assert.ok(dir['script-src'].includes("'wasm-unsafe-eval'"));
  assert.ok(!dir['script-src'].includes("'unsafe-eval'"));
});
