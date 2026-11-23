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

module.exports = {slug, cleanName, dir, list, create, rename, pick, photoCount, remove, readMeta, writeMeta, PROFILES};
