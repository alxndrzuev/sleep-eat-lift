// Whoop в приложении: вход (state), обновление токена, страницы API, удалённые тренировки, независимость от FatSecret.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const store = require('../store');
const whoop = require('../whoop');
const updater = require('../updater');

const APP = {client_id: 'cid', client_secret: 'csec'};
const json = (b, status = 200, headers = {}) => Promise.resolve(new Response(JSON.stringify(b), {status, headers}));
const FIX = require('./fixtures/whoop_v2.json');

function tmp() {
  const dir = store.dataDir(fs.mkdtempSync(path.join(os.tmpdir(), 'health-whoop-')));
  store.init(dir);
  return dir;
}

/** Заглушка API Whoop: записи по путям, страницы по 2, 401 на первом запросе (если expired). */
function fakeApi({expired = false, records = FIX} = {}) {
  const calls = [];
  let refreshed = false;
  const fetch = async (url, opt = {}) => {
    calls.push(url);
    if (url.startsWith(whoop.TOKEN_URL)) {
      refreshed = true;
      return json({access_token: 'new-access', refresh_token: 'new-refresh', expires_in: 3600});
    }
    if (opt.headers['User-Agent'] !== whoop.UA) return json({error: 'cloudflare'}, 403);
    if (expired && !refreshed) return json({}, 401);
    const u = new URL(url);
    const all = {'/developer/v2/cycle': records.cycles, '/developer/v2/recovery': records.recoveries,
                 '/developer/v2/activity/sleep': records.sleeps, '/developer/v2/activity/workout': records.workouts}[u.pathname];
    const page = Number(u.searchParams.get('nextToken') || 0);
    const next = page + 2 < all.length ? String(page + 2) : null;
    return json({records: all.slice(page, page + 2), next_token: next});
  };
  return {fetch, calls};
}

test('authUrl has scope, state, redirect', () => {
  const u = new URL(whoop.authUrl(APP, 'abcd1234'));
  assert.strictEqual(u.searchParams.get('state'), 'abcd1234');
  assert.strictEqual(u.searchParams.get('redirect_uri'), 'https://health.local/whoop');
  assert.match(u.searchParams.get('scope'), /^offline read:recovery/);
});

test('callback with foreign state rejected', () => {
  assert.throws(() => whoop.codeFrom(new URL('https://health.local/whoop?code=c&state=zzzz9999'), 'abcd1234'), /устарел/);
  assert.strictEqual(whoop.codeFrom(new URL('https://health.local/whoop?code=c&state=abcd1234'), 'abcd1234'), 'c');
});

test('update: pages, rows, refresh token saved, pruned workouts', async () => {
  const dir = tmp();
  store.upsert(dir, 'whoop_workouts.csv', {'old-gone': {date: '2026-11-19', start: '2026-11-19 10:00', sport: 'running'},
                                           'old-kept': {date: '2020-01-01', start: '2020-01-01 10:00', sport: 'running'}});
  let saved = null;
  const {fetch, calls} = fakeApi({expired: true});
  const r = await whoop.update({dir, app: APP, user: {access_token: 'a', refresh_token: 'r', expires_at: 0}, days: 14,
                                fetch, saveUser: u => { saved = u; }, now: new Date('2026-11-21T10:00:00Z'), sleep: async () => {}});
  assert.deepStrictEqual(r, {ok: true, days: 3, workouts: 2, removed: 1});
  assert.strictEqual(saved.refresh_token, 'new-refresh');
  assert.ok(calls.some(c => c.includes('nextToken=2')));           // вторая страница циклов
  assert.deepStrictEqual(store.read(dir, 'whoop_workouts.csv').map(w => w.id).sort(), ['old-kept', 'w-1', 'w-2']);
  assert.strictEqual(store.read(dir, 'whoop_daily.csv').find(d => d.date === '2026-11-20').steps, '9123');
});

test('expired refresh token → token error, files untouched', async () => {
  const dir = tmp();
  const before = fs.readFileSync(path.join(dir, 'whoop_daily.csv'), 'utf8');
  const fetch = async (url) => url.startsWith(whoop.TOKEN_URL) ? json({error: 'invalid_grant'}, 400) : json({}, 401);
  const r = await whoop.update({dir, app: APP, user: {access_token: 'a', refresh_token: 'r', expires_at: 0}, days: 14,
                                fetch, saveUser: () => {}, now: new Date(), sleep: async () => {}});
  assert.deepStrictEqual(r, {ok: false, kind: 'token', error: 'Доступ к Whoop пропал — подключите заново'});
  assert.strictEqual(fs.readFileSync(path.join(dir, 'whoop_daily.csv'), 'utf8'), before);
});

test('whoop fails, fatsecret still updates', async () => {
  const dir = tmp();
  const u = updater.create({
    fatsecret: {connected: () => true, update: async d => { store.upsert(d, 'body.csv', {'2026-11-20': {weight_kg: 73}}); return {ok: true}; }},
    whoop: {connected: () => true, update: async () => ({ok: false, error: 'Доступ к Whoop пропал — подключите заново'})},
  }, () => '2026-11-21');
  const r = await u.runAll(dir);
  assert.strictEqual(r.fatsecret.ok, true);
  assert.strictEqual(r.whoop.ok, false);
  assert.strictEqual(store.read(dir, 'body.csv')[0].weight_kg, '73');
});
