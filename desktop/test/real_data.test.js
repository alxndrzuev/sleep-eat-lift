// Настоящая папка данных на этом компьютере: формат файлов (только чтение, ничего не меняет); нет папки — пропуск.
// И проект: всё личное — в папке данных, в папке программы его нет.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const store = require('../store');
const {profileDir} = require('../../scripts/csv');
const {ROOT} = require('./_portal');

const DIR = profileDir();                                       // текущий профиль (у 1.x — сам корень)
const skip = !(DIR && fs.existsSync(DIR)) && 'нет папки данных на этом компьютере';
const SCHEMA = store.SCHEMA;
const TEXT = new Set(SCHEMA.text);
// файлы, убранные из схемы в 1.2: у старых папок могут остаться — приложение их не читает
const REMOVED = ['checkins.csv', 'labs.csv', 'photo_notes.csv', 'workout_labels.csv'];
const csvFiles = () => fs.readdirSync(DIR).filter(f => f.endsWith('.csv') && !REMOVED.includes(f));

test('every CSV has a schema and the right header', {skip}, () => {
  for (const name of csvFiles()) {
    assert.ok(SCHEMA.schema[name], `${name}: CSV без схемы в desktop/schema.json`);
    store.read(DIR, name);                                             // бросает, если заголовок не совпал
  }
});

test('LF only, dates in the key column', {skip}, () => {
  for (const name of csvFiles()) {
    assert.ok(!fs.readFileSync(path.join(DIR, name)).includes('\r'), name);
    const key = SCHEMA.schema[name].includes('start') ? 'start' : 'date';
    for (const r of store.read(DIR, name)) assert.match(r[key], /^\d{4}-\d{2}-\d{2}/, name);
  }
});

test('numeric columns are numbers (otherwise data.js will not build)', {skip}, () => {
  for (const name of Object.keys(SCHEMA.schema))
    store.read(DIR, name).forEach((r, i) => {
      for (const [c, v] of Object.entries(r))
        if (!TEXT.has(c) && (v || '').trim()) assert.ok(!Number.isNaN(Number(v.replace(',', '.'))), `${name}:${i + 2} ${c}`);
    });
});

test('unique keys', {skip}, () => {
  for (const name of ['nutrition_daily.csv', 'whoop_daily.csv', 'body.csv', 'alcohol_check.csv', 'whoop_workouts.csv', 'plans.csv']) {
    const k = SCHEMA.key[name] || 'date', keys = store.read(DIR, name).map(r => r[k]);
    assert.strictEqual(new Set(keys).size, keys.length, name);
  }
});

test('alcohol statuses', {skip}, () => {
  for (const r of store.read(DIR, 'alcohol_check.csv')) assert.ok(['?', 'да', 'нет'].includes(r.status), r.status);
});

test('nutrition targets: kcal ≈ 4·P + 9·F + 4·C', {skip}, () => {
  for (const r of store.read(DIR, 'targets.csv')) {
    const [k, p, f, c] = ['kcal', 'protein', 'fat', 'carbs'].map(x => Number(r[x]));
    assert.ok(Math.abs(p * 4 + f * 9 + c * 4 - k) < 150, `цель ${r.start}: БЖУ не сходятся с ккал`);
  }
});

test('program folders have no personal files', () => {
  for (const rel of ['data', 'secrets', 'logs', 'inbox', 'portal/meta.json', 'portal/data.js'])
    assert.ok(!fs.existsSync(path.join(ROOT, rel)), `${rel} должно лежать в папке данных`);
});
