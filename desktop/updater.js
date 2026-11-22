// Обновление всех подключённых сервисов: по очереди и независимо (ошибка одного не мешает другому), затем data.js.
// Одно обновление за раз. Сервис: {connected(dir) → bool, update(dir, first) → {ok, error?}}.
const store = require('./store');

const ym = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
/** Первое подключение — 12 месяцев: [месяц −11, текущий]. */
const firstRange = today => [ym(new Date(today.getFullYear(), today.getMonth() - 11, 1)), ym(today)];
/** Обычное обновление — прошлый и текущий месяц. */
const recentRange = today => [ym(new Date(today.getFullYear(), today.getMonth() - 1, 1)), ym(today)];

function create(services, today) {
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
        try { r = await svc.update(dir, first === name); }
        catch (e) { r = {ok: false, error: String(e.message || e)}; }
        out[name] = r;
        u.status[name] = r.ok ? {lastUpdate: new Date().toISOString(), lastError: null}
                              : {lastUpdate: u.status[name].lastUpdate, lastError: r.error};
      }
      store.writeDataJs(dir, today());
    } finally { u.busy = false; }
    return out;
  };
  return u;
}

module.exports = {create, firstRange, recentRange};
