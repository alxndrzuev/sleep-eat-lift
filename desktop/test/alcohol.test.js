// Ответы на «похоже на алкоголь?» в приложении: статус по утру, событие «алкоголь» на вечер (как telegram.set_alcohol).
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const store = require('../store');
const alcohol = require('../alcohol');

function tmp() {
  const dir = store.dataDir(fs.mkdtempSync(path.join(os.tmpdir(), 'health-alc-')));
  store.init(dir);
  store.upsert(dir, 'alcohol_check.csv', {'2026-11-16': {hrv_dev_pct: -32, status: '?', kind: 'алкоголь?'}});
  return dir;
}

test('yes: status да and alcohol event on the evening before', () => {
  const dir = tmp();
  store.write(dir, 'events.csv', [{start: '2026-11-15', end: '2026-11-15', type: 'поездка', description: 'Питер'}]);
  assert.deepStrictEqual(alcohol.answer(dir, '2026-11-16', true), {ok: true});
  assert.strictEqual(store.read(dir, 'alcohol_check.csv')[0].status, 'да');
  const ev = store.read(dir, 'events.csv');
  assert.deepStrictEqual(ev.map(e => [e.start, e.type]), [['2026-11-15', 'поездка'], ['2026-11-15', 'алкоголь']]);   // поездку не затёрли
  alcohol.answer(dir, '2026-11-16', true);                                                                         // второй раз — без дублей
  assert.strictEqual(store.read(dir, 'events.csv').length, 2);
});

test('no after yes: status нет and the app-made event removed', () => {
  const dir = tmp();
  alcohol.answer(dir, '2026-11-16', true);
  alcohol.answer(dir, '2026-11-16', false);
  assert.strictEqual(store.read(dir, 'alcohol_check.csv')[0].status, 'нет');
  assert.deepStrictEqual(store.read(dir, 'events.csv'), []);
});

test('unknown morning or bad date rejected', () => {
  const dir = tmp();
  assert.deepStrictEqual(alcohol.answer(dir, '2026-11-01', true), {ok: false, error: 'Нет такой ночи в разметке'});
  assert.deepStrictEqual(alcohol.answer(dir, '../x', true), {ok: false, error: 'Нет такой ночи в разметке'});
});

test('fromDate: last 30 days', () => {
  assert.strictEqual(alcohol.fromDate('2026-11-21'), '2026-10-22');
});

test('answer with level: event gets level; changing level updates the same event', () => {
  const dir = tmp();
  assert.deepStrictEqual(alcohol.answer(dir, '2026-11-16', 'умеренно'), {ok: true});
  assert.deepStrictEqual(store.read(dir, 'events.csv').map(e => [e.start, e.type, e.level]), [['2026-11-15', 'алкоголь', 'умеренно']]);
  alcohol.answer(dir, '2026-11-16', 'много');
  assert.deepStrictEqual(store.read(dir, 'events.csv').map(e => e.level), ['много']);
  assert.deepStrictEqual(alcohol.answer(dir, '2026-11-16', 'литр'), {ok: false, error: 'Неизвестный ответ'});
});

test('add manually: event with level, pending morning closed; existing event updated, not duplicated', () => {
  const dir = tmp();                                                     // утро 16-го под вопросом → вечер 15-го
  assert.deepStrictEqual(alcohol.add(dir, '2026-11-15', 'мало', 'день рождения', '2026-11-21'), {ok: true});
  assert.deepStrictEqual(store.read(dir, 'events.csv').map(e => [e.start, e.level, e.description]), [['2026-11-15', 'мало', 'день рождения']]);
  assert.strictEqual(store.read(dir, 'alcohol_check.csv')[0].status, 'да');
  alcohol.add(dir, '2026-11-15', 'много', '', '2026-11-21');
  assert.deepStrictEqual(store.read(dir, 'events.csv').map(e => [e.level, e.description]), [['много', 'день рождения']]);
  assert.deepStrictEqual(alcohol.add(dir, '2026-11-25', 'мало', '', '2026-11-21'), {ok: false, error: 'Дата — не позже сегодня'});
  assert.deepStrictEqual(alcohol.add(dir, '2026-11-10', 'бочка', '', '2026-11-21'), {ok: false, error: 'Выберите: мало, умеренно или много'});
});

test('remove evening: event gone; morning with signal back to «?», morning from events only removed', () => {
  const dir = tmp();
  alcohol.add(dir, '2026-11-15', 'мало', '', '2026-11-21');               // утро 16-го — с сигналом Whoop
  alcohol.add(dir, '2026-11-01', 'умеренно', '', '2026-11-21');           // без сигнала
  alcohol.mark(dir, {from: '2026-10-01'});                                // строка 2026-11-02 «из событий»
  assert.deepStrictEqual(alcohol.removeEvening(dir, '2026-11-15'), {ok: true});
  assert.deepStrictEqual(alcohol.removeEvening(dir, '2026-11-01'), {ok: true});
  assert.deepStrictEqual(store.read(dir, 'events.csv'), []);
  assert.deepStrictEqual(store.read(dir, 'alcohol_check.csv').map(r => [r.date, r.status]), [['2026-11-16', '?']]);
});

test('set level: changes level of the marked evening, keeps note; old «да» without event gets one; unmarked rejected', () => {
  const dir = tmp();
  alcohol.add(dir, '2026-11-15', 'мало', 'день рождения', '2026-11-21');
  assert.deepStrictEqual(alcohol.setLevel(dir, '2026-11-15', 'много'), {ok: true});
  assert.deepStrictEqual(store.read(dir, 'events.csv').map(e => [e.start, e.level, e.description]), [['2026-11-15', 'много', 'день рождения']]);
  store.upsert(dir, 'alcohol_check.csv', {'2026-11-11': {status: 'да', kind: 'алкоголь?'}});   // старая отметка без события
  assert.deepStrictEqual(alcohol.setLevel(dir, '2026-11-10', 'умеренно'), {ok: true});
  assert.deepStrictEqual(store.read(dir, 'events.csv').map(e => [e.start, e.level]), [['2026-11-10', 'умеренно'], ['2026-11-15', 'много']]);
  assert.deepStrictEqual(alcohol.setLevel(dir, '2026-11-01', 'мало'), {ok: false, error: 'Этот вечер не отмечен'});
  assert.deepStrictEqual(alcohol.setLevel(dir, '2026-11-15', 'бочка'), {ok: false, error: 'Выберите: мало, умеренно или много'});
  assert.deepStrictEqual(alcohol.setLevel(dir, '../x', 'мало'), {ok: false, error: 'Неверная дата'});
  assert.strictEqual(store.read(dir, 'alcohol_check.csv').length, 2);                    // разметку утр не трогает
});
