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
