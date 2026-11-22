// Хранилище CSV приложения (и scripts/csv.js): порядок колонок по схеме, сортировка, LF, числа без лишних нулей.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const store = require('../store');

function tmpDocs() {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'health-store-'));
  const docs = path.join(base, 'Документы тест');
  fs.mkdirSync(docs);
  return {base, dir: store.dataDir(docs)};
}

test('dataDir — Документы/SEL/data', () => {
  assert.strictEqual(store.dataDir('/x/Documents'), path.join('/x/Documents', 'SEL', 'data'));
});

test('init creates folders and CSV headers once', () => {
  const {dir} = tmpDocs();
  const created = store.init(dir);
  assert.ok(created.includes('body.csv'));
  assert.strictEqual(fs.readFileSync(path.join(dir, 'body.csv'), 'utf8'), 'date,weight_kg,waist_cm,bodyfat_pct,note\n');
  for (const sub of ['secrets', 'photos']) assert.ok(fs.statSync(path.join(dir, sub)).isDirectory());
  assert.deepStrictEqual(store.init(dir), []);
});

test('upsert: null does not overwrite, numbers trimmed, sorted, LF', () => {
  const {dir} = tmpDocs();
  store.init(dir);
  store.upsert(dir, 'body.csv', {'2026-01-02': {weight_kg: 71.0}, '2026-01-01': {weight_kg: 70, waist_cm: 80, note: 'x'}});
  const r = store.upsert(dir, 'body.csv', {'2026-01-01': {weight_kg: 70.5, waist_cm: null}, '2026-01-03': {weight_kg: 72.25}});
  assert.deepStrictEqual(r, {added: 1, updated: 1, total: 3});
  const raw = fs.readFileSync(path.join(dir, 'body.csv'), 'utf8');
  assert.ok(!raw.includes('\r'));
  assert.deepStrictEqual(raw.trim().split('\n'), [
    'date,weight_kg,waist_cm,bodyfat_pct,note', '2026-01-01,70.5,80,,x', '2026-01-02,71,,,', '2026-01-03,72.25,,,']);
});

test('csv quoting of commas and quotes', () => {
  const {dir} = tmpDocs();
  store.init(dir);
  store.upsert(dir, 'events.csv', {'2026-01-01': {type: 'другое', description: 'а, "б"'}});
  assert.deepStrictEqual(store.read(dir, 'events.csv')[0].description, 'а, "б"');
});

test('data.js is RAW with numbers', () => {
  const {dir} = tmpDocs();
  store.init(dir);
  store.upsert(dir, 'body.csv', {'2026-01-01': {weight_kg: 70.5}});
  store.writeDataJs(dir, '2026-11-21', ['photos']);
  const js = fs.readFileSync(path.join(dir, 'data.js'), 'utf8');
  const raw = JSON.parse(js.slice(js.indexOf('const RAW = ') + 12).trim().replace(/;$/, ''));
  assert.deepStrictEqual(Object.keys(raw).sort(), ['meta', 'modules', 'tables', 'updated']);
  assert.strictEqual(raw.tables['body.csv'][0].weight_kg, 70.5);
  assert.strictEqual(raw.tables['body.csv'][0].note, null);
  assert.deepStrictEqual(raw.modules, ['photos']);
  assert.deepStrictEqual(raw.meta.journal, []);
});

test('modules from secrets', () => {
  const {dir} = tmpDocs();
  store.init(dir);
  assert.deepStrictEqual(store.modules(dir), ['photos']);
  fs.writeFileSync(path.join(dir, 'secrets', 'fatsecret.json'), '{"access_token": "t"}');
  fs.writeFileSync(path.join(dir, 'secrets', 'whoop.json'), '{"refresh_token": "r"}');
  assert.deepStrictEqual(store.modules(dir), ['fatsecret', 'photos', 'whoop']);
});

test('fmtNum: rounding half to even, as before in Python', () => {
  assert.strictEqual(store.fmtNum(72.125), '72.12');
  assert.strictEqual(store.fmtNum(0.125), '0.12');
  assert.strictEqual(store.fmtNum(70.0), '70');
  assert.strictEqual(store.fmtNum(72.5), '72.5');
});

test('old events.csv without level column is read and upgraded on write', () => {
  const dir = store.dataDir(fs.mkdtempSync(path.join(os.tmpdir(), 'health-evo-')));
  store.init(dir);
  fs.writeFileSync(path.join(dir, 'events.csv'), 'start,end,type,description\n2026-11-10,2026-11-10,алкоголь,вино\n');
  const rows = store.read(dir, 'events.csv');
  assert.deepStrictEqual(rows, [{start: '2026-11-10', end: '2026-11-10', type: 'алкоголь', description: 'вино', level: ''}]);
  store.write(dir, 'events.csv', rows);
  assert.ok(fs.readFileSync(path.join(dir, 'events.csv'), 'utf8').startsWith('start,end,type,description,level\n'));
  fs.writeFileSync(path.join(dir, 'events.csv'), 'start,type\n2026-11-10,x\n');
  assert.throws(() => store.read(dir, 'events.csv'), /заголовок/);
});

test('upsert: unchanged value is not counted as updated', () => {
  const {dir} = tmpDocs();
  store.init(dir);
  store.upsert(dir, 'nutrition_daily.csv', {'2026-01-01': {kcal: 2000}});
  assert.deepStrictEqual(store.upsert(dir, 'nutrition_daily.csv', {'2026-01-01': {kcal: 2000.0}}), {added: 0, updated: 0, total: 1});
});

test('workouts keyed by id, sorted by start', () => {
  const {dir} = tmpDocs();
  store.init(dir);
  store.upsert(dir, 'whoop_workouts.csv', {b: {start: '2026-01-02 20:00'}, a: {start: '2026-01-03 20:00'}});
  assert.deepStrictEqual(store.read(dir, 'whoop_workouts.csv').map(r => r.id), ['b', 'a']);
});

test('read: wrong header is an error', () => {
  const {dir} = tmpDocs();
  store.init(dir);
  fs.writeFileSync(path.join(dir, 'body.csv'), 'date,weight\n2026-01-01,70\n');
  assert.throws(() => store.read(dir, 'body.csv'), /заголовок/);
});

test('meta.json: from data folder, missing → empty plan', () => {
  const {dir} = tmpDocs();
  store.init(dir);
  assert.deepStrictEqual(store.raw(dir, '2026-11-21', []).meta.plan.rows, []);
  fs.writeFileSync(path.join(dir, 'meta.json'), '{"plan": {"targets": {"sleep": 8}}}');
  assert.strictEqual(store.raw(dir, '2026-11-21', []).meta.plan.targets.sleep, 8);
});
