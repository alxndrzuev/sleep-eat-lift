/* Расчёт данных портала из сырых таблиц. data.js (const RAW = {tables: {"<имя>.csv": [строки]}, meta, modules, updated})
   пишет приложение (desktop/store.js). Подключается сразу после ../data/data.js; создаёт глобальный DATA, с которым работают страницы. */
var Dataset = (function () {
  const FULL_DAY_KCAL = 1200;   // дни в FatSecret меньше — «не заполнен», в средние не идут (lib.FULL_DAY_KCAL)
  const STRENGTH = ["weightlifting_msk", "functional-fitness", "powerlifting", "weightlifting"];
  const LABELS = ["strength", "squash", "cardio", "other", "none"];   // метки пользователя (workout_labels.csv)
  const SHORT_CARDIO_MIN = 20;  // кардио короче — не тренировка (разминка или заминка на велосипеде после силовой)
  const GOAL_HIT = 0.15, GOAL_NEAR = 0.30;   // день питания: Б, Ж, У в пределах ±15 % от цели — выполнил, до ±30 % — рядом, дальше — мимо
  const MACROS = [["p", "protein", "белок"], ["f", "fat", "жиры"], ["c", "carbs", "углеводы"]];   // [поле дня, поле цели, подпись]

  /** Округление до 0,1 как Python round(x, 1): по точному значению числа, ровно половина — к чётному (как desktop/pyround.js). */
  function round1(x) {
    let r = Number(x.toFixed(1));
    const s = Math.abs(x).toFixed(61), tail = s.slice(s.indexOf(".") + 2);
    if (/^50*$/.test(tail) && Math.round(Math.abs(r) * 10) % 2 !== 0) r = Number((r - Math.sign(x) * 0.1).toFixed(1));
    return r;
  }

  /** Отклонения Б, Ж, У дня от цели: [{lab, diff, dev}] — только где есть и значение, и цель; dev — доля от цели. */
  function macroDevs(day, goal) {
    return MACROS.filter(([d, g]) => day && day[d] != null && goal && goal[g])
      .map(([d, g, lab]) => ({lab, diff: day[d] - goal[g], dev: Math.abs(day[d] - goal[g]) / goal[g]}));
  }

  /** День питания ({k, p, f, c} против цели {kcal, protein, fat, carbs}): empty — не записал, partial — меньше 1200 ккал,
      full — сравнить не с чем; иначе по самому далёкому от цели из Б, Ж, У (калории не влияют): hit ≤ 15 %, near ≤ 30 %,
      miss — больше. */
  function foodDay(day, goal) {
    if (!day || !day.k) return "empty";
    if (day.k < FULL_DAY_KCAL) return "partial";
    const devs = macroDevs(day, goal);
    if (!devs.length) return "full";
    const worst = Math.max(...devs.map(x => x.dev));
    return worst <= GOAL_HIT ? "hit" : worst <= GOAL_NEAR ? "near" : "miss";
  }

  /** Вид тренировки — одинаково у всех: strength (силовые виды Whoop) / cardio (всё остальное, в т. ч. сквош и вид
      «не указан») / walk (не тренировка: прогулка, кардио короче 20 минут, метка none). Метка пользователя главнее вида. */
  function workoutKind(w, labels) {
    const lab = labels && labels[String(w.id)];
    if (lab && LABELS.includes(lab.label)) return lab.label === "none" ? "walk" : lab.label === "strength" ? "strength" : "cardio";
    const s = String(w.sport || "").toLowerCase();
    if (STRENGTH.includes(s)) return "strength";
    if (s === "walking") return "walk";
    return Number(w.duration_min) < SHORT_CARDIO_MIN ? "walk" : "cardio";
  }

  const GOAL_COLS = ["kcal", "protein", "fat", "carbs", "sleep_h", "strength_wk", "cardio_wk"];
  const FOOD_COLS = ["kcal", "protein", "fat", "carbs"];

  /** Цели на день ds — по каждой колонке своя: последняя строка targets.csv с start ≤ ds, где значение есть
      (строка, где поле пустое, цель не отменяет — «пустое — как в действовавшей цели»). */
  function goalsOn(rows, ds) {
    const sorted = rows.filter(r => r.start && r.start <= ds).sort((a, b) => (a.start < b.start ? -1 : 1)), g = {};
    for (const c of GOAL_COLS) { g[c] = null; for (const r of sorted) if (r[c] != null) g[c] = r[c]; }
    return g;
  }

  /** Строки целей по питанию: только с КБЖУ, по дате; повтор тех же КБЖУ (поменяли сон или тренировки) — не новая цель. */
  function foodTargets(rows) {
    const same = (a, b) => FOOD_COLS.every(c => a[c] === b[c]);
    return rows.filter(r => r.start && FOOD_COLS.some(c => r[c] != null)).sort((a, b) => (a.start < b.start ? -1 : 1))
      .reduce((out, r) => { if (!out.length || !same(out[out.length - 1], r)) out.push(r); return out; }, []);
  }

  /** Строка таблицы с колонкой start, действующая на день ds (последняя с start ≤ ds), или null. */
  function inEffect(rows, ds) {
    return rows.filter(r => r.start && r.start <= ds).sort((a, b) => (a.start < b.start ? -1 : 1)).pop() || null;
  }

  function cmp(a, b) {        // сравнение списков по элементам, как sorted() в Python
    for (let i = 0; i < Math.max(a.length, b.length); i++) {
      if (a[i] === b[i]) continue;
      if (a[i] == null) return -1;
      if (b[i] == null) return 1;
      return a[i] < b[i] ? -1 : 1;
    }
    return 0;
  }

  function build(raw) {
    const T = name => (raw.tables[name + ".csv"] || []);
    const d = {};
    const body = T("body");
    d.weight = body.filter(b => b.weight_kg != null).map(b => [b.date, b.weight_kg]);

    const nut = T("nutrition_daily");
    d.kcal = nut.filter(n => n.kcal != null).map(n => [n.date, n.kcal]);
    d.nutrition = nut.filter(n => n.protein != null).map(n => [n.date, n.kcal, n.protein, n.fat, n.carbs]);
    const byM = {};
    for (const [dt, k, p, f, c] of d.nutrition)
      if ((k || 0) >= FULL_DAY_KCAL) (byM[dt.slice(0, 7)] ||= []).push([p || 0, f || 0, c || 0]);
    d.macros_month = {};
    for (const m of Object.keys(byM).sort())
      d.macros_month[m] = [0, 1, 2].map(i => round1(byM[m].reduce((s, x) => s + x[i], 0) / byM[m].length));

    const wd = T("whoop_daily");
    for (const [key, col] of [["sleep", "sleep_h"], ["rhr", "rhr"], ["steps", "steps"]])
      d[key] = wd.filter(r => r[col] != null).map(r => [r.date, r[col]]);
    const labels = {};
    for (const l of T("workout_labels")) labels[String(l.id)] = l;
    const ww = T("whoop_workouts").map(w => Object.assign({}, w, {kind: workoutKind(w, labels)}));
    d.workouts = ww.filter(w => w.kind !== "walk").map(w => [w.start, w.kind, w.duration_min, w.kcal]).sort(cmp);
    d.whoop_daily = wd;
    d.whoop_workouts = ww;
    for (const name of ["supplements", "events", "targets", "goal_weight", "alcohol_check", "plans"])
      d[name] = T(name);
    d.plans = d.plans.slice().sort((x, y) => (x.start < y.start ? -1 : 1));
    d.goals = goalsOn(d.targets, raw.updated);             // цели на сегодня: КБЖУ, сон, тренировки в неделю
    d.food_targets = foodTargets(d.targets);               // цели по питанию — для «Питания» и сводки
    const p = inEffect(d.plans, raw.updated);
    d.plan_now = p ? {start: p.start, text: p.text} : null;
    d.updated = raw.updated;
    Object.assign(d, raw.meta || {});
    d.modules = raw.modules || [];
    return d;
  }

  return {build, workoutKind, round1, foodDay, macroDevs, GOAL_HIT, GOAL_NEAR};
})();

if (typeof RAW !== "undefined") var DATA = Dataset.build(RAW);
