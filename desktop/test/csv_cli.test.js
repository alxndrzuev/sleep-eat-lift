// scripts/csv.js — запись данных из чата теми же правилами, что в приложении (store.js); папка данных — как у SEL.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const store = require('../store');
const csv = require('../../scripts/csv');

const tmp = p => fs.mkdtempSync(path.join(os.tmpdir(), p));

test('root folder: HEALTH_DATA → folder chosen in SEL → none', () => {
  assert.strictEqual(csv.rootDir({HEALTH_DATA: '/x/data'}, '/nope'), '/x/data');
  const ud = tmp('health-ud-'), data = tmp('health-data-');
  assert.strictEqual(csv.rootDir({}, ud), null);
  fs.writeFileSync(path.join(ud, 'config.json'), JSON.stringify({dataDir: data}));
  assert.strictEqual(csv.rootDir({}, ud), data);
  fs.rmSync(data, {recursive: true});
  assert.strictEqual(csv.rootDir({}, ud), null);                     // папка пропала
});

const profiles = require('../profiles');
/** Корень с профилями «Анна» (a…) и «Борис» (b…), текущий в config.json — Борис. */
function twoProfiles() {
  const ud = tmp('health-ud-'), root = tmp('health-root-');
  const a = profiles.create(root, 'Анна', '2026-11-23'), b = profiles.create(root, 'Борис', '2026-11-23');
  fs.writeFileSync(path.join(ud, 'config.json'), JSON.stringify({dataDir: root, profile: b.id}));
  return {ud, root, a, b};
}

test('profile folder: current from config, --profile, HEALTH_DATA = a profile itself; old layout — the root', () => {
  const {ud, root, a, b} = twoProfiles();
  assert.strictEqual(csv.profileDir({}, ud), b.dir);
  assert.strictEqual(csv.profileDir({}, ud, a.id), a.dir);
  assert.throws(() => csv.profileDir({}, ud, 'nope'), /Нет такого профиля/);
  assert.strictEqual(csv.profileDir({HEALTH_DATA: a.dir}, '/nope'), a.dir);
  assert.strictEqual(csv.profileDir({HEALTH_DATA: root}, '/nope'), a.dir);    // корень без config — первый по имени
  const old = tmp('health-old-'); store.init(old);
  assert.strictEqual(csv.profileDir({HEALTH_DATA: old}, '/nope'), old);       // 1.x: данные в корне
  assert.deepStrictEqual(csv.allDirs(root), [root, a.dir, b.dir]);
});

test('CLI: --profile anywhere in the arguments; dir lists profiles', () => {
  const {ud, a, b} = twoProfiles();
  assert.deepStrictEqual(csv.parseArgs(['upsert', '--profile', a.id, 'body.csv', '{}']), {args: ['upsert', 'body.csv', '{}'], profile: a.id});
  assert.deepStrictEqual(csv.parseArgs(['read', 'body.csv']), {args: ['read', 'body.csv'], profile: undefined});
  csv.run(['upsert', 'body.csv', '{"2026-11-21": {"weight_kg": 70}}'], csv.profileDir({}, ud, a.id));
  assert.strictEqual(store.read(a.dir, 'body.csv').length, 1);
  assert.strictEqual(store.read(b.dir, 'body.csv').length, 0);
  const out = csv.describe({}, ud);
  assert.ok(out.startsWith(b.dir + '\n'), out);
  assert.ok(out.includes(`${a.id} — Анна`) && out.includes(`${b.id} — Борис (текущий)`), out);
});

test('upsert writes CSV (pages read it directly, no data.js); read shows last rows; remove', () => {
  const dir = tmp('health-cli-');
  store.init(dir);
  assert.strictEqual(csv.run(['upsert', 'body.csv', '{"2026-11-21": {"weight_kg": 75.40}, "2026-11-22": {"weight_kg": 75.2, "note": "утро"}}'], dir),
    'body.csv: добавлено 2, обновлено 0, всего 2');
  assert.strictEqual(fs.readFileSync(path.join(dir, 'body.csv'), 'utf8'),
    'date,weight_kg,note\n2026-11-21,75.4,\n2026-11-22,75.2,утро\n');
  assert.ok(!fs.existsSync(path.join(dir, 'data.js')));
  assert.strictEqual(store.raw(dir, '2026-11-22', []).tables['body.csv'][1].weight_kg, 75.2);
  assert.deepStrictEqual(csv.run(['read', 'body.csv', '1'], dir).split('\n').map(JSON.parse),
    [{date: '2026-11-22', weight_kg: '75.2', note: 'утро'}]);
  assert.strictEqual(csv.run(['remove', 'body.csv', '2026-11-21'], dir), 'body.csv: удалено 1');
  assert.deepStrictEqual(store.raw(dir, '2026-11-22', []).tables['body.csv'].map(r => r.weight_kg), [75.2]);
});

test('unknown file or command is an error, nothing written', () => {
  const dir = tmp('health-cli-');
  store.init(dir);
  assert.throws(() => csv.run(['upsert', 'weight.csv', '{}'], dir), /нет в схеме/);
  assert.throws(() => csv.run(['add', 'body.csv'], dir), /команды/);
  assert.ok(!fs.existsSync(path.join(dir, 'data.js')));
});
