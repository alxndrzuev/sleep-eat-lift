// FatSecret в приложении: OAuth 1.0 (подпись HMAC-SHA1, три шага) и выгрузка питания и веса (прежде — scripts/fatsecret_api.py; эталоны — test/fixtures).
// Ключ приложения (consumer) — внутри приложения; ключ доступа пользователя — data/secrets/fatsecret.json.
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const store = require('./store');
const {pyRound} = require('./pyround');

const API = 'https://platform.fatsecret.com/rest/server.api';
const AUTH = 'https://authentication.fatsecret.com/oauth';
const CALLBACK = 'https://health.local/fatsecret';
const TIMEOUT = 30000;              // мс на запрос вместе с ответом: зависшая сеть — ошибка «нет связи», а не вечное «обновляю…»
const TEXTS = {network: 'Нет связи с FatSecret — попробуйте позже',
               token: 'Доступ к FatSecret пропал — подключите заново',
               code: 'Код не подошёл или ссылка устарела — проверьте код или сделайте новую ссылку'};

class FatSecretError extends Error {
  constructor(kind, detail) { super(TEXTS[kind] || `FatSecret ответил ошибкой: ${detail}`); this.kind = kind; }
}

/** Кодирование RFC 3986, как urllib.parse.quote(safe="-._~"). */
const enc = s => encodeURIComponent(String(s)).replace(/[!'()*]/g, c => '%' + c.charCodeAt(0).toString(16).toUpperCase());

/** URL с подписью OAuth 1.0 — байт в байт как прежний Python (test/fixtures/fatsecret_signed.json). */
function signedUrl(http, url, params, consumerSecret, tokenSecret = '', nonce, timestamp) {
  const p = Object.assign({}, params, {oauth_signature_method: 'HMAC-SHA1', oauth_timestamp: String(timestamp),
                                       oauth_nonce: nonce, oauth_version: '1.0'});
  const pairs = Object.entries(p).map(([k, v]) => [enc(k), enc(v)]).sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : 0));
  const norm = pairs.map(([k, v]) => `${k}=${v}`).join('&');
  const base = [http, enc(url), enc(norm)].join('&');
  const key = `${enc(consumerSecret)}&${enc(tokenSecret)}`;
  p.oauth_signature = crypto.createHmac('sha1', key).update(base).digest('base64');
  return url + '?' + Object.entries(p).map(([k, v]) => `${enc(k)}=${enc(v)}`).join('&');
}

async function call(http, url, params, cs, ts, deps = {}) {
  const fetch = deps.fetch || globalThis.fetch;
  const u = signedUrl(http, url, params, cs, ts, crypto.randomBytes(12).toString('hex'), Math.floor(Date.now() / 1000));
  const signal = AbortSignal.timeout(deps.timeout || TIMEOUT);
  let r, text;
  try {
    if (http === 'POST') {          // FatSecret проверяет подпись POST только по параметрам в теле
      const [base, q] = u.split(/\?(.*)/s);
      r = await fetch(base, {method: 'POST', body: q, headers: {'Content-Type': 'application/x-www-form-urlencoded'}, signal});
    } else r = await fetch(u, {method: http, signal});
    text = await r.text();
  } catch (e) { throw new FatSecretError('network'); }
  if (!r.ok) throw new FatSecretError('api', `HTTP ${r.status}: ${text.slice(0, 200)}`);
  return text;
}

const qs = text => Object.fromEntries(new URLSearchParams(text));

async function requestToken(app, callback = CALLBACK, deps) {
  const t = qs(await call('POST', AUTH + '/request_token', {oauth_consumer_key: app.consumer_key, oauth_callback: callback}, app.consumer_secret, '', deps));
  if (!t.oauth_token) throw new FatSecretError('api', 'нет oauth_token');
  return {token: t.oauth_token, secret: t.oauth_token_secret};
}

const authorizeUrl = token => `${AUTH}/authorize?oauth_token=${enc(token)}`;

async function accessToken(app, token, secret, verifier, deps) {
  const a = qs(await call('GET', AUTH + '/access_token',
    {oauth_consumer_key: app.consumer_key, oauth_token: token, oauth_verifier: String(verifier).trim()}, app.consumer_secret, secret, deps));
  if (!a.oauth_token) throw new FatSecretError('api', 'нет access_token');
  return {access_token: a.oauth_token, access_secret: a.oauth_token_secret};
}

/** Ошибка обмена кода на ключи: ответ FatSecret с ошибкой — неверный код или устаревшая ссылка; нет связи — как есть. */
const codeError = e => (e instanceof FatSecretError && e.kind === 'api' ? new FatSecretError('code') : e);

// ---------- ссылка для другого человека ----------
// Вход «по коду» (oob), начатый ссылкой: человек входит в свой FatSecret у себя и присылает код, а он может прийти через
// часы — поэтому незаконченный вход лежит в папке профиля (secrets/fatsecret_link.json), а не в памяти.
const linkFile = dir => path.join(dir, 'secrets', 'fatsecret_link.json');
const link = {
  save(dir, {token, secret, url}, now = new Date()) {
    const f = linkFile(dir);
    fs.mkdirSync(path.dirname(f), {recursive: true, mode: 0o700});
    fs.writeFileSync(f + '.tmp', JSON.stringify({token, secret, url, created: now.toISOString()}, null, 2), {mode: 0o600});
    fs.renameSync(f + '.tmp', f);
    fs.chmodSync(f, 0o600);
  },
  /** {token, secret, url, created} или null (нет, битый). */
  read(dir) {
    if (!dir) return null;
    try {
      const j = JSON.parse(fs.readFileSync(linkFile(dir), 'utf8'));
      return j && typeof j.token === 'string' && typeof j.secret === 'string' && j.token && j.secret ? j : null;
    } catch (e) { return null; }
  },
  clear(dir) { fs.rmSync(linkFile(dir), {force: true}); },
};

// ---------- выгрузка ----------
const EPOCH = Date.UTC(1970, 0, 1);
const round1 = x => pyRound(x, 1);
const round2 = x => pyRound(x, 2);

async function monthDays(app, user, method, ym, deps) {
  const day = Math.round((Date.UTC(+ym.slice(0, 4), +ym.slice(5, 7) - 1, 15) - EPOCH) / 864e5);
  const text = await call('GET', API, {method, format: 'json', date: String(day),
    oauth_consumer_key: app.consumer_key, oauth_token: user.access_token}, app.consumer_secret, user.access_secret, deps);
  let j;
  try { j = JSON.parse(text); } catch (e) { throw new FatSecretError('api', text.slice(0, 200)); }
  if (j.error) throw new FatSecretError([9, 13].includes(Number(j.error.code)) ? 'token' : 'api', j.error.message);
  let days = (j.month || {}).day || [];
  if (!Array.isArray(days)) days = [days];
  return days.map(x => [new Date(EPOCH + Number(x.date_int) * 864e5).toISOString().slice(0, 10), x]);
}

/** Питание за месяц: {дата: {kcal, protein, fat, carbs}} (до 0,1). */
async function month(app, user, ym, deps) {
  const out = {};
  for (const [d, x] of await monthDays(app, user, 'food_entries.get_month.v2', ym, deps))
    out[d] = {kcal: round1(+x.calories), protein: round1(+x.protein), fat: round1(+x.fat), carbs: round1(+x.carbohydrate)};
  return out;
}

/** Вес за месяц: {дата: кг}. */
async function weights(app, user, ym, deps) {
  const out = {};
  for (const [d, x] of await monthDays(app, user, 'weights.get_month.v2', ym, deps)) if (x.weight_kg) out[d] = round2(+x.weight_kg);
  return out;
}

function months(a, b) {
  const out = []; let [y, m] = [+a.slice(0, 4), +a.slice(5, 7)];
  while (y * 12 + m <= +b.slice(0, 4) * 12 + +b.slice(5, 7)) { out.push(`${y}-${String(m).padStart(2, '0')}`); [y, m] = m === 12 ? [y + 1, 1] : [y, m + 1]; }
  return out;
}

/** Выгрузить месяцы [a, b] → nutrition_daily.csv и body.csv; файлы пишутся только после всех запросов. */
async function update({dir, app, user, months: [a, b], fetch, timeout}) {
  const deps = {fetch, timeout}, food = {}, wt = {};
  try {
    for (const ym of months(a, b)) {
      Object.assign(food, await month(app, user, ym, deps));
      Object.assign(wt, await weights(app, user, ym, deps));
    }
  } catch (e) {
    if (e instanceof FatSecretError) return {ok: false, error: e.message, kind: e.kind};
    throw e;
  }
  store.upsert(dir, 'nutrition_daily.csv', food);
  const have = new Set(store.read(dir, 'body.csv').map(r => r.date));
  store.upsert(dir, 'body.csv', Object.fromEntries(Object.entries(wt).map(([d, kg]) => [d, have.has(d) ? {weight_kg: kg} : {weight_kg: kg, note: 'FatSecret'}])));
  return {ok: true, days: Object.keys(food).length, weights: Object.keys(wt).length};
}

module.exports = {FatSecretError, signedUrl, enc, call, requestToken, authorizeUrl, accessToken, codeError, link, month, weights, months, update, CALLBACK, TEXTS};
