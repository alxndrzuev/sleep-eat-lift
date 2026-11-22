// Заметки к версиям — CHANGELOG.md (Keep a Changelog по-русски): разбор, сравнение версий X.Y.Z,
// какие версии показать в окне «Что нового» после обновления, выпуск версии (перенос «Не выпущено» под номер с датой).
const UNRELEASED = 'Не выпущено';
const HEAD = /^## \[([^\]]+)\](?:\s+[—–-]\s+(\d{4}-\d{2}-\d{2}))?\s*$/;
const FIRST = '0.1.0';            // версия до «Что нового»: у кого есть папка данных, но нет lastSeenVersion, — видел её

const valid = v => typeof v === 'string' && /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(v);

/** Сравнение версий X.Y.Z → -1 | 0 | 1. */
function cmp(a, b) {
  const x = a.split('.').map(Number), y = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] < y[i] ? -1 : 1;
  return 0;
}

/** Текст CHANGELOG.md → {unreleased: [{title, items}], releases: [{version, date, sections}]} (порядок — как в файле). */
function parse(md) {
  const out = {unreleased: [], releases: []};
  let sections = null, sec = null, item = false;
  for (const line of String(md).split(/\r?\n/)) {
    const h = line.match(HEAD);
    if (h) {
      sections = []; sec = null; item = false;
      if (h[1] === UNRELEASED) out.unreleased = sections;
      else out.releases.push({version: h[1], date: h[2] || null, sections});
      continue;
    }
    if (!sections) continue;                                       // шапка файла
    const s = line.match(/^### (.+?)\s*$/);
    if (s) { sec = {title: s[1], items: []}; sections.push(sec); item = false; continue; }
    if (!sec) continue;
    const it = line.match(/^[-*] (.+)$/);
    if (it) { sec.items.push(it[1].trim()); item = true; continue; }
    if (item && /^\s+\S/.test(line)) sec.items[sec.items.length - 1] += ' ' + line.trim();
    else if (line.trim()) item = false;
  }
  const clean = list => list.filter(x => x.items.length);
  out.unreleased = clean(out.unreleased);
  for (const r of out.releases) r.sections = clean(r.sections);
  return out;
}

const newestFirst = list => list.slice().sort((a, b) => cmp(b.version, a.version));
const released = releases => releases.filter(r => valid(r.version));

/** Вся история: выпущенные версии не новее текущей, новые сверху. */
const history = (releases, current) => newestFirst(released(releases).filter(r => cmp(r.version, current) <= 0));

/** Что показать в окне после обновления: новичку — ничего; иначе версии новее lastSeen и не новее текущей. */
function toShow({releases, current, lastSeen, isNew}) {
  if (isNew) return [];
  const last = valid(lastSeen) ? lastSeen : FIRST;
  return history(releases, current).filter(r => cmp(r.version, last) > 0);
}

/** Что запомнить показанным: большая из lastSeen и текущей (после отката не понижаем). */
const seenAfter = (lastSeen, current) => (valid(lastSeen) && cmp(lastSeen, current) > 0 ? lastSeen : current);

/** Запись выпущенной версии (с датой и хотя бы одним пунктом) или null — по ней сборка решает, есть ли заметки. */
function entry(md, version) {
  const r = parse(md).releases.find(x => x.version === version);
  return r && r.date && r.sections.length ? r : null;
}

/** Выпуск: заметки из «Не выпущено» → `## [version] — date`, сверху остаётся пустое «Не выпущено». → новый текст. */
function release(md, version, date) {
  if (!valid(version)) throw new Error('Номер версии — X.Y.Z, например 1.0.0');
  const parsed = parse(md);
  if (parsed.releases.some(r => r.version === version)) throw new Error(`Версия ${version} уже есть в CHANGELOG`);
  if (!parsed.unreleased.length) throw new Error('Раздел «Не выпущено» пуст — нечего выпускать');
  const lines = String(md).replace(/\r\n/g, '\n').split('\n');
  const start = lines.findIndex(l => (l.match(HEAD) || [])[1] === UNRELEASED);
  let end = lines.findIndex((l, i) => i > start && HEAD.test(l));
  if (end < 0) end = lines.length;
  const body = lines.slice(start + 1, end).join('\n').trim();
  const rest = lines.slice(end).join('\n');
  return [...lines.slice(0, start), `## [${UNRELEASED}]`, '', `## [${version}] — ${date}`, '', body, '', rest].join('\n')
    .replace(/\n{3,}/g, '\n\n').replace(/\n*$/, '\n');
}

module.exports = {parse, cmp, valid, history, toShow, seenAfter, release, entry, UNRELEASED, FIRST};
