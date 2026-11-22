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

/** Токены сервисов (file(name) → путь): сохраняются только поля токенов. saver(name) — сохранение для начатого входа или
 *  обновления: после clear(name) («Отключить») оно ничего не пишет — запрос, начатый до отключения, не подключит сервис снова. */
function keeper(file) {
  const gen = {};
  const put = (name, obj) => save(file(name), Object.fromEntries(Object.entries(obj).filter(([k]) => TOKENS.includes(k))));
  return {
    save: put,
    clear(name) { gen[name] = (gen[name] || 0) + 1; clear(file(name)); },
    saver(name) {
      const g = gen[name] || 0;
      return obj => { if ((gen[name] || 0) !== g) return false; put(name, obj); return true; };
    },
  };
}

module.exports = {save, clear, read, keeper, TOKENS};
