// Ключи доступа пользователя: приложение дописывает свои поля и не трогает остальные (в старой раскладке папки данных там ключи для auto_update).
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const secrets = require('../secrets');

test('save merges tokens into existing file; clear removes only tokens', () => {
  const f = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'health-sec-')), 'whoop.json');
  fs.writeFileSync(f, JSON.stringify({client_id: 'id', client_secret: 'sec', redirect_uri: 'r', refresh_token: 'old'}));
  secrets.save(f, {access_token: 'a', refresh_token: 'new', expires_at: 5});
  assert.deepStrictEqual(JSON.parse(fs.readFileSync(f)), {client_id: 'id', client_secret: 'sec', redirect_uri: 'r', refresh_token: 'new', access_token: 'a', expires_at: 5});
  assert.strictEqual(fs.statSync(f).mode & 0o777, 0o600);
  secrets.clear(f);
  assert.deepStrictEqual(JSON.parse(fs.readFileSync(f)), {client_id: 'id', client_secret: 'sec', redirect_uri: 'r'});
});

test('new file and clear of missing file', () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'health-sec-'));
  secrets.save(path.join(d, 'fatsecret.json'), {access_token: 't', access_secret: 's'});
  assert.deepStrictEqual(JSON.parse(fs.readFileSync(path.join(d, 'fatsecret.json'))), {access_token: 't', access_secret: 's'});
  secrets.clear(path.join(d, 'nope.json'));
  assert.ok(!fs.existsSync(path.join(d, 'nope.json')));
});

test('«Отключить» во время обновления: токены, полученные после него, не сохраняются', async () => {
  const store = require('../store'), whoop = require('../whoop');
  const dir = store.dataDir(fs.mkdtempSync(path.join(os.tmpdir(), 'health-sec-')));
  store.init(dir);
  const file = name => path.join(dir, 'secrets', name + '.json');
  const keys = secrets.keeper(file);
  keys.save('whoop', {refresh_token: 'r', access_token: 'a', expires_at: 0});
  let answer;                                                              // ответ на обновление токена придёт позже
  const fetch = url => url.startsWith(whoop.TOKEN_URL)
    ? new Promise(r => { answer = () => r(new Response(JSON.stringify({access_token: 'new', refresh_token: 'new-r', expires_in: 3600}))); })
    : Promise.resolve(new Response(JSON.stringify({records: []})));
  const run = whoop.update({dir, app: {client_id: 'c', client_secret: 's'}, user: {refresh_token: 'r', access_token: 'a', expires_at: 0},
                            days: 14, fetch, saveUser: keys.saver('whoop'), sleep: async () => {}});
  await new Promise(r => setImmediate(r));
  keys.clear('whoop');                                                     // «Отключить», пока запрос идёт
  answer();
  await run;
  assert.ok(!fs.existsSync(file('whoop')));
  keys.saver('whoop')({refresh_token: 'again'});                           // новое подключение — сохраняется
  assert.strictEqual(JSON.parse(fs.readFileSync(file('whoop'))).refresh_token, 'again');
});

test('saver keeps the file it started with: a sign-in started in one profile writes there even if the profile switched', () => {
  const a = fs.mkdtempSync(path.join(os.tmpdir(), 'health-sec-a-')), b = fs.mkdtempSync(path.join(os.tmpdir(), 'health-sec-b-'));
  let cur = a;
  const keys = secrets.keeper(name => path.join(cur, `${name}.json`));
  const save = keys.saver('whoop');
  cur = b;                                                           // пока шёл вход, переключили профиль
  assert.strictEqual(save({refresh_token: 'ivan'}), true);
  assert.strictEqual(secrets.read(path.join(a, 'whoop.json')).refresh_token, 'ivan');
  assert.ok(!fs.existsSync(path.join(b, 'whoop.json')));
});
