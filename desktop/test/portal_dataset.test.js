// portal/dataset.js — расчёт DATA из сырых таблиц RAW (общий для всех страниц приложения).
const test = require('node:test');
const assert = require('node:assert');
const {load, source, J} = require('./_portal');
const SCHEMA = require('../schema.json');

const js = load('dataset.js');
const build = raw => js(`Dataset.build(${J(raw)})`);

/** RAW с пустыми таблицами, кроме переданных (имя без .csv). */
function raw(tables = {}) {
  const t = Object.fromEntries(Object.keys(SCHEMA.schema).map(n => [n, []]));
  for (const [k, v] of Object.entries(tables)) t[k + '.csv'] = v;
  return {tables: t, meta: {plan: {targets: {}}, journal: [], photos_summary: '', priorities: []}, modules: ['photos'], updated: '2026-11-21'};
}

test('full day threshold: dataset.js = schema.json (1200 kcal)', () => {
  assert.strictEqual(Number(source('dataset.js').match(/const FULL_DAY_KCAL = (\d+)/)[1]), SCHEMA.full_day_kcal);
});

test('macros by month — full days only', () => {
  const d = build(raw({nutrition_daily: [
    {date: '2026-11-01', kcal: 2000, protein: 100, fat: 60, carbs: 250, fiber: null},
    {date: '2026-11-02', kcal: 900, protein: 10, fat: 5, carbs: 100, fiber: null},
    {date: '2026-11-03', kcal: 2200, protein: 121, fat: 70, carbs: 260, fiber: null}]}));
  assert.deepStrictEqual(d.macros_month, {'2026-11': [110.5, 65.0, 255.0]});
  assert.deepStrictEqual(d.kcal, [['2026-11-01', 2000], ['2026-11-02', 900], ['2026-11-03', 2200]]);
  assert.deepStrictEqual(d.nutrition[1], ['2026-11-02', 900, 10, 5, 100]);
});

test('workouts: user label overrides Whoop, walks dropped', () => {
  const w = (id, sport, start) => ({id, date: start.slice(0, 10), start, sport, duration_min: 60, strain: null, avg_hr: null,
    max_hr: null, kcal: 400, z0_min: null, z1_min: null, z2_min: null, z3_min: null, z4_min: null, z5_min: null});
  const r = raw({whoop_workouts: [w('1', 'activity', '2026-11-10 20:00'), w('2', 'squash', '2026-11-11 20:00'),
                                  w('3', 'activity', '2026-11-12 20:00'), w('4', 'walking', '2026-11-09 12:00'),
                                  w('5', 'weightlifting_msk', '2026-11-08 20:00')],
                 workout_labels: [{id: '1', date: '2026-11-10', start: '2026-11-10 20:00', label: 'strength', note: null},
                                  {id: '3', date: '2026-11-12', start: '2026-11-12 20:00', label: 'none', note: null}]});
  r.meta.plan.workouts = {strength: 2, squash: 2};                     // режим «сквош» — сквош в плане
  const d = build(r);
  assert.deepStrictEqual(d.workouts, [['2026-11-08 20:00', 'strength', 60, 400], ['2026-11-10 20:00', 'strength', 60, 400],
                                      ['2026-11-11 20:00', 'squash', 60, 400]]);
  assert.deepStrictEqual(d.whoop_workouts.map(x => x.kind), ['strength', 'squash', 'walk', 'walk', 'strength']);
});

test('series skip empty values', () => {
  const d = build(raw({body: [{date: '2026-11-01', weight_kg: 72.5, waist_cm: null, bodyfat_pct: null, note: null},
                              {date: '2026-11-02', weight_kg: null, waist_cm: 81, bodyfat_pct: null, note: null}]}));
  assert.deepStrictEqual(d.weight, [['2026-11-01', 72.5]]);
  assert.deepStrictEqual(d.waist, [['2026-11-02', 81]]);
});

test('photo notes map and meta', () => {
  const r = raw({photo_notes: [{date: '2026-07-12', note: 'x'}]});
  r.meta.priorities = [['Самочувствие', 'главное']];
  const d = build(r);
  assert.deepStrictEqual(d.photo_notes, {'2026-07-12': 'x'});
  assert.deepStrictEqual(d.priorities, [['Самочувствие', 'главное']]);
  assert.deepStrictEqual(d.modules, ['photos']);
  assert.strictEqual(d.updated, '2026-11-21');
});

function wo(id, sport, z, start = '2026-11-10 20:00') {
  const r = {id, date: start.slice(0, 10), start, sport, duration_min: 60, strain: null, avg_hr: null, max_hr: null, kcal: 400};
  for (let k = 0; k < 6; k++) r[`z${k}_min`] = (z || Array(6).fill(null))[k];
  return r;
}

test('cardio mode without squash in plan: activity by heart-rate zones', () => {
  const ws = [wo('1', 'running'), wo('2', 'cycling'), wo('3', 'squash'), wo('4', 'weightlifting_msk'),
    wo('5', 'walking'), wo('6', 'activity', [5, 10, 20, 15, 5, 5]),           // зоны 2–5: 45 из 60 → кардио
    wo('7', 'activity', [30, 20, 5, 5, 0, 0]),                                // 10 из 60 → другое
    wo('8', 'activity'), wo('9', 'yoga'), wo('10', 'hiit'), wo('11', 'tennis')];
  const d = build(raw({whoop_workouts: ws, workout_labels: [{id: '9', date: null, start: null, label: 'squash', note: null}]}));
  assert.deepStrictEqual(Object.fromEntries(d.whoop_workouts.map(w => [w.id, w.kind])),
    {1: 'cardio', 2: 'cardio', 3: 'cardio', 4: 'strength', 5: 'walk', 6: 'cardio', 7: 'other', 8: 'other', 9: 'cardio', 10: 'cardio', 11: 'cardio'});
  assert.deepStrictEqual(d.k2, {key: 'cardio', lab: 'Кардио', many: 'кардио'});
});

test('squash mode with squash in plan', () => {
  const r = raw({whoop_workouts: [wo('1', 'squash'), wo('2', 'running'), wo('3', 'activity', [0, 0, 30, 30, 0, 0])]});
  r.meta.plan.workouts = {strength: 2, squash: 2};
  const d = build(r);
  assert.deepStrictEqual(Object.fromEntries(d.whoop_workouts.map(w => [w.id, w.kind])), {1: 'squash', 2: 'other', 3: 'other'});
  assert.deepStrictEqual(d.k2, {key: 'squash', lab: 'Сквош', many: 'сквоша'});
});

test('food day by worst of P/F/C: ±15 % hit, ±30 % near, else miss; kcal does not matter', () => {
  const g = {kcal: 2200, protein: 120, fat: 60, carbs: 270};
  const day = ({k = 2200, p = 120, f = 60, c = 270} = {}) => ({k, p, f, c});
  const cases = [['ровно', day(), g, 'hit'],
    ['ккал мимо, БЖУ ровно', day({k: 3500}), g, 'hit'],
    ['Б +15 %', day({p: 138}), g, 'hit'], ['Б −15 %', day({p: 102}), g, 'hit'],
    ['Б +15,8 %', day({p: 139}), g, 'near'],
    ['Ж +30 %', day({f: 78}), g, 'near'], ['Ж +31,7 %', day({f: 79}), g, 'miss'],
    ['У −30 %', day({c: 189}), g, 'near'], ['У −30,4 %', day({c: 188}), g, 'miss'],
    ['худший решает', day({p: 125, f: 70, c: 150}), g, 'miss'],
    ['белка нет в дневнике', {k: 2200, p: null, f: 62, c: 270}, g, 'hit'],
    ['неполный', day({k: 1199, p: 10}), g, 'partial'], ['ноль', day({k: 0}), g, 'empty'], ['нет записи', null, g, 'empty'],
    ['цели нет', day(), {kcal: null, protein: null, fat: null, carbs: null}, 'full']];
  const got = js('[' + cases.map(([, d, t]) => `Dataset.foodDay(${J(d)}, ${J(t)})`).join(',') + ']');
  assert.deepStrictEqual(Object.fromEntries(cases.map(([n], i) => [n, got[i]])), Object.fromEntries(cases.map(([n, , , w]) => [n, w])));
});
