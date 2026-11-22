// Whoop в приложении: OAuth 2.0 (offline — токен обновляется сам) и выгрузка API v2 (прежде — scripts/whoop_api.py).
// Ключ приложения (client_id/secret) — внутри приложения; токены пользователя — data/secrets/whoop.json.
const crypto = require('node:crypto');
const store = require('./store');
const {pyRound} = require('./pyround');

const AUTH_URL = 'https://api.prod.whoop.com/oauth/oauth2/auth';
const TOKEN_URL = 'https://api.prod.whoop.com/oauth/oauth2/token';
const API = 'https://api.prod.whoop.com/developer';
const UA = 'health-dashboard/1.0 (personal; electron)';   // Cloudflare у Whoop режет стандартные User-Agent
const SCOPES = 'offline read:recovery read:cycles read:workout read:sleep read:profile read:body_measurement';
const CALLBACK = 'https://health.local/whoop';
const TIMEOUT = 30000;              // мс на запрос вместе с ответом: зависшая сеть — ошибка «нет связи», а не вечное «обновляю…»
const TEXTS = {network: 'Нет связи с Whoop — попробуйте позже', token: 'Доступ к Whoop пропал — подключите заново'};

class WhoopError extends Error {
  constructor(kind, detail) { super(TEXTS[kind] || `Whoop ответил ошибкой: ${detail}`); this.kind = kind; }
}

const newState = () => crypto.randomBytes(4).toString('hex');     // Whoop требует state из 8 символов
const redirectOf = app => app.redirect_uri || CALLBACK;

function authUrl(app, state) {
  const q = new URLSearchParams({response_type: 'code', client_id: app.client_id, redirect_uri: redirectOf(app), scope: SCOPES, state});
  return AUTH_URL + '?' + q.toString().replace(/\+/g, '%20');
}

/** Код из обратного адреса; чужой state или ошибка Whoop — исключение. */
function codeFrom(url, state) {
  const q = url.searchParams;
  if (q.get('error')) throw new WhoopError('api', `${q.get('error')} ${q.get('error_description') || ''}`.trim());
  if (q.get('state') !== state) throw new Error('Вход устарел — нажмите «Подключить» ещё раз');
  return q.get('code');
}

async function tokenRequest(app, data, deps) {
  let r, text;
  try {
    r = await deps.fetch(TOKEN_URL, {method: 'POST', body: new URLSearchParams(Object.assign({}, data,
      {client_id: app.client_id, client_secret: app.client_secret})).toString(),
      headers: {'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': UA, Accept: 'application/json'},
      signal: AbortSignal.timeout(deps.timeout || TIMEOUT)});
    text = await r.text();
  } catch (e) { throw new WhoopError('network'); }
  if (r.status === 400 || r.status === 401) throw new WhoopError('token');
  if (!r.ok) throw new WhoopError('api', `HTTP ${r.status}: ${text.slice(0, 200)}`);
  const t = JSON.parse(text);
  return {access_token: t.access_token, refresh_token: t.refresh_token,
          expires_at: Math.floor(Date.now() / 1000) + Number(t.expires_in || 3600) - 120};
}

const exchange = (app, code, deps) => tokenRequest(app, {grant_type: 'authorization_code', code, redirect_uri: redirectOf(app)}, deps);

/** Новый access_token по refresh_token; новый refresh_token сразу сохраняется (Whoop выдаёт новый каждый раз). */
async function refresh(app, user, deps) {
  const t = await tokenRequest(app, {grant_type: 'refresh_token', refresh_token: user.refresh_token, scope: 'offline'}, deps);
  Object.assign(user, t, {refresh_token: t.refresh_token || user.refresh_token});
  deps.saveUser(user);
  return user;
}

async function get(app, user, p, params, deps) {
  const q = new URLSearchParams(Object.entries(params).filter(([, v]) => v));
  for (let attempt = 0; attempt < 5; attempt++) {
    if (!user.access_token || Date.now() / 1000 >= (user.expires_at || 0)) await refresh(app, user, deps);
    let r, text;
    try {
      r = await deps.fetch(`${API}${p}?${q}`, {headers: {Authorization: 'Bearer ' + user.access_token, 'User-Agent': UA, Accept: 'application/json'},
                                               signal: AbortSignal.timeout(deps.timeout || TIMEOUT)});
      text = await r.text();
    } catch (e) { throw new WhoopError('network'); }
    if (r.status === 429) { await deps.sleep(Math.min(Number(r.headers.get('X-RateLimit-Reset')) || 30, 120) * 1000 + 1000); continue; }
    if (r.status === 401) { user.expires_at = 0; continue; }
    if (!r.ok) throw new WhoopError('api', `HTTP ${r.status} ${p}: ${text.slice(0, 200)}`);
    return JSON.parse(text);
  }
  throw new WhoopError('api', 'слишком много повторов');
}

async function collect(app, user, p, start, end, deps) {
  const out = []; let token = null;
  for (;;) {
    const j = await get(app, user, p, {limit: 25, start, end, nextToken: token}, deps);
    out.push(...(j.records || []));
    token = j.next_token;
    if (!token) return out;
    await deps.sleep(700);                                     // ≤100 запросов в минуту
  }
}

// ---------- разбор ответов в строки CSV (эталон — test/fixtures/whoop_rows.json) ----------
const r1 = (x, k = 1) => (x == null ? null : pyRound(x, k));
const h = ms => (ms == null ? null : pyRound(ms / 3600000, 2));

/** ISO UTC + смещение «+03:00» → местное время: {ms (как UTC-часы), date, hm}. */
function local(ts, off) {
  let ms = Date.parse(ts), o = (off || '').trim();
  if (o && o !== 'Z' && o !== 'z') {
    const sign = o.startsWith('-') ? -1 : 1, d = o.replace(/^[+-]/, '').replace(':', '');
    const [hh, mm] = d.length > 2 ? [d.slice(0, 2), d.slice(2, 4) || '0'] : [d, '0'];
    ms += sign * (Number(hh) * 60 + Number(mm)) * 60000;
  }
  const iso = new Date(ms).toISOString();
  return {ms, date: iso.slice(0, 10), hm: iso.slice(11, 16), dt: iso.slice(0, 10) + ' ' + iso.slice(11, 16)};
}

function toRows(cycles, recoveries, sleeps, workouts) {
  const recov = Object.fromEntries(recoveries.map(r => [r.cycle_id, r]));
  const sl = Object.fromEntries(sleeps.filter(x => !x.nap && x.cycle_id != null).map(x => [x.cycle_id, x]));
  const daily = {};
  for (const c of cycles) {
    const day = new Date(local(c.start, c.timezone_offset || '+00:00').ms + 8 * 3600000).toISOString().slice(0, 10);
    const row = {}, sc = c.score || {};
    if (c.score_state === 'SCORED') Object.assign(row, {strain: r1(sc.strain), kcal: sc.kilojoule ? pyRound(sc.kilojoule / 4.184) : null});
    if (c.step_count != null) row.steps = Math.trunc(c.step_count);
    const rv = recov[c.id];
    if (rv && rv.score_state === 'SCORED') {
      const q = rv.score;
      Object.assign(row, {recovery: r1(q.recovery_score, 0), hrv: r1(q.hrv_rmssd_milli), rhr: r1(q.resting_heart_rate, 0),
                          spo2: r1(q.spo2_percentage), skin_temp: r1(q.skin_temp_celsius, 2)});
    }
    const s = sl[c.id];
    if (s && s.score_state === 'SCORED') {
      const q = s.score, st = q.stage_summary || {};
      const asleep = ['total_light_sleep_time_milli', 'total_slow_wave_sleep_time_milli', 'total_rem_sleep_time_milli'].reduce((a, k) => a + (st[k] || 0), 0);
      Object.assign(row, {sleep_h: h(asleep), deep_h: h(st.total_slow_wave_sleep_time_milli), rem_h: h(st.total_rem_sleep_time_milli),
        light_h: h(st.total_light_sleep_time_milli), awake_h: h(st.total_awake_time_milli), sleep_perf: r1(q.sleep_performance_percentage, 0),
        sleep_eff: r1(q.sleep_efficiency_percentage, 0), resp_rate: r1(q.respiratory_rate),
        bed: local(s.start, s.timezone_offset).hm, wake: local(s.end, s.timezone_offset).hm});
    }
    if (Object.keys(row).length) daily[day] = row;
  }
  const wk = {};
  const names = ['zero', 'one', 'two', 'three', 'four', 'five'];
  for (const w of workouts) {
    if (w.score_state !== 'SCORED') continue;
    const t0 = local(w.start, w.timezone_offset || '+00:00'), t1 = local(w.end, w.timezone_offset || '+00:00');
    const q = w.score, z = q.zone_durations || {};
    const row = {date: t0.date, start: t0.dt, sport: w.sport_name || w.sport_id, duration_min: pyRound((t1.ms - t0.ms) / 60000),
                 strain: r1(q.strain), avg_hr: q.average_heart_rate ?? null, max_hr: q.max_heart_rate ?? null,
                 kcal: q.kilojoule ? pyRound(q.kilojoule / 4.184) : null};
    names.forEach((n, i) => { const v = z[`zone_${n}_milli`]; row[`z${i}_min`] = v == null ? null : pyRound(v / 60000, 1); });
    wk[String(w.id)] = row;
  }
  return {daily, workouts: wk};
}

// ---------- обновление ----------
const isoZ = d => d.toISOString().slice(0, 19) + '.000Z';

/** Выгрузить последние `days` дней → whoop_daily.csv, whoop_workouts.csv (удалённые в Whoop тренировки периода — убрать).
 *  Файлы пишутся только после всех запросов. */
async function update({dir, app, user, days, fetch, saveUser, timeout, now = new Date(), sleep = ms => new Promise(r => setTimeout(r, ms))}) {
  const deps = {fetch: fetch || globalThis.fetch, saveUser, sleep, timeout};
  const start = isoZ(new Date(now - days * 864e5)), end = isoZ(now);
  let got;
  try {
    const cycles = await collect(app, user, '/v2/cycle', start, end, deps);
    const recoveries = await collect(app, user, '/v2/recovery', start, end, deps);
    const sleeps = await collect(app, user, '/v2/activity/sleep', start, end, deps);
    const workouts = await collect(app, user, '/v2/activity/workout', start, end, deps);
    got = {rows: toRows(cycles, recoveries, sleeps, workouts), seen: new Set(workouts.map(w => String(w.id)))};
  } catch (e) {
    if (e instanceof WhoopError) return {ok: false, kind: e.kind, error: e.message};
    throw e;
  }
  store.upsert(dir, 'whoop_daily.csv', got.rows.daily);
  store.upsert(dir, 'whoop_workouts.csv', got.rows.workouts);
  const cutoff = new Date(now - (days - 1) * 864e5).toISOString().slice(0, 10);   // край окна +1 день — часовые пояса
  const gone = store.read(dir, 'whoop_workouts.csv').filter(w => w.date >= cutoff && !got.seen.has(w.id)).map(w => w.id);
  const removed = store.remove(dir, 'whoop_workouts.csv', gone);
  return {ok: true, days: Object.keys(got.rows.daily).length, workouts: Object.keys(got.rows.workouts).length, removed};
}

module.exports = {WhoopError, authUrl, codeFrom, newState, exchange, refresh, collect, toRows, update, pyRound,
                  AUTH_URL, TOKEN_URL, API, UA, CALLBACK, TEXTS};
