// Где лежат данные пользователя: путь хранится в настройках приложения (userData/config.json).
// При первом запуске (или если папка пропала) приложение спрашивает: новая папка или уже существующая.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const SCHEMA = require('./schema.json');

const CSV = Object.keys(SCHEMA.schema);
const hasCsv = dir => CSV.some(f => fs.existsSync(path.join(dir, f)));
/** Корень с профилями (2.0): profiles/ и в ней хотя бы одна папка. */
const hasProfiles = dir => {
  try { return fs.readdirSync(path.join(dir, 'profiles'), {withFileTypes: true}).some(d => d.isDirectory()); }
  catch (e) { return false; }
};
const hasData = dir => hasCsv(dir) || hasProfiles(dir);
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

/** Выбранная папка → папка данных: её data/ с данными (профили или CSV 1.x), она сама, иначе новая <папка>/SEL/data. */
function fromPicked(picked) {
  const up = path.dirname(path.dirname(picked));                     // выбрали папку самого профиля — берём его корень
  if (fs.existsSync(path.join(picked, 'profile.json')) && path.basename(path.dirname(picked)) === 'profiles') return {dir: up, existing: true};
  if (hasData(path.join(picked, 'data'))) return {dir: path.join(picked, 'data'), existing: true};
  if (hasData(picked)) return {dir: picked, existing: true};
  return {dir: path.join(picked, 'SEL', 'data'), existing: false};
}

/** Приложение раньше называлось «Здоровье»: его настройки (config.json — папка данных, просмотренная версия) и тема
 * страниц (Local Storage) переносятся в папку настроек SEL, если в ней ещё нет config.json. → перенесено ли. */
const OLD_NAME = 'Здоровье';
function migrate(oldUserData, userData) {
  if (fs.existsSync(cfgFile(userData)) || !fs.existsSync(cfgFile(oldUserData))) return false;
  fs.mkdirSync(userData, {recursive: true});
  const ls = path.join(oldUserData, 'Local Storage');
  if (fs.existsSync(ls) && !fs.existsSync(path.join(userData, 'Local Storage')))
    fs.cpSync(ls, path.join(userData, 'Local Storage'), {recursive: true});
  fs.copyFileSync(cfgFile(oldUserData), cfgFile(userData));          // последним: есть config.json — перенос сделан
  return true;
}

const defaultDir = documents => path.join(documents, 'SEL', 'data');

/** Папка настроек приложения (как app.getPath('userData')) — для скриптов сборки и разработки вне Electron. */
const appUserData = () => path.join(os.homedir(), 'Library', 'Application Support', 'SEL');

/** Папка данных из настроек приложения или null. */
const configured = () => current(appUserData()).dir;

// ---------- формат папки данных: sel.json в корне ({format, app}) ----------
/** Устройство папки данных, которое знает эта версия SEL. Растёт только когда меняется само устройство (вместе с X в
 *  версии: 2 — профили, 2.0). SEL не открывает папку с форматом новее — данные обновлены более новой версией. */
const FORMAT = 2;
const FORMAT_FILE = 'sel.json';

function readFormat(root) {
  try { const j = JSON.parse(fs.readFileSync(path.join(root, FORMAT_FILE), 'utf8')); return Number.isInteger(j.format) ? j : null; }
  catch (e) { return null; }                                         // нет файла или испорчен — как будто формата нет
}

/** {ok, format, app}: ok — эта SEL может открыть папку (формата нет, тот же или старее). */
function checkFormat(root) {
  const j = readFormat(root);
  return {ok: !j || j.format <= FORMAT, format: j ? j.format : null, app: j && typeof j.app === 'string' ? j.app : null};
}

/** Отметить, что папку открыла эта версия; формат не понижаем (запись — только если папка этой SEL по силам). */
function writeFormat(root, version) {
  const j = readFormat(root);
  if (j && j.format > FORMAT) return;
  const f = path.join(root, FORMAT_FILE);
  fs.writeFileSync(f + '.tmp', JSON.stringify({format: FORMAT, app: version}, null, 2) + '\n');
  fs.renameSync(f + '.tmp', f);
}

module.exports = {FORMAT, checkFormat, writeFormat, current, save, saveCfg, readCfg, fromPicked, defaultDir, hasCsv, hasProfiles, hasData, appUserData, configured, migrate, OLD_NAME};
