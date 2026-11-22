// Ночи «похоже на алкоголь» по Whoop и ответы пользователя «да/нет» (как telegram.set_alcohol).
// Правило: утро, когда HRV ниже личной нормы на 25%+ И пульс покоя выше нормы на 5+; норма — медиана за 30 предыдущих дней
// (≥10 дней данных). Оценка количества по сигналу (strength): «много» — HRV −45% и ниже или пульс +12 и выше;
// «мало» — HRV выше −35% и пульс меньше +8; иначе «умеренно». Серия 3+ утра подряд — «болезнь?».
// date — утро (день Whoop); ночь — с date−1 на date. Статусы: «?» — ждёт ответа, «да», «нет»; существующие не перезаписываются.
const store = require('./store');
const {pyRound} = require('./pyround');

const HRV_TH = -25, RHR_TH = 5;
const APP_NOTE = 'подтверждено в приложении';
const LEVELS = ['мало', 'умеренно', 'много'];

/** Оценка количества по сигналу (как alcohol_check.level). */
const level = (hd, rd) => (hd <= -45 || rd >= 12 ? 'много' : hd > -35 && rd < 8 ? 'мало' : 'умеренно');

const num = v => (v === undefined || v === null || v === '' || Number.isNaN(Number(v)) ? null : Number(v));
const addDays = (ds, n) => { const d = new Date(ds + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
/** Python str() для float: 6.0 → «6.0». */
const pyFloat = x => (Number.isInteger(x) ? x.toFixed(1) : String(x));

function median(a) {
  const s = a.slice().sort((x, y) => x - y), m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/** Личная норма: медиана поля за 30 дней до ds (как lib.baseline); null, если данных меньше minN. */
function baseline(rows, ds, field, minN = 10) {
  const a = [];
  for (let i = 1; i <= 30; i++) { const r = rows[addDays(ds, -i)]; if (r && num(r[field]) !== null) a.push(num(r[field])); }
  return a.length >= minN ? median(a) : null;
}

/** С какой даты размечать в приложении — последние 30 дней (старое пользователь уже не вспомнит). */
const fromDate = today => addDays(today, -30);

/** Разметить ночи начиная с from → alcohol_check.csv. → {found, added, pending}. */
function mark(dir, {from}) {
  const ok = {};
  for (const r of store.read(dir, 'whoop_daily.csv')) if (num(r.hrv) !== null && num(r.rhr) !== null) ok[r.date] = r;
  const flags = {};
  for (const k of Object.keys(ok).sort()) {
    const r = ok[k];
    const bh = baseline(ok, k, 'hrv'), br = baseline(ok, k, 'rhr'), bt = baseline(ok, k, 'skin_temp', 1);
    if (bh === null || br === null) continue;
    const hd = (num(r.hrv) - bh) / bh * 100, rd = num(r.rhr) - br;
    const td = bt !== null && num(r.skin_temp) !== null ? num(r.skin_temp) - bt : null;
    if (k >= from && hd <= HRV_TH && rd >= RHR_TH)
      flags[k] = {hrv_dev_pct: String(pyRound(hd)), rhr_dev: pyFloat(pyRound(rd, 1)), temp_dev: td === null ? '' : pyFloat(pyRound(td, 2)),
                  strength: level(hd, rd)};
  }
  for (const k of Object.keys(flags)) {               // серии 3+ дня подряд — похоже на болезнь
    let run = 1, a = addDays(k, -1), b = addDays(k, 1);
    while (a in flags) { run++; a = addDays(a, -1); }
    while (b in flags) { run++; b = addDays(b, 1); }
    flags[k].kind = run >= 3 ? 'болезнь?' : 'алкоголь?';
  }
  const cols = store.SCHEMA.schema['alcohol_check.csv'];
  const old = new Map(store.read(dir, 'alcohol_check.csv').map(r => [r.date, r]));
  let added = 0;
  for (const [k, f] of Object.entries(flags)) {
    let r = old.get(k);
    if (!r) { r = Object.fromEntries(cols.map(c => [c, ''])); r.date = k; r.status = '?'; old.set(k, r); added++; }
    for (const c of ['hrv_dev_pct', 'rhr_dev', 'temp_dev', 'strength', 'kind']) r[c] = f[c];
  }
  // подтверждённый алкоголь из событий: вечер start → утро start+1
  const confirmed = store.read(dir, 'events.csv').filter(e => (e.type || '').trim() === 'алкоголь' && e.start).map(e => addDays(e.start, 1));
  for (const k of confirmed) {
    let r = old.get(k);
    if (!r) { r = Object.fromEntries(cols.map(c => [c, ''])); Object.assign(r, {date: k, kind: 'алкоголь?', note: 'из событий, признаков в Whoop нет'}); old.set(k, r); }
    if (r.status === '' || r.status === '?') r.status = 'да';
  }
  store.write(dir, 'alcohol_check.csv', [...old.values()]);
  return {found: Object.keys(flags).length, added, pending: [...old.values()].filter(r => r.status === '?').length};
}

const isAlcOn = evening => e => e.start === evening && (e.type || '').trim() === 'алкоголь';

/** Вечер с алкоголем в events.csv: есть — обновить уровень (и описание, если дано), нет — добавить. */
function upsertEvening(dir, evening, lvl, description, fallback = APP_NOTE) {
  const ev = store.read(dir, 'events.csv'), hit = ev.find(isAlcOn(evening));
  if (hit) { hit.level = lvl || hit.level; if (description) hit.description = description; store.write(dir, 'events.csv', ev); }
  else store.write(dir, 'events.csv', ev.concat([{start: evening, end: evening, type: 'алкоголь', description: description || fallback, level: lvl || ''}]));
}

/** Ответ про утро morning: 'мало' | 'умеренно' | 'много' (был; true — был, без оценки) или 'нет' / false.
 *  Был — статус «да» и вечер в events.csv с уровнем; не был — «нет», вечер, добавленный приложением, убрать. */
function answer(dir, morning, value) {
  const yes = value === true || LEVELS.includes(value), no = value === false || value === 'нет';
  if (!yes && !no) return {ok: false, error: 'Неизвестный ответ'};
  const rows = store.read(dir, 'alcohol_check.csv');
  const row = rows.find(r => r.date === morning);
  if (!row) return {ok: false, error: 'Нет такой ночи в разметке'};
  row.status = yes ? 'да' : 'нет';
  store.write(dir, 'alcohol_check.csv', rows);
  const evening = addDays(morning, -1);
  if (yes) upsertEvening(dir, evening, value === true ? '' : value);
  else {
    const ev = store.read(dir, 'events.csv'), mine = e => isAlcOn(evening)(e) && e.description === APP_NOTE;
    if (ev.some(mine)) store.write(dir, 'events.csv', ev.filter(e => !mine(e)));
  }
  return {ok: true};
}

const validDay = d => /^\d{4}-\d{2}-\d{2}$/.test(d || '') && new Date(d + 'T00:00:00Z').toISOString().slice(0, 10) === d;

/** Добавить вечер с алкоголем вручную (evening — дата вечера). Утро после, если было под вопросом, — «да». */
function add(dir, evening, lvl, note, today) {
  if (!validDay(evening) || evening < '2000-01-01') return {ok: false, error: 'Неверная дата'};
  if (evening > today) return {ok: false, error: 'Дата — не позже сегодня'};
  if (!LEVELS.includes(lvl)) return {ok: false, error: 'Выберите: мало, умеренно или много'};
  upsertEvening(dir, evening, lvl, (note || '').trim(), 'добавлено вручную');
  const rows = store.read(dir, 'alcohol_check.csv'), m = rows.find(r => r.date === addDays(evening, 1));
  if (m && (m.status === '' || m.status === '?')) { m.status = 'да'; store.write(dir, 'alcohol_check.csv', rows); }
  return {ok: true};
}

/** Поменять уровень у отмеченного вечера (список «Отмечено» на «Восстановлении»). Вечер без события, но с «да»
 *  по утру после (старые отметки) — событие добавляется; не отмеченный вечер — ошибка. */
function setLevel(dir, evening, lvl) {
  if (!validDay(evening)) return {ok: false, error: 'Неверная дата'};
  if (!LEVELS.includes(lvl)) return {ok: false, error: 'Выберите: мало, умеренно или много'};
  const ev = store.read(dir, 'events.csv'), hits = ev.filter(isAlcOn(evening));
  if (hits.length) { hits.forEach(e => { e.level = lvl; }); store.write(dir, 'events.csv', ev); return {ok: true}; }
  const m = store.read(dir, 'alcohol_check.csv').find(r => r.date === addDays(evening, 1));
  if (!m || m.status !== 'да') return {ok: false, error: 'Этот вечер не отмечен'};
  upsertEvening(dir, evening, lvl, '');
  return {ok: true};
}

/** Убрать вечер с алкоголем: события этого вечера; утро после — снова «?», если был сигнал Whoop, иначе строка удаляется. */
function removeEvening(dir, evening) {
  if (!validDay(evening)) return {ok: false, error: 'Неверная дата'};
  const ev = store.read(dir, 'events.csv');
  store.write(dir, 'events.csv', ev.filter(e => !isAlcOn(evening)(e)));
  const morning = addDays(evening, 1), rows = store.read(dir, 'alcohol_check.csv');
  const m = rows.find(r => r.date === morning);
  if (m) {
    if (m.hrv_dev_pct !== '') m.status = '?';
    store.write(dir, 'alcohol_check.csv', m.hrv_dev_pct !== '' ? rows : rows.filter(r => r !== m));
  }
  return {ok: true};
}

module.exports = {mark, answer, add, setLevel, removeEvening, fromDate, baseline, level, LEVELS};
