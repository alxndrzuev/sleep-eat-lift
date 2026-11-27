// FatSecret в приложении: виды ошибок, выгрузка в CSV, обновление не портит файлы при ошибке.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const store = require('../store');
const fs_ = require('../fatsecret');
const updater = require('../updater');

const APP = {consumer_key: 'ck', consumer_secret: 'cs'}, USER = {access_token: 't', access_secret: 's'};
const resp = (body, status = 200) => Promise.resolve(new Response(typeof body === 'string' ? body : JSON.stringify(body), {status}));
const EPOCH = Date.UTC(1970, 0, 1);
const di = ds => String(Math.round((Date.parse(ds + 'T00:00:00Z') - EPOCH) / 864e5));

function tmp() {
  const dir = store.dataDir(fs.mkdtempSync(path.join(os.tmpdir(), 'health-fs-')));
  store.init(dir);
  return dir;
}

/** Заглушка API: питание и вес по месяцам (ym → дни), или ошибка на n-м запросе. */
function fakeApi({food = {}, weight = {}, entries = {}, failAt = -1, fail} = {}) {
  let n = 0;
  return async (url) => {
    if (n++ === failAt) return fail();
    const u = new URL(url), method = u.searchParams.get('method');
    if (method === 'food_entries.get.v2') {
      const ds = new Date(EPOCH + Number(u.searchParams.get('date')) * 864e5).toISOString().slice(0, 10);
      return resp({food_entries: entries[ds] ? {food_entry: entries[ds]} : null});
    }
    const ym = new Date(EPOCH + Number(u.searchParams.get('date')) * 864e5).toISOString().slice(0, 7);
    if (method === 'food_entries.get_month.v2')
      return resp({month: {day: (food[ym] || []).map(([d, k, p, f, c]) => ({date_int: di(d), calories: k, protein: p, fat: f, carbohydrate: c}))}});
    return resp({month: {day: (weight[ym] || []).map(([d, kg]) => ({date_int: di(d), weight_kg: kg}))}});
  };
}

test('error kinds and texts', async () => {
  await assert.rejects(fs_.month(APP, USER, '2026-11', {fetch: () => resp({error: {code: 9, message: 'Invalid token'}})}),
    e => e.kind === 'token' && e.message === 'Доступ к FatSecret пропал — подключите заново');
  await assert.rejects(fs_.month(APP, USER, '2026-11', {fetch: () => Promise.reject(new TypeError('fetch failed'))}),
    e => e.kind === 'network' && e.message === 'Нет связи с FatSecret — попробуйте позже');
  await assert.rejects(fs_.month(APP, USER, '2026-11', {fetch: () => resp({error: {code: 21, message: 'Invalid IP'}})}),
    e => e.kind === 'api' && e.message === 'FatSecret ответил ошибкой: Invalid IP');
});

test('month parsing: single day object and rounding', async () => {
  const fetch = async () => resp({month: {day: {date_int: di('2026-11-03'), calories: '2100.04', protein: '120.25', fat: '60', carbohydrate: '250.55'}}});
  assert.deepStrictEqual(await fs_.month(APP, USER, '2026-11', {fetch}),
    {'2026-11-03': {kcal: 2100, protein: 120.2, fat: 60, carbs: 250.6}});
});

test('update writes nutrition and weight', async () => {
  const dir = tmp();
  store.upsert(dir, 'body.csv', {'2026-10-05': {note: 'после отпуска'}});
  const fetch = fakeApi({food: {'2026-11': [['2026-11-01', 2000, 100, 60, 250]]},
                         weight: {'2026-10': [['2026-10-05', 72.5]], '2026-11': [['2026-11-02', 73]]}});
  const r = await fs_.update({dir, app: APP, user: USER, months: ['2026-10', '2026-11'], fetch});
  assert.deepStrictEqual(r, {ok: true, days: 1, weights: 2, entries: 0});
  assert.deepStrictEqual(store.read(dir, 'nutrition_daily.csv')[0], {date: '2026-11-01', kcal: '2000', protein: '100', fat: '60', carbs: '250', fiber: ''});
  const body = store.read(dir, 'body.csv');
  assert.deepStrictEqual(body.map(b => [b.date, b.weight_kg, b.note]),
    [['2026-10-05', '72.5', 'после отпуска'], ['2026-11-02', '73', 'FatSecret']]);
});

test('failed update leaves files byte for byte', async () => {
  const dir = tmp();
  store.upsert(dir, 'nutrition_daily.csv', {'2026-10-01': {kcal: 1900}});
  const before = ['nutrition_daily.csv', 'body.csv'].map(f => fs.readFileSync(path.join(dir, f), 'utf8'));
  const fetch = fakeApi({food: {'2026-10': [['2026-10-02', 2000, 1, 1, 1]]}, failAt: 2, fail: () => Promise.reject(new TypeError('net'))});
  const r = await fs_.update({dir, app: APP, user: USER, months: ['2026-10', '2026-11'], fetch});
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.error, 'Нет связи с FatSecret — попробуйте позже');
  assert.deepStrictEqual(['nutrition_daily.csv', 'body.csv'].map(f => fs.readFileSync(path.join(dir, f), 'utf8')), before);
});

test('ranges', () => {
  assert.deepStrictEqual(updater.firstRange(new Date(2026, 10, 21)), ['2025-12', '2026-11']);
  assert.deepStrictEqual(updater.recentRange(new Date(2026, 10, 21)), ['2026-10', '2026-11']);
  assert.deepStrictEqual(updater.recentRange(new Date(2026, 0, 5)), ['2025-12', '2026-01']);
});

test('runAll: one at a time, no data.js on disk, busy cleared after failure', async () => {
  const dir = tmp();
  let release;
  const slow = {connected: () => true, update: () => new Promise(r => { release = r; })};
  const failing = {connected: () => true, update: async () => ({ok: false, error: 'Нет связи с Whoop — попробуйте позже'})};
  const u = updater.create({fatsecret: slow, whoop: failing});
  const first = u.runAll(dir);
  assert.strictEqual(u.busy, true);
  assert.deepStrictEqual(await u.runAll(dir), {busy: true});
  release({ok: true});
  const r = await first;
  assert.deepStrictEqual(r.fatsecret, {ok: true});
  assert.strictEqual(r.whoop.ok, false);
  assert.strictEqual(u.busy, false);
  assert.ok(!fs.existsSync(path.join(dir, 'data.js')));
  assert.strictEqual(u.status.whoop.lastError, 'Нет связи с Whoop — попробуйте позже');
});

test('runAll skips services that are not connected', async () => {
  const dir = tmp();
  let called = false;
  const u = updater.create({fatsecret: {connected: () => false, update: async () => { called = true; return {ok: true}; }}});
  assert.deepStrictEqual(await u.runAll(dir), {});
  assert.strictEqual(called, false);
});

/** Запрос, который не отвечает, пока его не отменят (signal) — как зависшая сеть. */
const hang = (url, opt = {}) => new Promise((_, fail) => opt.signal.addEventListener('abort', () => fail(opt.signal.reason)));
/** Ответ пришёл, а тело читается вечно. */
const hangBody = (url, opt = {}) => Promise.resolve(new Response(new ReadableStream({start(c) {
  opt.signal.addEventListener('abort', () => c.error(opt.signal.reason)); }})));

test('hung request or body → network error after the timeout, files untouched', async () => {
  for (const fetch of [hang, hangBody]) {
    await assert.rejects(fs_.month(APP, USER, '2026-11', {fetch, timeout: 20}), e => e.kind === 'network');
    const dir = tmp(), before = fs.readFileSync(path.join(dir, 'nutrition_daily.csv'), 'utf8');
    const r = await fs_.update({dir, app: APP, user: USER, months: ['2026-11', '2026-11'], fetch, timeout: 20});
    assert.deepStrictEqual(r, {ok: false, kind: 'network', error: 'Нет связи с FatSecret — попробуйте позже'});
    assert.strictEqual(fs.readFileSync(path.join(dir, 'nutrition_daily.csv'), 'utf8'), before);
  }
});

test('link for another person: saved in the profile secrets (600), read back, broken file → none, cleared', () => {
  const dir = tmp();
  assert.strictEqual(fs_.link.read(dir), null);
  fs_.link.save(dir, {token: 'rt', secret: 'rs', url: fs_.authorizeUrl('rt')}, new Date('2026-11-24T10:00:00Z'));
  const f = path.join(dir, 'secrets', 'fatsecret_link.json');
  assert.strictEqual(fs.statSync(f).mode & 0o777, 0o600);
  assert.deepStrictEqual(fs_.link.read(dir), {token: 'rt', secret: 'rs', url: 'https://authentication.fatsecret.com/oauth/authorize?oauth_token=rt',
                                               created: '2026-11-24T10:00:00.000Z'});
  for (const bad of ['{', '{"token":"rt"}', '[]']) { fs.writeFileSync(f, bad); assert.strictEqual(fs_.link.read(dir), null, bad); }
  fs_.link.clear(dir);
  assert.ok(!fs.existsSync(f));
  fs_.link.clear(dir);                                         // нет файла — не ошибка
});

/** Заглушка access_token: код подходит только к запросу с токеном good; net — нет связи. */
function fakeAuth({net = false} = {}) {
  const seen = [];
  const fetch = async url => {
    const t = new URL(url).searchParams.get('oauth_token'); seen.push(t);
    if (net) throw new Error('offline');
    return t === 'good' ? resp('oauth_token=at&oauth_token_secret=as') : resp('Invalid token', 401);
  };
  return {fetch, seen};
}
const W = t => ({via: 'window', t: {token: t, secret: 's'}}), L = t => ({via: 'link', t: {token: t, secret: 's'}});

test('code goes to the login window first, then to the link: a window closed without a code does not eat the link code', async () => {
  let f = fakeAuth();
  assert.deepStrictEqual(await fs_.exchangeCode(APP, [W('stale'), L('good')], '123', {fetch: f.fetch}),
                         {via: 'link', user: {access_token: 'at', access_secret: 'as'}});
  assert.deepStrictEqual(f.seen, ['stale', 'good']);
  f = fakeAuth();
  assert.strictEqual((await fs_.exchangeCode(APP, [W('good'), L('other')], '123', {fetch: f.fetch})).via, 'window');
  assert.deepStrictEqual(f.seen, ['good'], 'ссылку не трогаем, если код подошёл к окну');
});

test('wrong code: text by where it went (link → make a new link; window → connect again); no network → as is, nothing else tried', async () => {
  await assert.rejects(fs_.exchangeCode(APP, [W('x'), L('y')], '1', {fetch: fakeAuth().fetch}),
                       {message: 'Код не подошёл или ссылка устарела — проверьте код или сделайте новую ссылку'});
  await assert.rejects(fs_.exchangeCode(APP, [W('x')], '1', {fetch: fakeAuth().fetch}),
                       {message: 'Код не подошёл — проверьте его или нажмите «Подключить» ещё раз'});
  const f = fakeAuth({net: true});
  await assert.rejects(fs_.exchangeCode(APP, [W('x'), L('good')], '1', {fetch: f.fetch}), {kind: 'network'});
  assert.strictEqual(f.seen.length, 1);
});

// ---------- продукты из дневника (food_entries.get.v2) — данные придуманные, той же формы, что у FatSecret ----------
/** Запись дневника, как её отдаёт FatSecret: всё строками. */
const fe = (id, ds, meal, name, desc, kcal, extra = {}) => Object.assign({food_entry_id: String(id), date_int: di(ds), meal,
  food_entry_name: name, food_entry_description: `${desc} ${name}`, calories: String(kcal), protein: '1.25', fat: '0.5',
  carbohydrate: '7.14', food_id: '100001', serving_id: '200001', number_of_units: '1.000'}, extra);

test('amount: portion text for the window', () => {
  const a = (d, n = 'Чай с лимоном') => fs_.amount(`${d} ${n}`, n);
  assert.strictEqual(a('40 g'), '40 г');
  assert.strictEqual(a('2 medium'), '2 шт');
  assert.strictEqual(a('1 coffee cup'), '1 чашка');
  assert.strictEqual(a('1 cup'), '1 чашка');
  assert.strictEqual(a('2'), '2 шт');
  assert.strictEqual(a('0.2 :custom:20 г'), '20 г');
  assert.strictEqual(a('1/2 :custom:50 г'), '50 г');
  assert.strictEqual(a('80 :custom:80s  г'), '80 г');
  assert.strictEqual(a('1 :custom:1 порцияininini (250 г)'), '1 порция (250 г)');
  assert.strictEqual(a('1 serving'), '1 порция');
  assert.strictEqual(a('3 slices'), '3 slices');          // неизвестное — как есть
});

test('entries of a day: one object or a list, meal in lower case, numbers, empty day, token error', async () => {
  const one = {food_entries: {food_entry: fe(11, '2026-11-23', 'Breakfast', 'Чай с лимоном', '1 cup', '30', {sugar: '6.54'})}};
  const rows = await fs_.entries(APP, USER, '2026-11-23', {fetch: () => resp(one)});
  assert.deepStrictEqual(rows, [{id: '11', date: '2026-11-23', meal: 'breakfast', name: 'Чай с лимоном', amount: '1 чашка',
    kcal: 30, protein: 1.2, fat: 0.5, carbs: 7.1, fiber: null, sugar: 6.5, food_id: '100001', serving_id: '200001', units: 1}]);
  const two = {food_entries: {food_entry: [fe(12, '2026-11-23', 'lunch', 'Гречка', '200 g', 220), fe(13, '2026-11-23', 'Other', 'Банан', '1 medium', 105)]}};
  assert.deepStrictEqual((await fs_.entries(APP, USER, '2026-11-23', {fetch: () => resp(two)})).map(r => [r.id, r.meal, r.amount]),
    [['12', 'lunch', '200 г'], ['13', 'other', '1 шт']]);
  assert.deepStrictEqual(await fs_.entries(APP, USER, '2026-11-23', {fetch: () => resp({food_entries: null})}), []);
  await assert.rejects(fs_.entries(APP, USER, '2026-11-23', {fetch: () => resp({error: {code: 9, message: 'Invalid token'}})}), e => e.kind === 'token');
});

test('entry days: 14 until last week has products, then 7', () => {
  const dir = tmp(), today = new Date(2026, 10, 27);         // пятница; прошлая неделя — 16–22.11
  const days = fs_.entryDays(dir, today);
  assert.strictEqual(days.length, 14);
  assert.deepStrictEqual([days[0], days[13]], ['2026-11-14', '2026-11-27']);
  store.upsert(dir, 'food_entries.csv', {'1': {date: '2026-11-17', meal: 'lunch', name: 'Гречка', kcal: 220}});
  assert.deepStrictEqual(fs_.entryDays(dir, today), ['2026-11-21', '2026-11-22', '2026-11-23', '2026-11-24', '2026-11-25', '2026-11-26', '2026-11-27']);
});

test('update writes entries: text with commas and quotes, entries gone from a day are removed, days outside kept', async () => {
  const dir = tmp(), today = new Date(2026, 10, 27);
  store.upsert(dir, 'food_entries.csv', {'5': {date: '2026-11-25', meal: 'dinner', name: 'Удалённый', kcal: 100},
                                         '6': {date: '2026-11-10', meal: 'dinner', name: 'Давний', kcal: 100}});
  const entries = {'2026-11-25': [fe(21, '2026-11-25', 'lunch', 'Сыр "Лёгкий", 20%', '0.2 :custom:20 г', 52)],
                   '2026-11-27': [fe(22, '2026-11-27', 'breakfast', 'Чай с лимоном', '1 cup', 30)]};
  const r = await fs_.update({dir, app: APP, user: USER, months: ['2026-11', '2026-11'], fetch: fakeApi({entries}), today});
  assert.deepStrictEqual(r, {ok: true, days: 0, weights: 0, entries: 2});
  const rows = store.read(dir, 'food_entries.csv');
  assert.deepStrictEqual(rows.map(x => [x.id, x.date, x.name, x.amount]),
    [['6', '2026-11-10', 'Давний', ''], ['21', '2026-11-25', 'Сыр "Лёгкий", 20%', '20 г'], ['22', '2026-11-27', 'Чай с лимоном', '1 чашка']]);
});

test('failed entries request: nothing written', async () => {
  const dir = tmp(), today = new Date(2026, 10, 27);
  store.upsert(dir, 'nutrition_daily.csv', {'2026-10-01': {kcal: 1900}});
  store.upsert(dir, 'food_entries.csv', {'5': {date: '2026-11-25', meal: 'dinner', name: 'Ужин', kcal: 100}});
  const files = ['nutrition_daily.csv', 'body.csv', 'food_entries.csv'], before = files.map(f => fs.readFileSync(path.join(dir, f), 'utf8'));
  const fetch = fakeApi({food: {'2026-11': [['2026-11-02', 2000, 1, 1, 1]]}, failAt: 4, fail: () => Promise.reject(new TypeError('net'))});
  const r = await fs_.update({dir, app: APP, user: USER, months: ['2026-11', '2026-11'], fetch, today});   // 2 месячных, потом дни
  assert.strictEqual(r.ok, false);
  assert.deepStrictEqual(files.map(f => fs.readFileSync(path.join(dir, f), 'utf8')), before);
});
