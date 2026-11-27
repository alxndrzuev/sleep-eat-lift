// «Питание» → окно недели: продукты из дневника FatSecret (food_entries.csv) по дням и приёмам пищи.
// Без DOM и без common.js — проверяется в Node (desktop/test/portal_foodweek.test.js); разметку строит nutrition.html.
const FoodWeek = (() => {
  const MEALS = [['breakfast', 'Завтрак'], ['lunch', 'Обед'], ['dinner', 'Ужин'], ['other', 'Перекус']];

  /** Строки food_entries → {дата: [[приём, подпись, [{name, amount}]]]}: приёмы по порядку MEALS, пустые пропущены,
   *  продукты — в порядке файла; неизвестный приём — в «Перекус». */
  function byDay(rows) {
    const out = {};
    for (const r of rows || []) {
      const meal = MEALS.some(m => m[0] === r.meal) ? r.meal : 'other';
      ((out[r.date] ||= {})[meal] ||= []).push({name: r.name == null ? '' : String(r.name), amount: r.amount == null ? '' : String(r.amount)});
    }
    for (const d of Object.keys(out)) out[d] = MEALS.filter(([k]) => out[d][k]).map(([k, label]) => [k, label, out[d][k]]);
    return out;
  }

  return {MEALS, byDay};
})();
