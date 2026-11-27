// Журнал работы SEL (log.js): папка logs рядом с папкой данных, файл на день, старые удаляются, ключи не попадают в текст.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const logLib = require('../log');

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'sel-log-'));
const at = s => () => new Date(s);
const read = (dir, day) => fs.readFileSync(path.join(dir, `sel-${day}.log`), 'utf8');

test('dir: logs next to the data folder', () => {
  assert.strictEqual(logLib.dir(path.join('/u', 'Documents', 'SEL', 'data')), path.join('/u', 'Documents', 'SEL', 'logs'));
});

test('lines before the folder is known are kept and written once it is set', () => {
  const d = tmp(), log = logLib.create({now: at('2026-11-27T09:05:03.042')});
  log.info('запуск', {version: '2.3.0'});
  log.warn('что-то', {n: 2});
  log.setDir(d);
  log.error('сбой', new Error('нет связи'));
  assert.deepStrictEqual(read(d, '2026-11-27').split('\n'), [
    '2026-11-27 09:05:03.042 INFO  запуск version=2.3.0',
    '2026-11-27 09:05:03.042 WARN  что-то n=2',
    '2026-11-27 09:05:03.042 ERROR сбой: нет связи',
    '']);
});

test('a file per day; files older than keepDays are removed, other files left alone', () => {
  const d = tmp();
  for (const f of ['sel-2026-10-01.log', 'sel-2026-10-29.log', 'sel-2026-11-20.log', 'notes.txt']) fs.writeFileSync(path.join(d, f), 'x');
  let now = new Date('2026-11-27T23:59:00');
  const log = logLib.create({now: () => now, keepDays: 30});
  log.setDir(d);
  log.info('вечер');
  now = new Date('2026-11-28T00:01:00');
  log.info('утро');
  assert.deepStrictEqual(fs.readdirSync(d).sort(),
    ['notes.txt', 'sel-2026-10-29.log', 'sel-2026-11-20.log', 'sel-2026-11-27.log', 'sel-2026-11-28.log']);
  assert.match(read(d, '2026-11-28'), /утро/);
  assert.doesNotMatch(read(d, '2026-11-28'), /вечер/);
});

test('tokens, codes and secrets never get into the log', () => {
  const s = logLib.redact('GET https://x/?oauth_token=abc123&oauth_verifier=987&oauth_signature=s%3D&month=2026-11 ' +
    '{"access_token":"tok1","refresh_token":"tok2","expires_in":3600} Authorization: Bearer eyJhbGc.x.y code=ZZZ&state=QQQ client_secret=SEC');
  for (const v of ['abc123', '987', 's%3D', 'tok1', 'tok2', 'eyJhbGc', 'ZZZ', 'QQQ', 'SEC']) assert.ok(!s.includes(v), `${v} в «${s}»`);
  assert.match(s, /month=2026-11/);
  assert.match(s, /"expires_in":3600/);
  const d = tmp(), log = logLib.create({now: at('2026-11-27T10:00:00')});
  log.setDir(d);
  log.error('вход', new Error('HTTP 401: {"access_token":"tok1"}'), {url: 'https://x/cb?code=ZZZ'});
  assert.ok(!/tok1|ZZZ/.test(read(d, '2026-11-27')));
});

test('fields: strings with spaces quoted, objects as JSON, empty ones skipped, long text cut', () => {
  const line = logLib.format(new Date('2026-11-27T10:00:00'), 'info', 'обновление',
    {service: 'whoop', error: 'нет связи', r: {days: 14}, none: undefined, nil: null, ms: 1200});
  assert.strictEqual(line, '2026-11-27 10:00:00.000 INFO  обновление service=whoop error="нет связи" r={"days":14} ms=1200');
  assert.ok(logLib.format(new Date(), 'info', 'x', {t: 'я'.repeat(5000)}).length < 2100);
});

test('the log never breaks the app: unwritable folder, a day too long', () => {
  const d = tmp(), file = path.join(d, 'file');
  fs.writeFileSync(file, '');
  const log = logLib.create({now: at('2026-11-27T10:00:00')});
  log.setDir(path.join(file, 'logs'));                       // папку не создать — журнал молчит
  log.info('ничего');
  const big = logLib.create({now: at('2026-11-27T10:00:00'), maxBytes: 300});
  big.setDir(d);
  for (let i = 0; i < 50; i++) big.info('строка ' + i);
  const text = read(d, '2026-11-27');
  assert.ok(text.length < 500, text.length);
  assert.match(text, /журнал за день слишком большой/);
});
