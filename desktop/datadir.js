// Где лежат данные пользователя: путь хранится в настройках приложения (userData/config.json).
// При первом запуске (или если папка пропала) приложение спрашивает: новая папка или уже существующая.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const SCHEMA = require('./schema.json');

const CSV = Object.keys(SCHEMA.schema);
const hasCsv = dir => CSV.some(f => fs.existsSync(path.join(dir, f)));
const cfgFile = userData => path.join(userData, 'config.json');

function readCfg(userData) {
  try { return JSON.parse(fs.readFileSync(cfgFile(userData), 'utf8')); } catch (e) { return {}; }
}

/** {dir: путь, если сохранён и существует; missing: сохранённый, но пропавший путь}. */
function current(userData) {
  const d = readCfg(userData).dataDir;
  if (!d) return {dir: null, missing: null};
  return fs.existsSync(d) ? {dir: d, missing: null} : {dir: null, missing: d};
}

/** Дописать поля в настройки приложения (остальные не трогаем). */
function saveCfg(userData, patch) {
  fs.mkdirSync(userData, {recursive: true});
  fs.writeFileSync(cfgFile(userData), JSON.stringify(Object.assign(readCfg(userData), patch), null, 2));
}

const save = (userData, dir) => saveCfg(userData, {dataDir: dir});

/** Выбранная папка → папка данных: её data/ с CSV, она сама (если в ней CSV), иначе новая <папка>/Здоровье/data. */
function fromPicked(picked) {
  if (hasCsv(path.join(picked, 'data'))) return {dir: path.join(picked, 'data'), existing: true};
  if (hasCsv(picked)) return {dir: picked, existing: true};
  return {dir: path.join(picked, 'Здоровье', 'data'), existing: false};
}

const defaultDir = documents => path.join(documents, 'Здоровье', 'data');

/** Папка настроек приложения (как app.getPath('userData')) — для скриптов сборки и разработки вне Electron. */
const appUserData = () => path.join(os.homedir(), 'Library', 'Application Support', 'Здоровье');

/** Папка данных из настроек приложения или null. */
const configured = () => current(appUserData()).dir;

module.exports = {current, save, saveCfg, readCfg, fromPicked, defaultDir, hasCsv, appUserData, configured};
