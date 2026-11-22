// Ключи приложений (не пользователя): FatSecret consumer_key/secret, Whoop client_id/secret.
// В собранном приложении — <name>_app.json рядом с main.js (кладёт scripts/prepare.js). При разработке — из <папка данных>/secrets:
// <name>_app.json, а пока его нет — поля ключа приложения из <name>.json (FatSecret — решение пользователя 21.11.2026).
const fs = require('node:fs');
const path = require('node:path');
const datadir = require('./datadir');

const FIELDS = {fatsecret: ['consumer_key', 'consumer_secret'], whoop: ['client_id', 'client_secret', 'redirect_uri']};

const filled = v => typeof v === 'string' && v.trim() !== '' && !v.startsWith('ВСТАВЬ');   // «ВСТАВЬ_…» — незаполненный шаблон

function pick(obj, fields) {
  const out = {};
  for (const f of fields) if (filled(obj[f])) out[f] = obj[f];
  return out;
}

/** secrets папки данных из настроек приложения (или null). */
const dataSecrets = () => { const d = datadir.configured(); return d ? path.join(d, 'secrets') : null; };

function appKey(name, {packaged = false, here = __dirname, secrets = dataSecrets()} = {}) {
  const cands = [path.join(here, `${name}_app.json`)];
  if (!packaged && secrets) {
    cands.push(path.join(secrets, `${name}_app.json`));
    // пока нет отдельных ключей — ключи приложений из файлов с токенами (старая раскладка папки данных; только при разработке)
    cands.push(path.join(secrets, `${name}.json`));
  }
  for (const f of cands) {
    if (!fs.existsSync(f)) continue;
    const k = pick(JSON.parse(fs.readFileSync(f, 'utf8')), FIELDS[name]);
    if (k[FIELDS[name][0]] && k[FIELDS[name][1]]) return k;
  }
  return null;
}

module.exports = {appKey, FIELDS, pick, dataSecrets};
