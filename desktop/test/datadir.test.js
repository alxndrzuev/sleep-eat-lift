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

test('empty or unrelated folder → new SEL/data inside', () => {
  const p = tmp();
  fs.writeFileSync(path.join(p, 'отчёт.docx'), 'x');
  assert.deepStrictEqual(dd.fromPicked(p), {dir: path.join(p, 'SEL', 'data'), existing: false});
});

test('default — Документы/SEL/data', () => {
  assert.strictEqual(dd.defaultDir('/Users/u/Documents'), path.join('/Users/u/Documents', 'SEL', 'data'));
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

test('прежнее «Здоровье»: настройки и тема переносятся в SEL один раз, свои настройки SEL не затираются', () => {
  const old = tmp(), ud = path.join(tmp(), 'SEL');
  fs.writeFileSync(path.join(old, 'config.json'), JSON.stringify({dataDir: '/d', lastSeenVersion: '1.0.0'}));
  fs.mkdirSync(path.join(old, 'Local Storage', 'leveldb'), {recursive: true});
  fs.writeFileSync(path.join(old, 'Local Storage', 'leveldb', 'x.log'), 'theme');
  assert.strictEqual(dd.migrate(old, ud), true);
  assert.deepStrictEqual(dd.readCfg(ud), {dataDir: '/d', lastSeenVersion: '1.0.0'});
  assert.strictEqual(fs.readFileSync(path.join(ud, 'Local Storage', 'leveldb', 'x.log'), 'utf8'), 'theme');
  dd.save(ud, '/new');
  assert.strictEqual(dd.migrate(old, ud), false);                    // уже есть config.json SEL — не трогаем
  assert.strictEqual(dd.readCfg(ud).dataDir, '/new');
  assert.strictEqual(dd.migrate(tmp(), path.join(tmp(), 'SEL')), false);   // прежних настроек нет — новичок
  assert.ok(fs.existsSync(path.join(old, 'config.json')), 'прежние настройки остаются на месте');
});
