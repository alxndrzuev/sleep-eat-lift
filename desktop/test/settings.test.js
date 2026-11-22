// «Настройки»: цели — новой строкой с сегодняшней даты, старые не трогаем; пределы; внешние ссылки — только fatsecret.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const store = require('../store');
const settings = require('../settings');

function tmp() {
  const dir = store.dataDir(fs.mkdtempSync(path.join(os.tmpdir(), 'health-set-')));
  store.init(dir);
  return dir;
}

test('new row from today, old untouched', () => {
  const dir = tmp();
  store.upsert(dir, 'targets.csv', {'2026-01-01': {kcal: 2100, protein: 120, fat: 60, carbs: 270}});
  assert.deepStrictEqual(settings.saveTargets(dir, {kcal: 2300, protein: 140, goalWeight: 80}, '2026-11-21'), {ok: true});
  const t = store.read(dir, 'targets.csv');
  assert.deepStrictEqual(t.map(r => [r.start, r.kcal, r.protein, r.fat, r.note]),
    [['2026-01-01', '2100', '120', '60', ''], ['2026-11-21', '2180', '140', '60', 'из настроек']]);   // ккал — из БЖУ: 560 + 540 + 1080
  assert.deepStrictEqual(store.read(dir, 'goal_weight.csv'), [{date: '2026-11-21', goal_weight_kg: '80', note: 'из настроек'}]);
});

test('empty fields keep previous values; nothing given — nothing written', () => {
  const dir = tmp();
  assert.deepStrictEqual(settings.saveTargets(dir, {}, '2026-11-21'), {ok: true});
  assert.deepStrictEqual(store.read(dir, 'targets.csv'), []);
  assert.deepStrictEqual(store.read(dir, 'goal_weight.csv'), []);
});

test('out of range rejected, files untouched', () => {
  const dir = tmp();
  assert.deepStrictEqual(settings.saveTargets(dir, {kcal: 200}, '2026-11-21'), {ok: false, error: 'Калории — от 1000 до 6000'});
  assert.deepStrictEqual(settings.saveTargets(dir, {protein: 700}, '2026-11-21'), {ok: false, error: 'Белки — от 0 до 600 г'});
  assert.deepStrictEqual(settings.saveTargets(dir, {goalWeight: 20}, '2026-11-21'), {ok: false, error: 'Целевой вес — от 30 до 250 кг'});
  assert.deepStrictEqual(settings.saveTargets(dir, {kcal: 'abc'}, '2026-11-21'), {ok: false, error: 'Калории — от 1000 до 6000'});
  assert.deepStrictEqual(store.read(dir, 'targets.csv'), []);
});

test('openExternal allows only fatsecret and whoop links', () => {
  for (const u of ['https://www.fatsecret.com', 'https://platform.fatsecret.com/terms', 'https://www.whoop.com'])
    assert.ok(settings.externalAllowed(u), u);
  for (const u of ['https://evil.com', 'http://www.fatsecret.com', 'file:///etc/passwd', 'https://www.fatsecret.com.evil.com/'])
    assert.ok(!settings.externalAllowed(u), u);
});

test('historical target: row from the given date, merged with target in effect then', () => {
  const dir = tmp();
  store.upsert(dir, 'targets.csv', {'2026-01-01': {kcal: 2100, protein: 120, fat: 60, carbs: 270}, '2026-06-01': {kcal: 2400, protein: 140, fat: 70, carbs: 300}});
  assert.deepStrictEqual(settings.saveTargets(dir, {date: '2026-03-15', kcal: 2000}, '2026-11-21'), {ok: true});
  const r = store.read(dir, 'targets.csv').find(x => x.start === '2026-03-15');
  assert.deepStrictEqual([r.kcal, r.protein, r.fat, r.carbs], ['2100', '120', '60', '270']);   // ккал — из БЖУ, а не из поля
  assert.strictEqual(store.read(dir, 'targets.csv').length, 3);
  settings.saveTargets(dir, {date: '2025-12-01', goalWeight: 78}, '2026-11-21');
  assert.deepStrictEqual(store.read(dir, 'goal_weight.csv'), [{date: '2025-12-01', goal_weight_kg: '78', note: 'из настроек'}]);
});

test('date must be a real past-or-today date', () => {
  const dir = tmp();
  for (const d of ['2026-11-22', '2026-02-30', '21.11.2026', '1999-12-31'])
    assert.deepStrictEqual(settings.saveTargets(dir, {date: d, kcal: 2000}, '2026-11-21'),
      {ok: false, error: 'Дата — не раньше 2000 года и не позже сегодня'}, d);
  assert.deepStrictEqual(store.read(dir, 'targets.csv'), []);
});

test('removeTarget deletes one row by date', () => {
  const dir = tmp();
  store.upsert(dir, 'targets.csv', {'2026-01-01': {kcal: 2100}, '2026-03-01': {kcal: 2000}});
  store.upsert(dir, 'goal_weight.csv', {'2026-01-01': {goal_weight_kg: 80}});
  assert.deepStrictEqual(settings.removeTarget(dir, 'targets', '2026-03-01'), {ok: true, removed: 1});
  assert.deepStrictEqual(store.read(dir, 'targets.csv').map(r => r.start), ['2026-01-01']);
  assert.deepStrictEqual(settings.removeTarget(dir, 'goal_weight', '2026-01-01'), {ok: true, removed: 1});
  assert.deepStrictEqual(settings.removeTarget(dir, 'body', '2026-01-01'), {ok: false, error: 'Неизвестный вид цели'});
});

test('kcal computed from macros: 4·Б + 9·Ж + 4·У (blank macros taken from target in effect)', () => {
  const dir = tmp();
  assert.deepStrictEqual(settings.saveTargets(dir, {protein: 120, fat: 60, carbs: 270}, '2026-11-01'), {ok: true});
  assert.strictEqual(store.read(dir, 'targets.csv')[0].kcal, '2100');                 // 480 + 540 + 1080
  settings.saveTargets(dir, {protein: 140}, '2026-11-21');                            // Ж и У — из цели на эту дату
  const r = store.read(dir, 'targets.csv').find(x => x.start === '2026-11-21');
  assert.deepStrictEqual([r.kcal, r.protein, r.fat, r.carbs], ['2180', '140', '60', '270']);
  assert.strictEqual(settings.kcalOf(150, 70.5, 300), 2435);
  assert.strictEqual(settings.kcalOf(150, null, 300), null);
});

// ---------- цели сна и тренировок ----------
test('sleep goal alone keeps nutrition and workout goals', () => {
  const dir = tmp();
  store.upsert(dir, 'targets.csv', {'2026-01-01': {protein: 120, fat: 60, carbs: 270, kcal: 2100, strength_wk: 2, cardio_wk: 2}});
  assert.deepStrictEqual(settings.saveTargets(dir, {sleep: '7,5'}, '2026-11-21'), {ok: true});
  const r = store.read(dir, 'targets.csv').find(x => x.start === '2026-11-21');
  assert.deepStrictEqual([r.sleep_h, r.protein, r.fat, r.carbs, r.kcal, r.strength_wk, r.cardio_wk], ['7.5', '120', '60', '270', '2100', '2', '2']);
  settings.saveTargets(dir, {date: '2026-11-21', cardio: 3}, '2026-11-21');          // та же дата — правим строку, сон остаётся
  const r2 = store.read(dir, 'targets.csv').find(x => x.start === '2026-11-21');
  assert.deepStrictEqual([r2.sleep_h, r2.strength_wk, r2.cardio_wk], ['7.5', '2', '3']);
});

test('workout and sleep goals out of range', () => {
  const dir = tmp();
  assert.deepStrictEqual(settings.saveTargets(dir, {strength: 15}, '2026-11-21'), {ok: false, error: 'Силовые — от 0 до 14 в неделю'});
  assert.deepStrictEqual(settings.saveTargets(dir, {cardio: -1}, '2026-11-21'), {ok: false, error: 'Кардио — от 0 до 14 в неделю'});
  assert.deepStrictEqual(settings.saveTargets(dir, {sleep: 3}, '2026-11-21'), {ok: false, error: 'Сон — от 4 до 12 ч'});
  assert.deepStrictEqual(store.read(dir, 'targets.csv'), []);
});

// ---------- план ----------
test('plan: new version by date, same date replaces, empty refused, remove', () => {
  const dir = tmp();
  const text = 'Сон 7,5+ ч, "отбой" до 23:30\nСиловые 2 в неделю\n<b>не разметка</b>';
  assert.deepStrictEqual(settings.savePlan(dir, {date: '2026-11-16', text: '  ' + text + '\n'}, '2026-11-21'), {ok: true});
  assert.deepStrictEqual(settings.savePlan(dir, {text: 'v2'}, '2026-11-21'), {ok: true});
  assert.deepStrictEqual(store.read(dir, 'plans.csv').map(r => [r.start, r.text]), [['2026-11-16', text], ['2026-11-21', 'v2']]);
  settings.savePlan(dir, {date: '2026-11-21', text: 'v3'}, '2026-11-21');
  assert.deepStrictEqual(store.read(dir, 'plans.csv').map(r => r.text), [text, 'v3']);
  assert.deepStrictEqual(settings.savePlan(dir, {text: ' \n '}, '2026-11-21'), {ok: false, error: 'Пустой план'});
  assert.deepStrictEqual(settings.savePlan(dir, {text: 'x'.repeat(20001)}, '2026-11-21'), {ok: false, error: 'План — не длиннее 20 000 символов'});
  assert.deepStrictEqual(settings.savePlan(dir, {date: '2026-11-22', text: 'x'}, '2026-11-21'), {ok: false, error: 'Дата — не раньше 2000 года и не позже сегодня'});
  assert.deepStrictEqual(settings.removePlan(dir, '2026-11-16'), {ok: true, removed: 1});
  assert.deepStrictEqual(store.read(dir, 'plans.csv').map(r => r.start), ['2026-11-21']);
});

// ---------- БАДы ----------
test('supplements: two on the same day — stop and remove touch only the chosen one', () => {
  const dir = tmp();
  assert.deepStrictEqual(settings.addSupplement(dir, {start: '2026-11-19', name: 'A', dose: '1 таб.', timing: 'утром', purpose: 'x, "y"', note: ''}, '2026-11-21'), {ok: true});
  assert.deepStrictEqual(settings.addSupplement(dir, {start: '2026-11-19', name: 'B'}, '2026-11-21'), {ok: true});
  assert.deepStrictEqual(settings.stopSupplement(dir, {start: '2026-11-19', name: 'A', end: '2026-11-20'}, '2026-11-21'), {ok: true});
  let rows = store.read(dir, 'supplements.csv');
  assert.deepStrictEqual(rows.map(r => [r.name, r.end, r.dose, r.purpose]), [['A', '2026-11-20', '1 таб.', 'x, "y"'], ['B', '', '', '']]);
  assert.deepStrictEqual(settings.removeSupplement(dir, {start: '2026-11-19', name: 'B'}), {ok: true});
  rows = store.read(dir, 'supplements.csv');
  assert.deepStrictEqual(rows.map(r => r.name), ['A']);
});

test('supplement: start and end default to today', () => {
  const dir = tmp();
  settings.addSupplement(dir, {name: 'C'}, '2026-11-21');
  assert.strictEqual(store.read(dir, 'supplements.csv')[0].start, '2026-11-21');
  settings.stopSupplement(dir, {start: '2026-11-21', name: 'C'}, '2026-11-21');
  assert.strictEqual(store.read(dir, 'supplements.csv')[0].end, '2026-11-21');
});

test('supplement validation', () => {
  const dir = tmp();
  const T = '2026-11-21';
  assert.deepStrictEqual(settings.addSupplement(dir, {name: '  '}, T), {ok: false, error: 'Название БАДа — обязательно'});
  assert.deepStrictEqual(settings.addSupplement(dir, {name: 'x'.repeat(201)}, T), {ok: false, error: 'Поля БАДа — не длиннее 200 символов'});
  assert.deepStrictEqual(settings.addSupplement(dir, {name: 'A', start: '2026-11-22'}, T), {ok: false, error: 'Дата — не раньше 2000 года и не позже сегодня'});
  settings.addSupplement(dir, {name: 'A', start: '2026-11-10'}, T);
  assert.deepStrictEqual(settings.addSupplement(dir, {name: 'A', start: '2026-11-10'}, T), {ok: false, error: 'Этот БАД с этой даты уже есть'});
  assert.deepStrictEqual(settings.stopSupplement(dir, {start: '2026-11-10', name: 'A', end: '2026-11-09'}, T), {ok: false, error: 'Дата конца — не раньше начала'});
  assert.deepStrictEqual(settings.stopSupplement(dir, {start: '2026-11-10', name: 'Z'}, T), {ok: false, error: 'БАД не найден'});
  assert.deepStrictEqual(settings.removeSupplement(dir, {start: '2026-11-10', name: 'Z'}), {ok: false, error: 'БАД не найден'});
  assert.strictEqual(store.read(dir, 'supplements.csv').length, 1);
});
