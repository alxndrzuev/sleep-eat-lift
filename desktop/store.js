// Данные пользователя приложения: CSV в «Документы/SEL/data» — единственный код записи (им же пишет scripts/csv.js)
// (колонки по схеме, сортировка по ключу, LF, числа без лишних нулей) и data.js (const RAW) для страниц портала.
const fs = require('node:fs');
const path = require('node:path');
const SCHEMA = require('./schema.json');
const {pyRound} = require('./pyround');

const TEXT = new Set(SCHEMA.text);
const META_EMPTY = {};   // meta.json — только alcohol_from (с какого утра размечать алкоголь)

function dataDir(documents) { return path.join(documents, 'SEL', 'data'); }

const keyOf = name => SCHEMA.key[name] || 'date';
const sortOf = name => SCHEMA.sort[name] || keyOf(name);

/** Папки и CSV с заголовками; существующее не трогает. → имена созданных CSV. */
function init(dir) {
  for (const sub of ['', 'secrets', 'photos', 'logs']) fs.mkdirSync(path.join(dir, sub), {recursive: true});
  const created = [];
  for (const [name, cols] of Object.entries(SCHEMA.schema)) {
    const f = path.join(dir, name);
    if (!fs.existsSync(f)) { fs.writeFileSync(f, cols.join(',') + '\n'); created.push(name); }
  }
  return created;
}

// ---------- CSV ----------
function parseCsv(text) {
  const rows = []; let row = [], cell = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; }
      else cell += c;
    } else if (c === '"') q = true;
    else if (c === ',') { row.push(cell); cell = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(cell); rows.push(row); row = []; cell = '';
    } else cell += c;
  }
  if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
  return rows;
}

const quote = v => /[",\r\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v;

/** CSV → [{колонка: строка}] (пустой список, если файла нет); заголовок сверяется со схемой. */
function read(dir, name) {
  const f = path.join(dir, name);
  if (!fs.existsSync(f)) return [];
  const [head, ...rows] = parseCsv(fs.readFileSync(f, 'utf8'));
  const cols = SCHEMA.schema[name], dropped = (SCHEMA.dropped || {})[name] || [];
  // новые колонки добавляются только в конец: старый файл без них читается (пустыми), при записи они появятся;
  // убранные из схемы (schema.json → dropped) в старом файле пропускаются и исчезают при записи
  const kept = head.filter(c => !dropped.includes(c));
  if (cols && kept.join(',') !== cols.slice(0, kept.length).join(',')) throw new Error(`${name}: заголовок ${head}, ожидался ${cols}`);
  const all = cols || head;
  return rows.filter(r => r.length > 1 || r[0] !== '').map(r => Object.fromEntries(all.map(c => [c, r[head.indexOf(c)] ?? ''])));
}

function write(dir, name, rows) {
  const cols = SCHEMA.schema[name], k = sortOf(name);
  const sorted = rows.slice().sort((a, b) => ((a[k] || '') < (b[k] || '') ? -1 : (a[k] || '') > (b[k] || '') ? 1 : 0));
  const lines = [cols.join(',')].concat(sorted.map(r => cols.map(c => quote(r[c] == null ? '' : String(r[c]))).join(',')));
  const f = path.join(dir, name);
  fs.writeFileSync(f + '.tmp', lines.join('\n') + '\n');
  fs.renameSync(f + '.tmp', f);
}

/** Число для CSV, как lib.fmt_num: до 0,01, без лишних нулей (72.0 → "72", 72.50 → "72.5"). */
function fmtNum(x) {
  const r = pyRound(Number(x), 2);
  return String(r);
}

/** {ключ: {колонка: значение}} → обновить/добавить (null не затирает). → {added, updated, total}. */
function upsert(dir, name, fresh) {
  if ((SCHEMA.no_upsert || []).includes(name)) throw new Error(name + ': запись только через приложение (строки различаются не только ключом)');
  const k = keyOf(name), cols = SCHEMA.schema[name];
  const cur = new Map(read(dir, name).map(r => [r[k], r]));
  let added = 0, updated = 0;
  for (const [kv, vals] of Object.entries(fresh)) {
    let row = cur.get(kv); const isNew = !row;
    if (isNew) { row = Object.fromEntries(cols.map(c => [c, ''])); row[k] = kv; cur.set(kv, row); added++; }
    let changed = false;
    for (const [c, v] of Object.entries(vals)) {
      if (v == null || !cols.includes(c)) continue;
      const s = typeof v === 'number' ? fmtNum(v) : String(v);
      if (row[c] !== s) { row[c] = s; changed = true; }
    }
    if (changed && !isNew) updated++;
  }
  write(dir, name, [...cur.values()]);
  return {added, updated, total: cur.size};
}

/** Удалить строки по ключам. → сколько удалено. */
function remove(dir, name, keys) {
  const k = keyOf(name), drop = new Set(keys);
  const rows = read(dir, name), keep = rows.filter(r => !drop.has(r[k]));
  if (keep.length !== rows.length) write(dir, name, keep);
  return rows.length - keep.length;
}

// ---------- data.js ----------
/** Строки CSV для портала: числа — числами (кроме schema.json → text), пустое → null, по дате. */
function load(dir, name) {
  return read(dir, name).map(row => {
    const r = {};
    for (const [c, v0] of Object.entries(row)) {
      const v = (v0 || '').trim();
      if (TEXT.has(c)) { r[c] = v || null; continue; }
      if (!v) { r[c] = null; continue; }
      const x = Number(v.replace(',', '.'));
      if (Number.isNaN(x)) throw new Error(`${name}: «${c}» = «${v}» — не число`);
      r[c] = x;
    }
    return r;
  }).sort((a, b) => { const x = a.date || a.start || '', y = b.date || b.start || ''; return x < y ? -1 : x > y ? 1 : 0; });
}

function readJson(f) {
  try { return fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : {}; } catch (e) { return {}; }
}

/** Подключённые модули — как lib.modules (fatsecret, photos, whoop; telegram в приложении нет). */
function modules(dir) {
  const out = [];
  if (readJson(path.join(dir, 'secrets', 'fatsecret.json')).access_token) out.push('fatsecret');
  out.push('photos');
  if (readJson(path.join(dir, 'secrets', 'whoop.json')).refresh_token) out.push('whoop');
  return out;
}

function raw(dir, today, mods) {
  const meta = fs.existsSync(path.join(dir, 'meta.json')) ? readJson(path.join(dir, 'meta.json')) : JSON.parse(JSON.stringify(META_EMPTY));
  const tables = {};
  for (const name of Object.keys(SCHEMA.schema)) tables[name] = load(dir, name);
  return {tables, meta, modules: mods || modules(dir), updated: today};
}

function writeDataJs(dir, today, mods) {
  const js = '// Собрано приложением SEL из CSV — не править руками; расчёт — portal/dataset.js\nconst RAW = ' +
    JSON.stringify(raw(dir, today, mods)) + ';\n';
  fs.writeFileSync(path.join(dir, 'data.js.tmp'), js);
  fs.renameSync(path.join(dir, 'data.js.tmp'), path.join(dir, 'data.js'));
  writeReadme(dir);
}

/** README.md в папке данных — описание файлов для того, кто читает папку (человек или LLM); шаблон — data_readme.md. */
function writeReadme(dir) {
  const want = fs.readFileSync(path.join(__dirname, 'data_readme.md'), 'utf8'), f = path.join(dir, 'README.md');
  if (fs.existsSync(f) && fs.readFileSync(f, 'utf8') === want) return;
  fs.writeFileSync(f + '.tmp', want);
  fs.renameSync(f + '.tmp', f);
}

module.exports = {dataDir, init, read, write, upsert, remove, load, raw, writeDataJs, modules, fmtNum, readJson, SCHEMA};
