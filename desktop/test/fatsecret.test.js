// FatSecret в приложении: виды ошибок, выгрузка в CSV, обновление не портит файлы при ошибке.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const store = require('../store');
const fs_ = require('../fatsecret');
const updater = require('../updater');

const APP = {consumer_key: 'ck', consumer_secret: 'cs'}, USER = {access_token: 't', access_secret: 's'};
const resp = (body, status = 200) => Promise.resolve(new Response(typeof body === 'string' ? body : JSON.stringify(body), {status}));
const EPOCH = Date.UTC(1970, 0, 1);
const di = ds => String(Math.round((Date.parse(ds + 'T00:00:00Z') - EPOCH) / 864e5));

function tmp() {
  const dir = store.dataDir(fs.mkdtempSync(path.join(os.tmpdir(), 'health-fs-')));
  store.init(dir);
  return dir;
}

/** Заглушка API: питание и вес по месяцам (ym → дни), или ошибка на n-м запросе. */
function fakeApi({food = {}, weight = {}, failAt = -1, fail} = {}) {
  let n = 0;
  return async (url) => {
    if (n++ === failAt) return fail();
    const u = new URL(url), method = u.searchParams.get('method');
    const ym = new Date(EPOCH + Number(u.searchParams.get('date')) * 864e5).toISOString().slice(0, 7);
    if (method === 'food_entries.get_month.v2')
      return resp({month: {day: (food[ym] || []).map(([d, k, p, f, c]) => ({date_int: di(d), calories: k, protein: p, fat: f, carbohydrate: c}))}});
    return resp({month: {day: (weight[ym] || []).map(([d, kg]) => ({date_int: di(d), weight_kg: kg}))}});
  };
}

test('error kinds and texts', async () => {
  await assert.rejects(fs_.month(APP, USER, '2026-11', {fetch: () => resp({error: {code: 9, message: 'Invalid token'}})}),
    e => e.kind === 'token' && e.message === 'Доступ к FatSecret пропал — подключите заново');
  await assert.rejects(fs_.month(APP, USER, '2026-11', {fetch: () => Promise.reject(new TypeError('fetch failed'))}),
    e => e.kind === 'network' && e.message === 'Нет связи с FatSecret, данные со вчера. Попробуйте позже');
  await assert.rejects(fs_.month(APP, USER, '2026-11', {fetch: () => resp({error: {code: 21, message: 'Invalid IP'}})}),
    e => e.kind === 'api' && e.message === 'FatSecret ответил ошибкой: Invalid IP');
});

test('month parsing: single day object and rounding', async () => {
  const fetch = async () => resp({month: {day: {date_int: di('2026-11-03'), calories: '2100.04', protein: '120.25', fat: '60', carbohydrate: '250.55'}}});
  assert.deepStrictEqual(await fs_.month(APP, USER, '2026-11', {fetch}),
    {'2026-11-03': {kcal: 2100, protein: 120.2, fat: 60, carbs: 250.6}});
});

test('update writes nutrition and weight', async () => {
  const dir = tmp();
  store.upsert(dir, 'body.csv', {'2026-10-05': {note: 'после отпуска'}});
  const fetch = fakeApi({food: {'2026-11': [['2026-11-01', 2000, 100, 60, 250]]},
                         weight: {'2026-10': [['2026-10-05', 72.5]], '2026-11': [['2026-11-02', 73]]}});
  const r = await fs_.update({dir, app: APP, user: USER, months: ['2026-10', '2026-11'], fetch});
  assert.deepStrictEqual(r, {ok: true, days: 1, weights: 2});
  assert.deepStrictEqual(store.read(dir, 'nutrition_daily.csv')[0], {date: '2026-11-01', kcal: '2000', protein: '100', fat: '60', carbs: '250', fiber: ''});
  const body = store.read(dir, 'body.csv');
  assert.deepStrictEqual(body.map(b => [b.date, b.weight_kg, b.note]),
    [['2026-10-05', '72.5', 'после отпуска'], ['2026-11-02', '73', 'FatSecret']]);
});

test('failed update leaves files byte for byte', async () => {
  const dir = tmp();
  store.upsert(dir, 'nutrition_daily.csv', {'2026-10-01': {kcal: 1900}});
  const before = ['nutrition_daily.csv', 'body.csv'].map(f => fs.readFileSync(path.join(dir, f), 'utf8'));
  const fetch = fakeApi({food: {'2026-10': [['2026-10-02', 2000, 1, 1, 1]]}, failAt: 2, fail: () => Promise.reject(new TypeError('net'))});
  const r = await fs_.update({dir, app: APP, user: USER, months: ['2026-10', '2026-11'], fetch});
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.error, 'Нет связи с FatSecret, данные со вчера. Попробуйте позже');
  assert.deepStrictEqual(['nutrition_daily.csv', 'body.csv'].map(f => fs.readFileSync(path.join(dir, f), 'utf8')), before);
});

test('ranges', () => {
  assert.deepStrictEqual(updater.firstRange(new Date(2026, 10, 21)), ['2025-12', '2026-11']);
  assert.deepStrictEqual(updater.recentRange(new Date(2026, 10, 21)), ['2026-10', '2026-11']);
  assert.deepStrictEqual(updater.recentRange(new Date(2026, 0, 5)), ['2025-12', '2026-01']);
});

test('runAll: one at a time, data.js written, busy cleared after failure', async () => {
  const dir = tmp();
  let release;
  const slow = {connected: () => true, update: () => new Promise(r => { release = r; })};
  const failing = {connected: () => true, update: async () => ({ok: false, error: 'Нет связи с Whoop, данные со вчера. Попробуйте позже'})};
  const u = updater.create({fatsecret: slow, whoop: failing}, () => '2026-11-21');
  const first = u.runAll(dir);
  assert.strictEqual(u.busy, true);
  assert.deepStrictEqual(await u.runAll(dir), {busy: true});
  release({ok: true});
  const r = await first;
  assert.deepStrictEqual(r.fatsecret, {ok: true});
  assert.strictEqual(r.whoop.ok, false);
  assert.strictEqual(u.busy, false);
  assert.ok(fs.existsSync(path.join(dir, 'data.js')));
  assert.strictEqual(u.status.whoop.lastError, 'Нет связи с Whoop, данные со вчера. Попробуйте позже');
});

test('runAll skips services that are not connected', async () => {
  const dir = tmp();
  let called = false;
  const u = updater.create({fatsecret: {connected: () => false, update: async () => { called = true; return {ok: true}; }}}, () => '2026-11-21');
  assert.deepStrictEqual(await u.runAll(dir), {});
  assert.strictEqual(called, false);
});
