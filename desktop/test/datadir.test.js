// Где лежат данные: запоминается в настройках приложения; выбранная папка → папка data (новая или уже с данными).
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const dd = require('../datadir');

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'health-dd-'));

test('config: nothing saved → null; saved and folder exists → path; folder gone → missing', () => {
  const ud = tmp(), data = path.join(tmp(), 'data');
  assert.deepStrictEqual(dd.current(ud), {dir: null, missing: null});
  fs.mkdirSync(data);
  dd.save(ud, data);
  assert.deepStrictEqual(dd.current(ud), {dir: data, missing: null});
  fs.rmSync(data, {recursive: true});
  assert.deepStrictEqual(dd.current(ud), {dir: null, missing: data});
});

test('picked folder with data/ inside (project or previous app folder) → its data/', () => {
  const p = tmp();
  fs.mkdirSync(path.join(p, 'data'));
  fs.writeFileSync(path.join(p, 'data', 'body.csv'), 'date,weight_kg,waist_cm,bodyfat_pct,note\n');
  assert.deepStrictEqual(dd.fromPicked(p), {dir: path.join(p, 'data'), existing: true});
});

test('picked folder that is data itself → as is', () => {
  const p = tmp();
  fs.writeFileSync(path.join(p, 'nutrition_daily.csv'), 'date,kcal,protein,fat,carbs,fiber\n');
  assert.deepStrictEqual(dd.fromPicked(p), {dir: p, existing: true});
});

test('empty or unrelated folder → new Здоровье/data inside', () => {
  const p = tmp();
  fs.writeFileSync(path.join(p, 'отчёт.docx'), 'x');
  assert.deepStrictEqual(dd.fromPicked(p), {dir: path.join(p, 'Здоровье', 'data'), existing: false});
});

test('default — Документы/Здоровье/data', () => {
  assert.strictEqual(dd.defaultDir('/Users/u/Documents'), path.join('/Users/u/Documents', 'Здоровье', 'data'));
});

test('saveCfg adds fields, keeps dataDir; save keeps other fields', () => {
  const ud = tmp(), data = path.join(tmp(), 'data');
  fs.mkdirSync(data);
  dd.save(ud, data);
  dd.saveCfg(ud, {lastSeenVersion: '1.0.0'});
  assert.deepStrictEqual(dd.readCfg(ud), {dataDir: data, lastSeenVersion: '1.0.0'});
  dd.save(ud, data);
  assert.strictEqual(dd.readCfg(ud).lastSeenVersion, '1.0.0');
  assert.deepStrictEqual(dd.readCfg(tmp()), {});
});
