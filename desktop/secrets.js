// Ключи доступа пользователя в data/secrets/<сервис>.json: приложение дописывает свои поля (токены) и не трогает остальные —
// в старой раскладке папки данных там же лежат ключи приложений (consumer_key, client_id …).
const fs = require('node:fs');

const TOKENS = ['access_token', 'access_secret', 'refresh_token', 'expires_at'];

function read(f) {
  try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch (e) { return {}; }
}

function writeJson(f, obj) {
  fs.writeFileSync(f + '.tmp', JSON.stringify(obj, null, 2), {mode: 0o600});
  fs.renameSync(f + '.tmp', f);
  fs.chmodSync(f, 0o600);
}

/** Дописать поля (токены) в файл, остальное сохранить. */
function save(f, fields) { writeJson(f, Object.assign(read(f), fields)); }

/** «Отключить»: убрать только токены; файл, где больше ничего нет, удалить. */
function clear(f) {
  if (!fs.existsSync(f)) return;
  const rest = Object.fromEntries(Object.entries(read(f)).filter(([k]) => !TOKENS.includes(k)));
  if (Object.keys(rest).length) writeJson(f, rest); else fs.rmSync(f);
}

module.exports = {save, clear, read, TOKENS};
