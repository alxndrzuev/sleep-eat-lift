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
  return {tables: t, modules: ['photos'], updated: '2026-11-21'};
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

test('workouts: kind from the sport only (old labels file is ignored), walks dropped', () => {
  const w = (id, sport, start) => ({id, date: start.slice(0, 10), start, sport, duration_min: 60, strain: null, avg_hr: null,
    max_hr: null, kcal: 400, z0_min: null, z1_min: null, z2_min: null, z3_min: null, z4_min: null, z5_min: null});
  const r = raw({whoop_workouts: [w('1', 'activity', '2026-11-10 20:00'), w('2', 'squash', '2026-11-11 20:00'),
                                  w('3', 'activity', '2026-11-12 20:00'), w('4', 'walking', '2026-11-09 12:00'),
                                  w('5', 'weightlifting_msk', '2026-11-08 20:00')],
                 workout_labels: [{id: '1', date: '2026-11-10', start: '2026-11-10 20:00', label: 'strength', note: null},
                                  {id: '3', date: '2026-11-12', start: '2026-11-12 20:00', label: 'none', note: null}]});
  const d = build(r);
  assert.deepStrictEqual(d.workouts, [['2026-11-08 20:00', 'strength', 60, 400], ['2026-11-10 20:00', 'cardio', 60, 400],
                                      ['2026-11-11 20:00', 'cardio', 60, 400], ['2026-11-12 20:00', 'cardio', 60, 400]]);
  assert.deepStrictEqual(d.whoop_workouts.map(x => x.kind), ['cardio', 'cardio', 'cardio', 'walk', 'strength']);
});

test('series skip empty values', () => {
  const d = build(raw({body: [{date: '2026-11-01', weight_kg: 72.5, note: null}, {date: '2026-11-02', weight_kg: null, note: 'x'}]}));
  assert.deepStrictEqual(d.weight, [['2026-11-01', 72.5]]);
});

test('modules and date', () => {
  const d = build(raw());
  assert.deepStrictEqual(d.modules, ['photos']);
  assert.strictEqual(d.updated, '2026-11-21');
  for (const gone of ['k2', 'waist', 'photo_notes', 'checkins', 'labs', 'plan', 'priorities', 'photos_summary']) assert.ok(!(gone in d), gone);
});

function wo(id, sport, z, start = '2026-11-10 20:00', min = 60) {
  const r = {id, date: start.slice(0, 10), start, sport, duration_min: min, strain: null, avg_hr: null, max_hr: null, kcal: 400};
  for (let k = 0; k < 6; k++) r[`z${k}_min`] = (z || Array(6).fill(null))[k];
  return r;
}

test('strength and cardio for everyone: walks and cardio under 20 min are not workouts', () => {
  const ws = [wo('1', 'weightlifting_msk'), wo('2', 'squash'), wo('3', 'running', null, '2026-11-10 20:00', 30),
    wo('4', 'activity', null, '2026-11-10 20:00', 40), wo('5', 'dance', null, '2026-11-10 20:00', 118),
    wo('6', 'cycling', null, '2026-11-10 21:00', 15), wo('7', 'walking'), wo('8', 'functional-fitness', null, '2026-11-10 20:00', 15),
    wo('9', 'cycling', null, '2026-11-10 21:00', 15), wo('10', 'squash'), wo('11', 'activity', null, '2026-11-10 20:00', 20)];
  const d = build(raw({whoop_workouts: ws}));
  assert.deepStrictEqual(Object.fromEntries(d.whoop_workouts.map(w => [w.id, w.kind])),
    {1: 'strength', 2: 'cardio', 3: 'cardio', 4: 'cardio', 5: 'cardio', 6: 'walk', 7: 'walk', 8: 'strength', 9: 'walk', 10: 'cardio', 11: 'cardio'});
});

test('goals and plan in effect on the update day', () => {
  const t = (start, sleep_h) => ({start, kcal: null, protein: null, fat: null, carbs: null, note: null, sleep_h, strength_wk: 2, cardio_wk: null});
  const d = build(raw({targets: [t('2026-01-01', 7), t('2026-12-01', 8)],
                       plans: [{start: '2026-11-16', text: 'a'}, {start: '2026-11-01', text: 'b'}, {start: '2026-12-01', text: 'c'}]}));
  assert.strictEqual(d.goals.sleep_h, 7);
  assert.strictEqual(d.goals.strength_wk, 2);
  assert.deepStrictEqual(d.plan_now, {start: '2026-11-16', text: 'a'});
  assert.deepStrictEqual(d.plans.map(p => p.start), ['2026-11-01', '2026-11-16', '2026-12-01']);
  const e = build(raw());
  assert.ok(Object.values(e.goals).every(v => v === null));                // целей нет — все пустые
  assert.strictEqual(e.plan_now, null);
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

const tg = (start, o) => Object.assign({start, kcal: null, protein: null, fat: null, carbs: null, note: null, sleep_h: null, strength_wk: null, cardio_wk: null}, o);

test('goals per column: a later row without the value does not switch it off', () => {
  const d = build(raw({targets: [tg('2026-05-01', {sleep_h: 8, strength_wk: 2}), tg('2026-06-01', {kcal: 2100, protein: 120, fat: 60, carbs: 270})]}));
  assert.deepStrictEqual([d.goals.sleep_h, d.goals.strength_wk, d.goals.kcal, d.goals.cardio_wk], [8, 2, 2100, null]);
});

test('food targets: only rows with macros, repeated macros collapsed', () => {
  const m = {kcal: 2100, protein: 120, fat: 60, carbs: 270};
  const d = build(raw({targets: [tg('2026-01-01', m), tg('2026-06-01', Object.assign({sleep_h: 7.5}, m)),
                                 tg('2026-07-01', {sleep_h: 8}), tg('2026-08-01', Object.assign({}, m, {protein: 140}))]}));
  assert.deepStrictEqual(d.food_targets.map(t => [t.start, t.protein]), [['2026-01-01', 120], ['2026-08-01', 140]]);
  assert.deepStrictEqual(build(raw({targets: [tg('2026-07-01', {sleep_h: 8})]})).food_targets, []);
});

test('read errors and sync times go through to pages', () => {
  const d = build(Object.assign(raw(), {errors: ['body.csv: заголовок «x»'], sync: {whoop: '2026-11-21T08:00:00.000Z'}}));
  assert.deepStrictEqual(d.errors, ['body.csv: заголовок «x»']);
  assert.deepStrictEqual(d.sync, {whoop: '2026-11-21T08:00:00.000Z'});
  assert.deepStrictEqual(build(raw()).errors, []);
});

test('workouts in the last N days: exactly N calendar days up to the given day, by kind', () => {
  const w = [['2026-10-25 20:00', 'strength'], ['2026-10-26 20:00', 'strength'], ['2026-11-10 20:00', 'cardio'],
             ['2026-11-22 20:00', 'strength'], ['2026-11-23 09:00', 'cardio']];
  assert.deepStrictEqual(js(`Dataset.workoutsIn(${J(w)}, "2026-11-22", 28)`), {strength: 2, cardio: 1});   // 26.10–22.11
  assert.deepStrictEqual(js(`Dataset.workoutsIn([], "2026-11-22", 28)`), {strength: 0, cardio: 0});
});
