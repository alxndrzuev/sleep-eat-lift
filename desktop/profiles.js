// Профили: несколько человек в одной папке данных. Корень (config.json → dataDir) — profiles/<id>/ и README;
// у каждого профиля свои CSV, фото, токены, sync.json, docs/ — ровно как раньше было в корне. id — латиница из имени
// при создании и дальше не меняется; имя — в profile.json. Дизайн — docs/superpowers/specs/2026-11-23-profiles-design.md.
const fs = require('node:fs');
const path = require('node:path');
const store = require('./store');

const PROFILES = 'profiles';
const ID = /^[a-z0-9-]+$/;
const TR = {а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'yo', ж: 'zh', з: 'z', и: 'i', й: 'y', к: 'k', л: 'l', м: 'm',
  н: 'n', о: 'o', п: 'p', р: 'r', с: 's', т: 't', у: 'u', ф: 'f', х: 'kh', ц: 'ts', ч: 'ch', ш: 'sh', щ: 'shch', ъ: '',
  ы: 'y', ь: '', э: 'e', ю: 'yu', я: 'ya'};

/** Имя → id: транслитерация, [a-z0-9-], до 32 символов; пусто → profile; занято → -2, -3… */
function slug(name, taken) {
  const base = [...String(name || '').toLowerCase()].map(c => (c in TR ? TR[c] : c)).join('')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 32).replace(/-+$/, '') || 'profile';
  let id = base;
  for (let n = 2; taken.has(id); n++) id = `${base}-${n}`;
  return id;
}

/** Имя профиля: пробелы по краям убраны, подряд — один; 1–40 символов. */
function cleanName(name) {
  const s = String(name ?? '').replace(/\s+/g, ' ').trim();
  if (!s || [...s].length > 40) throw new Error('Имя: от 1 до 40 символов');
  return s;
}

function dir(root, id) {
  if (typeof id !== 'string' || !ID.test(id)) throw new Error('Нет такого профиля: ' + id);
  return path.join(root, PROFILES, id);
}

const metaFile = (root, id) => path.join(dir(root, id), 'profile.json');
function readMeta(root, id) {
  try { const m = JSON.parse(fs.readFileSync(metaFile(root, id), 'utf8')); return m && typeof m.name === 'string' ? m : null; }
  catch (e) { return null; }
}
function writeMeta(root, id, meta) {
  const f = metaFile(root, id);
  fs.writeFileSync(f + '.tmp', JSON.stringify(meta, null, 2) + '\n');
  fs.renameSync(f + '.tmp', f);
}

/** Профили корня → [{id, name, created, migrating}] по имени. */
function list(root) {
  const base = path.join(root, PROFILES);
  if (!fs.existsSync(base)) return [];
  const out = [];
  for (const d of fs.readdirSync(base, {withFileTypes: true})) {
    if (!d.isDirectory() || !ID.test(d.name)) continue;
    const m = readMeta(root, d.name);
    if (m) out.push({id: d.name, name: m.name, created: m.created || null, migrating: !!m.migrating});
  }
  return out.sort((a, b) => a.name.localeCompare(b.name, 'ru') || (a.id < b.id ? -1 : 1));
}

function has(root, id) { return list(root).some(p => p.id === id); }

/** Новый пустой профиль → {id, dir}. */
function create(root, name, today, extra = {}) {
  const n = cleanName(name);
  const taken = new Set(fs.existsSync(path.join(root, PROFILES)) ? fs.readdirSync(path.join(root, PROFILES)) : []);
  const id = slug(n, taken), d = dir(root, id);
  fs.mkdirSync(d, {recursive: true});
  writeMeta(root, id, Object.assign({name: n, created: today}, extra));
  store.init(d);
  return {id, dir: d};
}

function rename(root, id, name) {
  const m = readMeta(root, id);
  if (!m) throw new Error('Нет такого профиля: ' + id);
  writeMeta(root, id, Object.assign(m, {name: cleanName(name)}));
}

/** Какой профиль открыть: wanted, если есть; иначе первый; профилей нет — null. */
function pick(root, wanted) {
  const all = list(root);
  return (all.find(p => p.id === wanted) || all[0] || {}).id || null;
}

function photoCount(d) {
  const o = path.join(d, 'photos', 'originals');
  return fs.existsSync(o) ? fs.readdirSync(o, {withFileTypes: true}).filter(f => f.isFile() && !f.name.startsWith('.')).length : 0;
}

/** Удалить профиль: папку — в Корзину (trash — shell.trashItem); последний нельзя. */
async function remove(root, id, trash) {
  if (!has(root, id)) throw new Error('Нет такого профиля: ' + id);
  if (list(root).length < 2) throw new Error('Последний профиль удалить нельзя');
  await trash(dir(root, id));
}

// ---------- перенос 1.x: данные лежали прямо в корне ----------
const CSV = Object.keys(store.SCHEMA.schema);
/** Что приложение знает и переносит в профиль; всё остальное в корне не трогает. */
const KNOWN = [...CSV, 'sync.json', 'photos', 'docs', 'README.md', path.join('secrets', 'fatsecret.json'), path.join('secrets', 'whoop.json')];
const APP_FIELDS = {fatsecret: ['consumer_key', 'consumer_secret'], whoop: ['client_id', 'client_secret', 'redirect_uri']};

const readJson = f => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch (e) { return null; } };

/** Строк в CSV корня (без заголовка); испорченный — по числу непустых строк. */
function rowsIn(f) {
  if (!fs.existsSync(f)) return 0;
  return fs.readFileSync(f, 'utf8').split('\n').slice(1).filter(l => l.trim()).length;
}

/** Обновление с 1.x: в корне CSV из схемы, а профилей нет. */
function needsMigration(root) {
  return CSV.some(f => fs.existsSync(path.join(root, f))) && list(root).length === 0;
}

/** Ключи приложений из старых файлов с токенами → корневой secrets/<name>_app.json (если его ещё нет). */
function splitAppKeys(root) {
  for (const [name, fields] of Object.entries(APP_FIELDS)) {
    const out = path.join(root, 'secrets', `${name}_app.json`), src = readJson(path.join(root, 'secrets', `${name}.json`));
    if (fs.existsSync(out) || !src) continue;
    const k = {};
    for (const f of fields) if (typeof src[f] === 'string' && src[f].trim()) k[f] = src[f];
    if (!k[fields[0]] || !k[fields[1]]) continue;
    fs.writeFileSync(out + '.tmp', JSON.stringify(k, null, 2) + '\n');
    fs.renameSync(out + '.tmp', out);
  }
}

/** Переместить знакомое из корня в папку профиля (rename); нет источника или цель уже есть — пропуск. */
function moveKnown(root, d) {
  splitAppKeys(root);
  for (const rel of KNOWN) {
    const from = path.join(root, rel), to = path.join(d, rel);
    if (!fs.existsSync(from) || fs.existsSync(to)) continue;
    fs.mkdirSync(path.dirname(to), {recursive: true});
    fs.renameSync(from, to);
  }
}

/** Перенос в профиль id, отмеченный migrating: довести и снять отметку. */
function finish(root, id) {
  const d = dir(root, id);
  moveKnown(root, d);
  store.init(d);
  const m = readMeta(root, id);
  delete m.migrating;
  writeMeta(root, id, m);
  return {id, dir: d};
}

/** Новый профиль из данных корня: отметка migrating → перенос → снять отметку. Прошлая попытка упала посреди
 *  (есть профиль с migrating) — доводим её, а не заводим второй: иначе данные разъехались бы по двум профилям. */
function intoNew(root, name, today) {
  const n = cleanName(name);
  const half = list(root).find(p => p.migrating);
  if (half) { writeMeta(root, half.id, Object.assign(readMeta(root, half.id), {name: n})); return finish(root, half.id); }
  const base = path.join(root, PROFILES);
  const id = slug(n, new Set(fs.existsSync(base) ? fs.readdirSync(base) : []));
  fs.mkdirSync(dir(root, id), {recursive: true});
  writeMeta(root, id, {name: n, created: today, migrating: true});
  return finish(root, id);
}

/** Обновление с 1.x: данные корня → новый профиль name. */
function migrate(root, name, today) { return intoNew(root, name, today); }

/** Прерванный перенос (профиль с migrating) — довести; → id или null. */
function resume(root) {
  const p = list(root).find(x => x.migrating);
  return p ? finish(root, p.id).id : null;
}

/** Профили уже есть, а в корне CSV со строками (запускали 1.x, вернули копию) → {rows, sig} или null. */
function oldRootData(root) {
  if (!list(root).length) return null;
  const withRows = CSV.map(f => [f, rowsIn(path.join(root, f))]).filter(([, n]) => n > 0);
  if (!withRows.length) return null;
  const sig = JSON.stringify(withRows.map(([f]) => { const st = fs.statSync(path.join(root, f)); return [f, st.size, st.mtimeMs]; }));
  return {rows: withRows.reduce((a, [, n]) => a + n, 0), sig};
}

/** Старые данные корня → новый профиль (пустые CSV корня, созданные 1.x, переезжают вместе с ними). */
function adoptOld(root, name, today) { return intoNew(root, name, today); }

/** README.md корня — что такое профили (шаблон root_readme.md); чужой README (не с нашим заголовком) не трогаем. */
const ROOT_MARK = '# Папка данных SEL — профили';
function writeRootReadme(root) {
  const want = fs.readFileSync(path.join(__dirname, 'root_readme.md'), 'utf8'), f = path.join(root, 'README.md');
  if (fs.existsSync(f)) {
    const cur = fs.readFileSync(f, 'utf8');
    if (cur === want || !cur.startsWith(ROOT_MARK)) return;
  }
  fs.mkdirSync(root, {recursive: true});
  fs.writeFileSync(f + '.tmp', want);
  fs.renameSync(f + '.tmp', f);
}

/** Профиль открыт впервые за этот запуск приложения? → функция id → true один раз на id (обновлять данные только тогда). */
function firstOpen() {
  const seen = new Set();
  return id => !seen.has(id) && !!seen.add(id);
}

module.exports = {firstOpen, writeRootReadme, needsMigration, migrate, resume, oldRootData, adoptOld, KNOWN, slug, cleanName, dir, list, create, rename, pick, photoCount, remove, readMeta, writeMeta, PROFILES};
