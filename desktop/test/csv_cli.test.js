// scripts/csv.js — запись данных из чата теми же правилами, что в приложении (store.js); папка данных — как у SEL.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const store = require('../store');
const csv = require('../../scripts/csv');

const tmp = p => fs.mkdtempSync(path.join(os.tmpdir(), p));

test('data folder: HEALTH_DATA → folder chosen in SEL → none', () => {
  assert.strictEqual(csv.dataDir({HEALTH_DATA: '/x/data'}, '/nope'), '/x/data');
  const ud = tmp('health-ud-'), data = tmp('health-data-');
  assert.strictEqual(csv.dataDir({}, ud), null);
  fs.writeFileSync(path.join(ud, 'config.json'), JSON.stringify({dataDir: data}));
  assert.strictEqual(csv.dataDir({}, ud), data);
  fs.rmSync(data, {recursive: true});
  assert.strictEqual(csv.dataDir({}, ud), null);                     // папка пропала
});

test('upsert writes CSV and rebuilds data.js; read shows last rows; remove', () => {
  const dir = tmp('health-cli-');
  store.init(dir);
  assert.strictEqual(csv.run(['upsert', 'body.csv', '{"2026-11-21": {"weight_kg": 75.40}, "2026-11-22": {"weight_kg": 75.2, "note": "утро"}}'], dir),
    'body.csv: добавлено 2, обновлено 0, всего 2');
  assert.strictEqual(fs.readFileSync(path.join(dir, 'body.csv'), 'utf8'),
    'date,weight_kg,note\n2026-11-21,75.4,\n2026-11-22,75.2,утро\n');
  assert.match(fs.readFileSync(path.join(dir, 'data.js'), 'utf8'), /"weight_kg":75\.2/);
  assert.deepStrictEqual(csv.run(['read', 'body.csv', '1'], dir).split('\n').map(JSON.parse),
    [{date: '2026-11-22', weight_kg: '75.2', note: 'утро'}]);
  assert.strictEqual(csv.run(['remove', 'body.csv', '2026-11-21'], dir), 'body.csv: удалено 1');
  assert.doesNotMatch(fs.readFileSync(path.join(dir, 'data.js'), 'utf8'), /75\.4/);
});

test('unknown file or command is an error, nothing written', () => {
  const dir = tmp('health-cli-');
  store.init(dir);
  assert.throws(() => csv.run(['upsert', 'weight.csv', '{}'], dir), /нет в схеме/);
  assert.throws(() => csv.run(['add', 'body.csv'], dir), /команды/);
  assert.ok(!fs.existsSync(path.join(dir, 'data.js')));
});
