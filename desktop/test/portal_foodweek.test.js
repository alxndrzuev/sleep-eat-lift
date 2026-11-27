// «Питание» → окно недели: продукты из дневника по дням и приёмам пищи (portal/foodweek.js — без DOM).
const test = require('node:test');
const assert = require('node:assert');
const {load} = require('./_portal');

const js = load('foodweek.js');
const row = (id, date, meal, name, amount = '') => ({id, date, meal, name, amount});

test('byDay: meals in order, unknown meal goes to «Перекус», products in file order, empty days absent', () => {
  const rows = [row('1', '2026-11-24', 'dinner', 'Лосось', '130 г'), row('2', '2026-11-23', 'lunch', 'Гречка'),
                row('3', '2026-11-24', 'breakfast', 'Каша'), row('4', '2026-11-24', 'brunch', 'Сырник'),
                row('5', '2026-11-24', 'dinner', 'Рис', '150 г')];
  const d = js(`FoodWeek.byDay(${JSON.stringify(rows)})`);
  assert.deepStrictEqual(Object.keys(d).sort(), ['2026-11-23', '2026-11-24']);
  assert.deepStrictEqual(d['2026-11-24'].map(([k, label, list]) => [k, label, list.map(x => x.name)]),
    [['breakfast', 'Завтрак', ['Каша']], ['dinner', 'Ужин', ['Лосось', 'Рис']], ['other', 'Перекус', ['Сырник']]]);
  assert.deepStrictEqual(d['2026-11-24'][1][2][0], {name: 'Лосось', amount: '130 г'});
  assert.deepStrictEqual(js('FoodWeek.MEALS.map(m => m[1])'), ['Завтрак', 'Обед', 'Ужин', 'Перекус']);
});
