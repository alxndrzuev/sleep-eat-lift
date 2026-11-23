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

test('picked folder with profiles (2.0) → its data, or itself', () => {
  const p = tmp();
  fs.mkdirSync(path.join(p, 'data', 'profiles', 'ivan'), {recursive: true});
  assert.deepStrictEqual(dd.fromPicked(p), {dir: path.join(p, 'data'), existing: true});
  assert.deepStrictEqual(dd.fromPicked(path.join(p, 'data')), {dir: path.join(p, 'data'), existing: true});
  assert.strictEqual(dd.hasProfiles(path.join(p, 'data')), true);
  const e = tmp(); fs.mkdirSync(path.join(e, 'profiles'));           // пустая profiles/ — данных нет
  assert.strictEqual(dd.hasProfiles(e), false);
});

test('picked folder is a profile itself → its root (not a nested migration)', () => {
  const root = tmp(), prof = path.join(root, 'profiles', 'aleksandr');
  fs.mkdirSync(prof, {recursive: true});
  fs.writeFileSync(path.join(prof, 'profile.json'), '{"name": "Александр"}');
  fs.writeFileSync(path.join(prof, 'nutrition_daily.csv'), 'date,kcal,protein,fat,carbs,fiber\n');
  assert.deepStrictEqual(dd.fromPicked(prof), {dir: root, existing: true});
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

// ---------- формат папки данных (sel.json): старая SEL не открывает данные, обновлённые более новой ----------
test('data format: none yet → ok; same or older → ok; newer → not ok with the version that wrote it', () => {
  const root = tmp();
  assert.strictEqual(dd.FORMAT, 2);
  assert.deepStrictEqual(dd.checkFormat(root), {ok: true, format: null, app: null});
  dd.writeFormat(root, '2.0.1');
  assert.deepStrictEqual(JSON.parse(fs.readFileSync(path.join(root, 'sel.json'), 'utf8')), {format: 2, app: '2.0.1'});
  assert.deepStrictEqual(dd.checkFormat(root), {ok: true, format: 2, app: '2.0.1'});
  fs.writeFileSync(path.join(root, 'sel.json'), JSON.stringify({format: 1, app: '1.9.0'}));
  assert.strictEqual(dd.checkFormat(root).ok, true);
  fs.writeFileSync(path.join(root, 'sel.json'), JSON.stringify({format: 3, app: '3.0.0'}));
  assert.deepStrictEqual(dd.checkFormat(root), {ok: false, format: 3, app: '3.0.0'});
});

test('writeFormat never lowers the format; a broken sel.json counts as missing', () => {
  const root = tmp();
  fs.writeFileSync(path.join(root, 'sel.json'), JSON.stringify({format: 3, app: '3.0.0'}));
  dd.writeFormat(root, '2.0.1');                                     // старая версия формат не понижает
  assert.deepStrictEqual(JSON.parse(fs.readFileSync(path.join(root, 'sel.json'), 'utf8')), {format: 3, app: '3.0.0'});
  fs.writeFileSync(path.join(root, 'sel.json'), '{не json');
  assert.deepStrictEqual(dd.checkFormat(root), {ok: true, format: null, app: null});
  dd.writeFormat(root, '2.0.1');
  assert.strictEqual(dd.checkFormat(root).format, 2);
});
