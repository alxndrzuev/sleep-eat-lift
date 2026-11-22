/* Меню портала — общее для всех страниц: пункты по данным (Питание — есть питание или вес; Тренировки и Восстановление —
   есть Whoop); «Настройки» — только в приложении (desktop/, там есть window.health). Подключается после dataset.js. */
var Nav = (function () {
  const has = (d, k) => ((d && d[k]) || []).length > 0;
  const ALL = [
    ["dashboard.html", "Сводка", () => true],
    ["nutrition.html", "Питание", d => has(d, "nutrition") || has(d, "weight")],
    ["training.html", "Тренировки", d => has(d, "whoop_daily")],
    ["recovery.html", "Восстановление", d => has(d, "whoop_daily")],
    ["photos.html", "Фото", () => true],
    ["settings.html", "Настройки", (d, inApp) => inApp],
  ];

  // знак SEL (sleep · eat · lift) слева в меню — три дуги, как на значке приложения (docs/logo/sel-icon.svg)
  const ARCS = [["#7F77DD", -80], ["#1D9E75", 40], ["#D85A30", 160]];
  const MARK = '<span class="brand" title="SEL — sleep · eat · lift" aria-label="SEL — sleep · eat · lift" role="img">' +
    '<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><g fill="none" stroke-width="3.2" stroke-linecap="round">' +
    ARCS.map(([c, a]) => `<circle cx="12" cy="12" r="8.5" stroke="${c}" stroke-dasharray="13.9 39.5" transform="rotate(${a} 12 12)"/>`).join("") +
    "</g></svg></span>";

  /** Пункты меню: [href, название][]. */
  function items(data, inApp) {
    return ALL.filter(([, , show]) => show(data, inApp)).map(([href, title]) => [href, title]);
  }

  /** Название страницы меню по имени файла («settings.html» → «Настройки»); не из меню — null. */
  function title(page) {
    const it = ALL.find(([h]) => h === page);
    return it ? it[1] : null;
  }

  function inApp() { return typeof window !== "undefined" && !!window.health; }

  function render() {
    const el = document.getElementById("nav");
    if (!el) return;
    const cur = location.pathname.split("/").pop() || "dashboard.html";
    const data = typeof DATA !== "undefined" ? DATA : {};
    try { if (title(cur)) sessionStorage.setItem("navLast", cur); } catch (e) {}   // для «← …» на странице «Что нового»
    el.innerHTML = MARK + items(data, inApp()).map(([h, t]) => `<a href="${h}"${h === cur ? ' class="on"' : ""}>${t}</a>`).join("");
  }

  // ---------- только в приложении: «Обновить», статус, подвалы с указанием источника ----------
  const NAMES = {fatsecret: "FatSecret", whoop: "Whoop"};
  const FS_PAGES = ["dashboard.html", "nutrition.html", "photos.html"], WH_PAGES = ["dashboard.html", "training.html", "recovery.html"];

  function when(iso) {
    const d = new Date(iso);
    return d.toLocaleDateString("ru-RU", {day: "numeric", month: "short"}).replace(".", "") + ", " +
           d.toLocaleTimeString("ru-RU", {hour: "2-digit", minute: "2-digit"});
  }

  /** Строка статуса: «обновляю…» / ошибки подключённых сервисов / «обновлено …». */
  function statusText(s) {
    if (s.updating) return {text: "обновляю…", err: false};
    const on = Object.entries(s.services || {}).filter(([, v]) => v.connected);
    const errs = on.filter(([, v]) => v.lastError).map(([, v]) => v.lastError);
    if (errs.length) return {text: errs.join(" · "), err: true};
    const last = on.map(([, v]) => v.lastUpdate).filter(Boolean).sort().pop();
    return {text: last ? "обновлено " + when(last) : "", err: false};
  }

  const UPDATE_PAGES = ["nutrition.html", "training.html", "recovery.html"];   // «Обновить данные» — на профильных страницах сервисов; ещё — в «Настройках» у FatSecret и Whoop

  function appBar() {
    const nav = document.getElementById("nav");
    const cur = location.pathname.split("/").pop() || "dashboard.html";
    if (!nav || !inApp() || !UPDATE_PAGES.includes(cur)) return;
    nav.style.alignItems = "center";
    const bar = document.createElement("span");
    bar.className = "app";
    bar.style.cssText = "margin-left:auto;display:flex;gap:10px;align-items:center;font-size:13px";   // свои стили — у страниц они разные
    bar.innerHTML = '<span id="upd" class="muted"></span><button class="iconbtn" id="updbtn" title="Загрузить свежие данные из FatSecret и Whoop">Обновить данные</button>';
    nav.appendChild(bar);
    const show = s => {
      const t = statusText(s), u = document.getElementById("upd");
      u.textContent = t.text; u.className = t.err ? "err" : "muted";
      const any = Object.values(s.services || {}).some(v => v.connected);
      const b = document.getElementById("updbtn"); b.disabled = s.updating || !any; b.hidden = !any;
    };
    window.health.status().then(show);
    window.health.onStatus(show);
    document.getElementById("updbtn").onclick = () => window.health.update();
  }

  function footer() {
    if (!inApp() || typeof DATA === "undefined") return;
    const cur = location.pathname.split("/").pop() || "dashboard.html", m = DATA.modules || [];
    const parts = [];
    if (m.includes("fatsecret") && FS_PAGES.includes(cur))
      parts.push('<a href="https://www.fatsecret.com" data-ext>Powered by fatsecret</a>',
                 '<a href="https://platform.fatsecret.com/terms" data-ext>Условия fatsecret Platform API</a> — пользуясь приложением, вы принимаете условия fatsecret Platform API');
    if (m.includes("whoop") && WH_PAGES.includes(cur)) parts.push("Данные Whoop");
    parts.push("Не медицинская консультация");
    document.querySelectorAll("footer:not(.foot)").forEach(x => x.hidden = true);   // старые подвалы страниц (вне приложения)
    const f = document.createElement("footer");
    f.className = "foot";
    f.innerHTML = parts.map(p => `<span>${p}</span>`).join("");
    (document.querySelector(".wrap") || document.body).appendChild(f);
    f.querySelectorAll("a[data-ext]").forEach(a => a.onclick = e => { e.preventDefault(); window.health.openExternal(a.href); });
  }

  if (typeof document !== "undefined") {
    render();
    if (inApp()) { appBar(); if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", footer); else footer(); }
  }
  return {items, title, render, inApp, statusText, NAMES, MARK};
})();
