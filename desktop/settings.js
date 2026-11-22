// «Настройки» приложения: цели (новая строка с сегодняшней даты; старые не трогаем — как правило проекта) и внешние ссылки.
const store = require('./store');

const LIMITS = {kcal: [1000, 6000, 'Калории — от 1000 до 6000'], protein: [0, 600, 'Белки — от 0 до 600 г'],
                fat: [0, 600, 'Жиры — от 0 до 600 г'], carbs: [0, 600, 'Углеводы — от 0 до 600 г'],
                goalWeight: [30, 250, 'Целевой вес — от 30 до 250 кг']};
const EXTERNAL = ['www.fatsecret.com', 'platform.fatsecret.com', 'www.whoop.com'];

/** Калории по БЖУ: 4 ккал/г белка и углеводов, 9 ккал/г жира (Этуотер); нет хотя бы одного — null. */
function kcalOf(p, f, c) {
  if ([p, f, c].some(v => v === null || v === undefined || v === '' || !Number.isFinite(Number(v)))) return null;
  return Math.round(4 * Number(p) + 9 * Number(f) + 4 * Number(c));
}

const given = v => v !== undefined && v !== null && String(v).trim() !== '';

const DATE_ERR = 'Дата — не раньше 2000 года и не позже сегодня';

/** «YYYY-MM-DD» — настоящая дата от 2000-01-01 до today. */
function validDate(d, today) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d || '')) return false;
  const t = new Date(d + 'T00:00:00Z');
  return !Number.isNaN(t.getTime()) && t.toISOString().slice(0, 10) === d && d >= '2000-01-01' && d <= today;
}

/** {date?, kcal, protein, fat, carbs, goalWeight} (пустое — не меняем) → targets.csv / goal_weight.csv с даты date
 *  (по умолчанию today; можно задним числом — цель действует с этой даты до следующей). */
function saveTargets(dir, vals, today) {
  const from = given(vals.date) ? String(vals.date).trim() : today;
  if (!validDate(from, today)) return {ok: false, error: DATE_ERR};
  const nums = {};
  for (const [k, [lo, hi, msg]] of Object.entries(LIMITS)) {
    if (!given(vals[k])) continue;
    const x = Number(String(vals[k]).replace(',', '.'));
    if (!Number.isFinite(x) || x < lo || x > hi) return {ok: false, error: msg};
    nums[k] = x;
  }
  const t = ['kcal', 'protein', 'fat', 'carbs'].filter(k => k in nums);
  if (t.length) {
    const prev = store.read(dir, 'targets.csv').filter(r => r.start <= from).sort((a, b) => (a.start < b.start ? -1 : 1)).pop() || {};
    const row = {note: 'из настроек'};
    for (const k of ['kcal', 'protein', 'fat', 'carbs']) row[k] = k in nums ? nums[k] : (prev[k] || null);
    const k = kcalOf(row.protein, row.fat, row.carbs);      // калории — из БЖУ, если все три известны
    if (k !== null) {
      if (k < LIMITS.kcal[0] || k > LIMITS.kcal[1]) return {ok: false, error: `Калории по БЖУ — ${k}, а должно быть от 1000 до 6000`};
      row.kcal = k;
    }
    store.upsert(dir, 'targets.csv', {[from]: row});
  }
  if ('goalWeight' in nums) store.upsert(dir, 'goal_weight.csv', {[from]: {goal_weight_kg: nums.goalWeight, note: 'из настроек'}});
  return {ok: true};
}

/** Удалить цель с даты: kind — 'targets' (КБЖУ) или 'goal_weight'. */
function removeTarget(dir, kind, date) {
  const file = {targets: 'targets.csv', goal_weight: 'goal_weight.csv'}[kind];
  if (!file) return {ok: false, error: 'Неизвестный вид цели'};
  return {ok: true, removed: store.remove(dir, file, [String(date)])};
}

function externalAllowed(url) {
  try { const u = new URL(url); return u.protocol === 'https:' && EXTERNAL.includes(u.hostname); } catch (e) { return false; }
}

module.exports = {saveTargets, removeTarget, kcalOf, externalAllowed, validDate, LIMITS};
