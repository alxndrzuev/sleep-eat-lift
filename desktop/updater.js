// Обновление всех подключённых сервисов: по очереди и независимо (ошибка одного не мешает другому), страницы перечитают CSV после перезагрузки.
// Одно обновление за раз. Сервис: {connected(dir) → bool, update(dir, first) → {ok, error?}}.
// Успех — время в data/sync.json: с него следующее обновление и грузит (пропуски догружаются), его показывает сводка.
// log (log.js) — в журнал: что обновлялось, сколько пришло, сколько заняло, ошибка.
const store = require('./store');

const ym = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
/** Первое подключение — 12 месяцев: [месяц −11, текущий]. */
const firstRange = today => [ym(new Date(today.getFullYear(), today.getMonth() - 11, 1)), ym(today)];
/** Обычное обновление — прошлый и текущий месяц. */
const recentRange = today => [ym(new Date(today.getFullYear(), today.getMonth() - 1, 1)), ym(today)];

const OVERLAP = 3;                       // дней внахлёст: поздние правки в сервисе и часовые пояса
const DAY = 864e5;
/** Файлы сервиса и колонка, по которой видно, что данные за день пришли. */
const FILES = {whoop: [['whoop_daily.csv', null]], fatsecret: [['nutrition_daily.csv', null], ['body.csv', 'weight_kg']]};

/** С какого дня данные сервиса уже есть: последнее успешное обновление (sync.json), а если его нет — последняя дата
 *  в файлах сервиса (до sync.json; первая загрузка оборвалась). Ничего — null (грузить за год). */
function since(dir, name) {
  const s = store.readSync(dir)[name];
  if (s) return s.slice(0, 10);
  const dates = (FILES[name] || []).flatMap(([f, col]) => store.read(dir, f).filter(r => !col || r[col] !== '').map(r => r.date));
  return dates.length ? dates.sort().pop() : null;
}

/** Whoop: сколько дней грузить — от `since` с запасом, не меньше 14, не больше 365. */
function whoopDays(from, now) {
  if (!from) return 365;
  const gap = Math.ceil((now - Date.parse(from + 'T00:00:00Z')) / DAY);
  return Math.min(365, Math.max(14, gap + OVERLAP));
}

/** FatSecret: месяцы [с месяца `since` минус запас, текущий] — не меньше двух, не больше двенадцати. */
function fatsecretRange(from, now) {
  const [first, cur] = firstRange(now), [recent] = recentRange(now);
  if (!from) return [first, cur];
  const d = new Date(Date.parse(from + 'T00:00:00Z') - OVERLAP * DAY).toISOString().slice(0, 7);
  return [d < first ? first : d < recent ? d : recent, cur];
}

const quiet = {info() {}, warn() {}};

function create(services, now = () => new Date(), log = quiet) {
  const u = {busy: false, status: {}};
  for (const name of Object.keys(services)) u.status[name] = {lastUpdate: null, lastError: null};

  /** Обновить подключённые сервисы (first — только сервис `first`: загрузка за год после подключения). */
  u.runAll = async (dir, first = null) => {
    if (u.busy) return {busy: true};
    u.busy = true;
    const out = {};
    try {
      for (const [name, svc] of Object.entries(services)) {
        if (!svc.connected(dir)) continue;
        let r;
        const t0 = Date.now();
        try { r = await svc.update(dir, first === name); }
        catch (e) { r = {ok: false, error: String(e.message || e)}; }
        out[name] = r;
        const {ok, error, ...got} = r, ms = Date.now() - t0, firstLoad = first === name || undefined;
        if (ok) log.info(`обновление ${name}: готово`, Object.assign({first: firstLoad}, got, {ms}));
        else log.warn(`обновление ${name}: ошибка`, Object.assign({first: firstLoad, error}, got, {ms}));
        const at = now().toISOString();
        if (r.ok) store.saveSync(dir, name, at);
        u.status[name] = r.ok ? {lastUpdate: at, lastError: null}
                              : {lastUpdate: u.status[name].lastUpdate, lastError: r.error};
      }
    } finally { u.busy = false; }
    return out;
  };
  return u;
}

module.exports = {create, firstRange, recentRange, since, whoopDays, fatsecretRange};
