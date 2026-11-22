// Проверка приватности сборки: ни путей с личным, ни значений из data/secrets (кроме ключей приложений).
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const privacy = require('../scripts/privacy');

function secrets() {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'health-sec-'));
  fs.writeFileSync(path.join(d, 'fatsecret.json'), JSON.stringify({consumer_key: 'ck-12345678', consumer_secret: 'cs-12345678',
    access_token: 'at-12345678', access_secret: 'as-12345678'}));
  fs.writeFileSync(path.join(d, 'whoop.json'), JSON.stringify({client_id: 'wid-12345678', client_secret: 'wsec-12345678',
    redirect_uri: 'http://localhost:8765/callback', refresh_token: 'rt-12345678', expires_at: 1795000000}));
  fs.writeFileSync(path.join(d, 'telegram.json'), JSON.stringify({token: '123456:ABCDEFGH', chat_id: '-100123456789'}));
  return d;
}

function app(files) {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'health-app-'));
  for (const [rel, text] of Object.entries(files)) { fs.mkdirSync(path.dirname(path.join(d, rel)), {recursive: true}); fs.writeFileSync(path.join(d, rel), text); }
  return d;
}

test('secretValues: user tokens and telegram, not app keys', () => {
  const v = privacy.secretValues(secrets(), {fatsecret: ['consumer_key', 'consumer_secret'], whoop: ['client_id', 'client_secret', 'redirect_uri']});
  assert.deepStrictEqual(v.sort(), ['-100123456789', '123456:ABCDEFGH', '1795000000', 'as-12345678', 'at-12345678', 'rt-12345678'].sort());
});

test('secretValues: dates and timestamps are not secrets (CHANGELOG has dates)', () => {
  const d = secrets();
  fs.writeFileSync(path.join(d, 'telegram_state.json'), JSON.stringify({brief_sent: '2026-11-21', at: '2026-11-21T09:00:00Z',
    at2: '2026-11-21 09:00:00+03:00', note: 'tok-2026-11-21'}));
  const v = privacy.secretValues(d, {});
  for (const s of ['2026-11-21', '2026-11-21T09:00:00Z', '2026-11-21 09:00:00+03:00']) assert.ok(!v.includes(s), s);
  assert.ok(v.includes('tok-2026-11-21'));
  privacy.check(app({'CHANGELOG.md': '## [0.1.0] — 2026-11-21'}), v);
});

test('check: clean app passes, app keys allowed', () => {
  const s = secrets();
  const values = privacy.secretValues(s, {fatsecret: ['consumer_key', 'consumer_secret'], whoop: ['client_id', 'client_secret', 'redirect_uri']});
  privacy.check(app({'main.js': 'ok', 'fatsecret_app.json': '{"consumer_key":"ck-12345678","consumer_secret":"cs-12345678"}',
                     'portal/dashboard.html': '<html>'}), values);
});

test('check: planted token or personal path fails', () => {
  const values = privacy.secretValues(secrets(), {fatsecret: ['consumer_key', 'consumer_secret'], whoop: []});
  assert.throws(() => privacy.check(app({'main.js': 'const t = "at-12345678";'}), values), /at-1…|секрет/);
  for (const bad of ['data/body.csv', 'portal/data.js', 'docs/x.md', 'CLAUDE.md', '.git/HEAD', 'tests/t.py', 'data/photos/a.jpg'])
    assert.throws(() => privacy.check(app({[bad]: 'x'}), []), /личное/, bad);
});
