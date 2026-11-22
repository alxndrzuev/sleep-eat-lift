// «Настройки» приложения: цели, план, БАДы (новая строка с даты; старые не трогаем — как правило проекта) и внешние ссылки.
const store = require('./store');

const LIMITS = {kcal: [1000, 6000, 'Калории — от 1000 до 6000'], protein: [0, 600, 'Белки — от 0 до 600 г'],
                fat: [0, 600, 'Жиры — от 0 до 600 г'], carbs: [0, 600, 'Углеводы — от 0 до 600 г'],
                goalWeight: [30, 250, 'Целевой вес — от 30 до 250 кг'], sleep: [4, 12, 'Сон — от 4 до 12 ч'],
                strength: [0, 14, 'Силовые — от 0 до 14 в неделю'], cardio: [0, 14, 'Кардио — от 0 до 14 в неделю']};
// поле формы → колонка targets.csv (вес — в goal_weight.csv)
const TARGET_COL = {kcal: 'kcal', protein: 'protein', fat: 'fat', carbs: 'carbs', sleep: 'sleep_h', strength: 'strength_wk', cardio: 'cardio_wk'};
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
  const t = Object.keys(TARGET_COL).filter(k => k in nums);
  if (t.length) {
    const prev = store.read(dir, 'targets.csv').filter(r => r.start <= from).sort((a, b) => (a.start < b.start ? -1 : 1)).pop() || {};
    const row = {note: 'из настроек'};
    for (const [k, col] of Object.entries(TARGET_COL)) row[col] = k in nums ? nums[k] : (prev[col] || null);
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

// ---------- план: свободный текст, действует с даты до следующей версии ----------
const PLAN_MAX = 20000;

/** {date?, text} → строка plans.csv с даты (та же дата — заменить). */
function savePlan(dir, vals, today) {
  const from = given(vals.date) ? String(vals.date).trim() : today;
  if (!validDate(from, today)) return {ok: false, error: DATE_ERR};
  const text = String(vals.text == null ? '' : vals.text).replace(/\r\n?/g, '\n').trim();
  if (!text) return {ok: false, error: 'Пустой план'};
  if (text.length > PLAN_MAX) return {ok: false, error: 'План — не длиннее 20 000 символов'};
  store.upsert(dir, 'plans.csv', {[from]: {text}});
  return {ok: true};
}

function removePlan(dir, date) {
  return {ok: true, removed: store.remove(dir, 'plans.csv', [String(date)])};
}

// ---------- БАДы: строка — дата начала + название; пустой end — принимает сейчас ----------
const SUPP_FIELDS = ['name', 'dose', 'timing', 'purpose', 'note'];
const SUPP_MAX = 200;
const same = (a, b) => a.start === String(b.start) && a.name === String(b.name);

/** {start?, name, dose, timing, purpose, note} → новая строка supplements.csv. */
function addSupplement(dir, vals, today) {
  const row = {start: given(vals.start) ? String(vals.start).trim() : today, end: ''};
  if (!validDate(row.start, today)) return {ok: false, error: DATE_ERR};
  for (const k of SUPP_FIELDS) row[k] = String(vals[k] == null ? '' : vals[k]).replace(/\s+/g, ' ').trim();
  if (!row.name) return {ok: false, error: 'Название БАДа — обязательно'};
  if (SUPP_FIELDS.some(k => row[k].length > SUPP_MAX)) return {ok: false, error: 'Поля БАДа — не длиннее 200 символов'};
  const rows = store.read(dir, 'supplements.csv');
  if (rows.some(r => same(r, row))) return {ok: false, error: 'Этот БАД с этой даты уже есть'};
  store.write(dir, 'supplements.csv', rows.concat([row]));
  return {ok: true};
}

/** {start, name, end?} → дата конца (по умолчанию today). */
function stopSupplement(dir, vals, today) {
  const end = given(vals.end) ? String(vals.end).trim() : today;
  if (!validDate(end, today)) return {ok: false, error: DATE_ERR};
  const rows = store.read(dir, 'supplements.csv'), hit = rows.find(r => same(r, vals));
  if (!hit) return {ok: false, error: 'БАД не найден'};
  if (end < hit.start) return {ok: false, error: 'Дата конца — не раньше начала'};
  hit.end = end;
  store.write(dir, 'supplements.csv', rows);
  return {ok: true};
}

/** {start, name} → удалить ошибочную строку. */
function removeSupplement(dir, vals) {
  const rows = store.read(dir, 'supplements.csv'), keep = rows.filter(r => !same(r, vals));
  if (keep.length === rows.length) return {ok: false, error: 'БАД не найден'};
  store.write(dir, 'supplements.csv', keep);
  return {ok: true};
}

function externalAllowed(url) {
  try { const u = new URL(url); return u.protocol === 'https:' && EXTERNAL.includes(u.hostname); } catch (e) { return false; }
}

module.exports = {saveTargets, removeTarget, savePlan, removePlan, addSupplement, stopSupplement, removeSupplement,
                  kcalOf, externalAllowed, validDate, LIMITS};
