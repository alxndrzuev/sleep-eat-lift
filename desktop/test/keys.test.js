// Ключи приложений: только нужные поля; в собранном приложении — только файл рядом с main.js.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {appKey} = require('../keys');

test('fatsecret key: own file first, dev fallback to the data folder secrets, packaged ignores dev', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'health-keys-'));
  const here = path.join(root, 'desktop'); fs.mkdirSync(here);
  const secrets = path.join(root, 'data', 'secrets'); fs.mkdirSync(secrets, {recursive: true});
  fs.writeFileSync(path.join(root, 'data', 'secrets', 'fatsecret.json'),
    JSON.stringify({consumer_key: 'ck', consumer_secret: 'cs', access_token: 'USER', access_secret: 'USER2'}));
  assert.deepStrictEqual(appKey('fatsecret', {here, secrets}), {consumer_key: 'ck', consumer_secret: 'cs'});
  assert.strictEqual(appKey('fatsecret', {here, packaged: true}), null);
  fs.writeFileSync(path.join(here, 'fatsecret_app.json'), JSON.stringify({consumer_key: 'k2', consumer_secret: 's2', x: 1}));
  assert.deepStrictEqual(appKey('fatsecret', {here, packaged: true}), {consumer_key: 'k2', consumer_secret: 's2'});
  assert.strictEqual(appKey('whoop', {here, secrets}), null);
  fs.writeFileSync(path.join(root, 'data', 'secrets', 'whoop.json'),
    JSON.stringify({client_id: 'id', client_secret: 'sec', redirect_uri: 'http://localhost:8765/callback', refresh_token: 'USER'}));
  assert.deepStrictEqual(appKey('whoop', {here, secrets}), {client_id: 'id', client_secret: 'sec', redirect_uri: 'http://localhost:8765/callback'});
  assert.strictEqual(appKey('whoop', {here, packaged: true}), null);
});

test('placeholder values from the template are not a key', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'health-keys-'));
  const here = path.join(root, 'desktop'); fs.mkdirSync(here);
  const secrets = path.join(root, 'data', 'secrets'); fs.mkdirSync(secrets, {recursive: true});
  fs.writeFileSync(path.join(root, 'data', 'secrets', 'whoop_app.json'),
    JSON.stringify({client_id: 'ВСТАВЬ_CLIENT_ID', client_secret: 'ВСТАВЬ_CLIENT_SECRET', redirect_uri: 'https://health.local/whoop'}));
  assert.strictEqual(appKey('whoop', {here, secrets}), null);
});
