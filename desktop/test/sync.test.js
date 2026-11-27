// Когда сервис последний раз обновился (data/sync.json) и за какой период грузить: пропуски догружаются, а не только
// последние 14 дней / 2 месяца; сводка показывает время настоящей загрузки, а не дату сборки data.js.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const store = require('../store');
const updater = require('../updater');
const {load} = require('./_portal');

function tmp() {
  const dir = store.dataDir(fs.mkdtempSync(path.join(os.tmpdir(), 'health-sync-')));
  store.init(dir);
  return dir;
}

test('sync.json: saved per service, other services kept, in data.js', () => {
  const dir = tmp();
  assert.deepStrictEqual(store.readSync(dir), {});
  store.saveSync(dir, 'whoop', '2026-11-20T10:00:00.000Z');
  store.saveSync(dir, 'fatsecret', '2026-11-21T10:00:00.000Z');
  assert.deepStrictEqual(store.readSync(dir), {whoop: '2026-11-20T10:00:00.000Z', fatsecret: '2026-11-21T10:00:00.000Z'});
  assert.deepStrictEqual(store.raw(dir, '2026-11-22', []).sync, store.readSync(dir));
});

test('runAll: success saves the time to sync.json, failure does not', async () => {
  const dir = tmp();
  const u = updater.create({
    fatsecret: {connected: () => true, update: async () => ({ok: true})},
    whoop: {connected: () => true, update: async () => ({ok: false, error: 'нет связи'})},
  }, () => new Date('2026-11-22T08:30:00Z'));
  await u.runAll(dir);
  assert.deepStrictEqual(store.readSync(dir), {fatsecret: '2026-11-22T08:30:00.000Z'});
});

test('since: last successful update, else last date in the service files, else null', () => {
  const dir = tmp();
  assert.strictEqual(updater.since(dir, 'whoop'), null);
  assert.strictEqual(updater.since(dir, 'fatsecret'), null);
  store.upsert(dir, 'whoop_daily.csv', {'2026-09-01': {steps: 1000}});
  store.upsert(dir, 'nutrition_daily.csv', {'2026-08-10': {kcal: 2000}});
  store.upsert(dir, 'body.csv', {'2026-08-20': {weight_kg: 80}, '2026-10-01': {note: 'без веса'}});
  assert.strictEqual(updater.since(dir, 'whoop'), '2026-09-01');
  assert.strictEqual(updater.since(dir, 'fatsecret'), '2026-08-20');      // вес — тоже из FatSecret; строка без веса — нет
  store.saveSync(dir, 'whoop', '2026-11-20T23:30:00.000Z');
  assert.strictEqual(updater.since(dir, 'whoop'), '2026-11-20');
});

test('whoop days: from the last update with overlap, at least 14, at most 365', () => {
  const now = new Date('2026-11-22T10:00:00Z');
  assert.strictEqual(updater.whoopDays(null, now), 365);
  assert.strictEqual(updater.whoopDays('2026-11-21', now), 14);
  assert.strictEqual(updater.whoopDays('2026-10-01', now), 56);            // 53 дня (с неполным сегодняшним) + 3 дня внахлёст
  assert.strictEqual(updater.whoopDays('2024-01-01', now), 365);
});

test('fatsecret months: from the month of the last update (with overlap), at least 2 months, at most 12', () => {
  const now = new Date(2026, 10, 22);
  assert.deepStrictEqual(updater.fatsecretRange(null, now), ['2025-12', '2026-11']);
  assert.deepStrictEqual(updater.fatsecretRange('2026-11-20', now), ['2026-10', '2026-11']);
  assert.deepStrictEqual(updater.fatsecretRange('2026-08-15', now), ['2026-08', '2026-11']);
  assert.deepStrictEqual(updater.fatsecretRange('2026-08-02', now), ['2026-07', '2026-11']);   // 3 дня внахлёст — июль
  assert.deepStrictEqual(updater.fatsecretRange('2023-05-01', now), ['2025-12', '2026-11']);
});


test('runAll writes to the log: what came, how long, the error', async () => {
  const dir = tmp(), lines = [];
  const log = {info: (m, f) => lines.push(['info', m, f]), warn: (m, f) => lines.push(['warn', m, f])};
  const u = updater.create({
    fatsecret: {connected: () => true, update: async () => ({ok: true, days: 31, weights: 2, entries: 40})},
    whoop: {connected: () => true, update: async () => ({ok: false, kind: 'network', error: 'нет связи'})},
  }, () => new Date('2026-11-22T08:30:00Z'), log);
  await u.runAll(dir, 'fatsecret');
  assert.deepStrictEqual(lines.map(l => [l[0], l[1]]), [['info', 'обновление fatsecret: готово'], ['warn', 'обновление whoop: ошибка']]);
  const {ms: ms1, ...f1} = lines[0][2], {ms: ms2, ...f2} = lines[1][2];
  assert.deepStrictEqual(f1, {first: true, days: 31, weights: 2, entries: 40});
  assert.deepStrictEqual(f2, {first: undefined, error: 'нет связи', kind: 'network'});
  assert.ok(ms1 >= 0 && ms2 >= 0);
});
