/* Расчёт данных портала из сырых таблиц. data.js (const RAW = {tables: {"<имя>.csv": [строки]}, meta, modules, updated})
   пишет приложение (desktop/store.js). Подключается сразу после ../data/data.js; создаёт глобальный DATA, с которым работают страницы. */
var Dataset = (function () {
  const FULL_DAY_KCAL = 1200;   // дни в FatSecret меньше — «не заполнен», в средние не идут (lib.FULL_DAY_KCAL)
  const STRENGTH = ["weightlifting_msk", "functional-fitness", "powerlifting", "weightlifting"];
  const LABELS = ["strength", "squash", "cardio", "other", "none"];   // метки пользователя (workout_labels.csv)
  // кардио (у кого в плане нет сквоша): циклические, игровые, единоборства, интервальные
  const CARDIO = ["running", "cycling", "spin", "mountain-biking", "swimming", "rowing", "elliptical", "stairmaster", "stair-climbing",
    "hiking", "rucking", "skiing", "cross-country-skiing", "snowboarding", "skating", "inline-skating", "ice-skating", "triathlon",
    "duathlon", "squash", "tennis", "padel", "pickleball", "badminton", "table-tennis", "racquetball", "basketball", "soccer",
    "football", "hockey", "ice-hockey", "field-hockey", "volleyball", "handball", "rugby", "lacrosse", "boxing", "kickboxing",
    "martial-arts", "jiu-jitsu", "wrestling", "muay-thai", "mma", "hiit", "jumping-rope", "assault-bike", "dance", "cardio",
    "spinning", "track-and-field", "cross-country", "obstacle-course-racing", "surfing", "paddleboarding", "kayaking", "climbing",
    "rock-climbing", "bouldering"];
  const GOAL_HIT = 0.15, GOAL_NEAR = 0.30;   // день питания: Б, Ж, У в пределах ±15 % от цели — выполнил, до ±30 % — рядом, дальше — мимо
  const MACROS = [["p", "protein", "белок"], ["f", "fat", "жиры"], ["c", "carbs", "углеводы"]];   // [поле дня, поле цели, подпись]
  const CARDIO_ZONES = 0.5;     // вид не указан (activity): ≥ половины времени в пульсовых зонах 2–5 — кардио

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
      miss — больше (weekly_review.py: hit — так же). */
  function foodDay(day, goal) {
    if (!day || !day.k) return "empty";
    if (day.k < FULL_DAY_KCAL) return "partial";
    const devs = macroDevs(day, goal);
    if (!devs.length) return "full";
    const worst = Math.max(...devs.map(x => x.dev));
    return worst <= GOAL_HIT ? "hit" : worst <= GOAL_NEAR ? "near" : "miss";
  }

  function sportKind(s) {
    return s === "squash" ? "squash" : STRENGTH.includes(s) ? "strength" : s === "walking" ? "walk" : "other";
  }

  /** Вид тренировки для режима «кардио»: силовые / кардио (по виду или по пульсу) / прогулка / другое. */
  function cardioKind(w) {
    const s = String(w.sport || "").toLowerCase();
    if (STRENGTH.includes(s)) return "strength";
    if (s === "walking") return "walk";
    if (CARDIO.includes(s)) return "cardio";
    const z = [0, 1, 2, 3, 4, 5].map(i => Number(w["z" + i + "_min"]) || 0), tot = z.reduce((a, b) => a + b, 0);
    if (tot > 0 && (z[2] + z[3] + z[4] + z[5]) / tot >= CARDIO_ZONES) return "cardio";
    return "other";
  }

  /** Категория тренировки: squash / strength / other / walk; метка пользователя главнее вида из Whoop (lib.workout_kind). */
  function workoutKind(w, labels, mode = "squash") {
    const lab = labels[String(w.id)];
    if (lab && LABELS.includes(lab.label)) {
      if (lab.label === "none") return "walk";
      if (mode === "cardio" && lab.label === "squash") return "cardio";
      if (mode === "squash" && lab.label === "cardio") return "other";
      return lab.label;
    }
    return mode === "cardio" ? cardioKind(w) : sportKind(w.sport);
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
    d.waist = body.filter(b => b.waist_cm != null).map(b => [b.date, b.waist_cm]);

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
    // вторая категория тренировок: сквош — если он есть в плане (meta.plan.workouts), иначе кардио
    const pw = ((raw.meta || {}).plan || {}).workouts;
    const mode = pw && "squash" in pw ? "squash" : "cardio";
    d.k2 = mode === "squash" ? {key: "squash", lab: "Сквош", many: "сквоша"} : {key: "cardio", lab: "Кардио", many: "кардио"};
    const ww = T("whoop_workouts").map(w => Object.assign({}, w, {kind: workoutKind(w, labels, mode)}));
    d.workouts = ww.filter(w => w.kind !== "walk").map(w => [w.start, w.kind, w.duration_min, w.kcal]).sort(cmp);
    d.whoop_daily = wd;
    d.whoop_workouts = ww;
    for (const name of ["supplements", "checkins", "labs", "events", "targets", "goal_weight", "alcohol_check"])
      d[name] = T(name);
    d.photo_notes = {};
    for (const r of T("photo_notes")) d.photo_notes[r.date] = r.note;
    d.updated = raw.updated;
    Object.assign(d, raw.meta || {});
    d.modules = raw.modules || [];
    return d;
  }

  return {build, workoutKind, sportKind, cardioKind, round1, foodDay, macroDevs, GOAL_HIT, GOAL_NEAR};
})();

if (typeof RAW !== "undefined") var DATA = Dataset.build(RAW);
