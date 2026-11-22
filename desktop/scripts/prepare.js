// Перед сборкой: у версии есть заметки в CHANGELOG.md; ключи приложений → desktop/<сервис>_app.json (только поля ключа приложения; файлы не в git).
// FatSecret — <папка данных>/secrets/fatsecret_app.json, а пока его нет — consumer-поля из fatsecret.json (решение пользователя 21.11.2026).
// Whoop — только <папка данных>/secrets/whoop_app.json; нет — сборка без Whoop (в «Настройках»: «нет ключа в этой сборке»).
const fs = require('node:fs');
const path = require('node:path');
const {appKey, FIELDS, pick, dataSecrets} = require('../keys');
const changelog = require('../changelog');

const HERE = path.join(__dirname, '..'), SECRETS = dataSecrets();   // <папка данных из настроек приложения>/secrets
const VERSION = require('../package.json').version;               // версию без заметок не собираем
if (!changelog.entry(fs.readFileSync(path.join(HERE, 'CHANGELOG.md'), 'utf8'), VERSION)) {
  console.error(`Нет заметок к версии ${VERSION} в CHANGELOG.md — выпустите версию: npm run release X.Y.Z`); process.exit(1);
}
if (!SECRETS) { console.error('Не найдена папка данных: запустите приложение и выберите её'); process.exit(1); }
for (const f of ['fatsecret_app.json', 'whoop_app.json']) fs.rmSync(path.join(HERE, f), {force: true});

const fsKey = appKey('fatsecret', {here: path.join(HERE, '__none__'), secrets: SECRETS});
if (!fsKey) { console.error('Нет ключа приложения FatSecret: data/secrets/fatsecret_app.json'); process.exit(1); }
fs.writeFileSync(path.join(HERE, 'fatsecret_app.json'), JSON.stringify(fsKey), {mode: 0o600});   // ключ — только владельцу

const wf = path.join(SECRETS, 'whoop_app.json');
const wk = fs.existsSync(wf) ? pick(JSON.parse(fs.readFileSync(wf, 'utf8')), FIELDS.whoop) : {};
if (wk.client_id && wk.client_secret) {
  const k = wk;
  fs.writeFileSync(path.join(HERE, 'whoop_app.json'), JSON.stringify(k), {mode: 0o600});
  console.log('Ключи: FatSecret, Whoop');
} else console.log('Ключи: FatSecret (Whoop — не заполнен data/secrets/whoop_app.json, сборка без Whoop)');
