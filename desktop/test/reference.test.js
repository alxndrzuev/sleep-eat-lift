// Эталоны: ответы прежних Python-скриптов (fatsecret_api.signed_url, whoop_api.to_rows, alcohol_check.main) — сняты 22.11.2026
// перед их удалением. Приложение должно давать то же самое.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const store = require('../store');
const fatsecret = require('../fatsecret');
const whoop = require('../whoop');
const alcohol = require('../alcohol');

const FX = path.join(__dirname, 'fixtures');

test('FatSecret: OAuth 1.0 signature — byte for byte as before', () => {
  for (const {args, want} of require('./fixtures/fatsecret_signed.json'))
    assert.strictEqual(fatsecret.signedUrl(...args, 'abc123', '1795000000'), want);
});

test('Whoop: API answers → CSV rows as before', () => {
  const f = require('./fixtures/whoop_v2.json');
  assert.deepStrictEqual(JSON.parse(JSON.stringify(whoop.toRows(f.cycles, f.recoveries, f.sleeps, f.workouts))), require('./fixtures/whoop_rows.json'));
});

test('alcohol: marked nights as before (levels, illness series, events, kept answers)', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'health-ref-'));
  for (const n of ['whoop_daily.csv', 'events.csv', 'alcohol_check.csv']) fs.copyFileSync(path.join(FX, 'alcohol', 'in_' + n), path.join(dir, n));
  alcohol.mark(dir, {from: '2026-11-14'});
  assert.strictEqual(fs.readFileSync(path.join(dir, 'alcohol_check.csv'), 'utf8'), fs.readFileSync(path.join(FX, 'alcohol', 'want_alcohol_check.csv'), 'utf8'));
});

// ---------- правило разметки (бывший tests/test_alcohol.py) ----------
const END = '2026-11-21';
const day = n => { const d = new Date(END + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
function run(override = {}, n = 40, extra = {}) {
  const dir = store.dataDir(fs.mkdtempSync(path.join(os.tmpdir(), 'health-alcrule-')));
  store.init(dir);
  const rows = [];
  for (let i = n - 1; i >= 0; i--) rows.push(Object.assign({date: day(-i), recovery: 70, hrv: 100, rhr: 50, skin_temp: 34.0}, override[day(-i)] || {}));
  store.write(dir, 'whoop_daily.csv', rows.map(r => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, String(v)]))));
  if (extra.events) store.write(dir, 'events.csv', extra.events);
  if (extra.checks) store.write(dir, 'alcohol_check.csv', extra.checks);
  alcohol.mark(dir, {from: '2000-01-01'});
  return Object.fromEntries(store.read(dir, 'alcohol_check.csv').map(r => [r.date, r]));
}

test('rule: strong night — «много», HRV −45', () => {
  const r = run({[day(0)]: {hrv: 55, rhr: 58}})[day(0)];
  assert.deepStrictEqual([r.status, r.kind, r.strength, r.hrv_dev_pct], ['?', 'алкоголь?', 'много', '-45']);
});

test('rule: −28%/+6 — «мало»; −20% — not flagged', () => {
  const res = run({[day(-5)]: {hrv: 72, rhr: 56}, [day(-2)]: {hrv: 80, rhr: 58}});
  assert.strictEqual(res[day(-5)].strength, 'мало');
  assert.ok(!(day(-2) in res));
});

test('rule: −40%/+8 — «умеренно»; −30%/+13 — «много»', () => {
  assert.strictEqual(run({[day(0)]: {hrv: 60, rhr: 58}})[day(0)].strength, 'умеренно');
  assert.strictEqual(run({[day(0)]: {hrv: 70, rhr: 63}})[day(0)].strength, 'много');
});

test('rule: three mornings in a row — «болезнь?»', () => {
  const bad = {[day(0)]: {hrv: 60, rhr: 57}, [day(-1)]: {hrv: 60, rhr: 57}, [day(-2)]: {hrv: 60, rhr: 57}};
  const res = run(bad);
  assert.ok(Object.keys(bad).every(d => res[d].kind === 'болезнь?'));
});

test('rule: needs 10 days of history', () => {
  assert.deepStrictEqual(run({[day(0)]: {hrv: 50, rhr: 60}}, 8), {});
});

test('rule: existing answer kept; alcohol events confirm the next morning', () => {
  const res = run({[day(0)]: {hrv: 55, rhr: 58}, [day(-10)]: {hrv: 55, rhr: 58}}, 40, {
    checks: [{date: day(0), status: 'нет'}],
    events: [{start: day(-11), end: day(-11), type: 'алкоголь'}, {start: day(-20), end: day(-20), type: 'алкоголь'}]});
  assert.strictEqual(res[day(0)].status, 'нет');
  assert.strictEqual(res[day(-10)].status, 'да');
  assert.strictEqual(res[day(-19)].status, 'да');
  assert.match(res[day(-19)].note, /из событий/);
});
