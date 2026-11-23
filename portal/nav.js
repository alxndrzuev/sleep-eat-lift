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

  // Логотип SEL (sleep · eat · lift). Основной — три плитки (сон, еда, железо) и SEL по центру над «sleep · eat · lift»:
  // меню, «О приложении», пустая страница, README (docs/logo/sel-logo-*.svg собираются из logoSvg — тест). Круг из трёх
  // дуг (как на значке приложения, docs/logo/sel-icon.svg) — только где нужен квадрат: знак перед заголовком «Что нового».
  const TAG = "SEL — sleep · eat · lift";
  const TILES = [
    ["#7F77DD", "#EEEDFE", '<path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9z"/>'],
    ["#1D9E75", "#E1F5EE", '<path d="M6 3v5a2.5 2.5 0 0 0 5 0V3"/><path d="M8.5 3v18"/><path d="M18 21V3c-2.4 1.2-3.5 4-3.5 8.5h3.5"/>'],
    ["#D85A30", "#FAECE7", '<path d="M7 12h10"/><rect x="4" y="7" width="3" height="10" rx="1"/><rect x="17" y="7" width="3" height="10" rx="1"/><path d="M2 10v4"/><path d="M22 10v4"/>'],
  ];
  const r2 = v => +v.toFixed(2);
  /** Три плитки в ряд: левый верх (x, y), сторона size, зазор gap; sw — толщина линий значка (в его 24-единицах). */
  const tiles = (x, y, size, gap, sw = 2) => TILES.map(([bg, fg, icon], i) => {
    const tx = x + i * (size + gap);
    return `<rect x="${r2(tx)}" y="${r2(y)}" width="${r2(size)}" height="${r2(size)}" rx="${r2(size * 0.26)}" fill="${bg}"/>` +
      `<g transform="translate(${r2(tx + size * 0.225)} ${r2(y + size * 0.225)}) scale(${r2(size * 0.55 / 24)})" fill="none" stroke="${fg}" ` +
      `stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round">${icon}</g>`;
  }).join("");
  const FONT = "-apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif";
  const TEXT_W = 206;   // ширина «sleep · eat · lift»; SEL растянут на ту же ширину и стоит по центру над ней
  /** Логотип целиком (svg 588×140): плитки, SEL, «sleep · eat · lift»; sel, tag — цвета надписей (#… или var(--…)). */
  function logoSvg(sel, tag, attrs = 'width="588" height="140"') {
    const cx = 372 + TEXT_W / 2;
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 588 140" ${attrs} role="img"><title>${TAG}</title>` + tiles(10, 22, 96, 16) +
      `<text x="${cx}" y="85" text-anchor="middle" textLength="${TEXT_W}" lengthAdjust="spacing" style="fill:${sel};font:600 80px ${FONT}">SEL</text>` +
      `<text x="${cx}" y="117" text-anchor="middle" textLength="${TEXT_W}" lengthAdjust="spacing" style="fill:${tag};font:400 22px ${FONT}">sleep · eat · lift</text></svg>`;
  }
  /** Знак-круг из трёх дуг размером px — для квадратного места. */
  const ARCS = [["#7F77DD", -80], ["#1D9E75", 40], ["#D85A30", 160]];
  const mark = px => `<svg class="selmark" viewBox="0 0 24 24" width="${px}" height="${px}" aria-hidden="true"><g fill="none" stroke-width="3.2" stroke-linecap="round">` +
    ARCS.map(([c, a]) => `<circle cx="12" cy="12" r="8.5" stroke="${c}" stroke-dasharray="13.9 39.5" transform="rotate(${a} 12 12)"/>`).join("") +
    "</g></svg>";
  /** Слева в меню: три маленькие плитки и слово SEL. */
  const MARK = `<span class="brand" title="${TAG}" aria-label="${TAG}" role="img">` +
    `<svg viewBox="0 0 64 20" width="64" height="20" aria-hidden="true">${tiles(0, 0, 20, 2, 2.4)}</svg><b class="wm">SEL</b></span>`;
  /** Крупный логотип в странице: высота px, цвета темы. */
  const logo = px => `<div class="sellogo">${logoSvg("var(--text-primary)", "var(--text-secondary)", `height="${px}" width="${r2(px * 588 / 140)}"`)}</div>`;

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
    const bad = dataErrors(data.errors);
    if (bad && !document.getElementById("dataerr")) {          // испорченный CSV: страница открылась, но эти данные пустые
      const div = document.createElement("div");
      div.id = "dataerr"; div.className = "err"; div.style.cssText = "margin:8px 0;font-size:13px;color:var(--critical)";
      div.textContent = bad;                                    // текст из файла — только как текст
      el.insertAdjacentElement("afterend", div);
    }
  }

  /** Строка про файлы данных, которые не читаются (DATA.errors), или "". */
  function dataErrors(errors) {
    return errors && errors.length ? "Не читается файл в папке данных — эти данные не показаны, пока его не поправить: " + errors.join(" · ") : "";
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

  /** Сводка: когда данные подключённых сервисов на самом деле загружены (data/sync.json → DATA.sync), а не когда собран data.js.
      Один день у всех — одно (последнее) время; иначе — по сервисам. */
  function syncText(sync, modules) {
    const on = ["fatsecret", "whoop"].filter(n => (modules || []).includes(n));
    if (!on.length) return "";
    const at = on.map(n => (sync || {})[n] || null);
    const day = iso => iso && new Date(iso).toDateString();
    if (at.every(Boolean) && at.every(x => day(x) === day(at[0]))) return "Обновлено " + when(at.slice().sort().pop());
    return "Обновлено: " + on.map((n, i) => NAMES[n] + " — " + (at[i] ? when(at[i]) : "ещё не загружен")).join(" · ");
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

  // ---------- профили (только в приложении): имя текущего ▾ справа в меню ----------
  const escH = v => String(v ?? "").replace(/[&<>"']/g, c => ({"&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"})[c]);
  const PROF_CSS = ".prof{position:relative;font-size:13px}.prof summary{list-style:none;cursor:pointer;padding:3px 10px;border-radius:6px;" +
    "border:1px solid var(--border);color:var(--text-primary);background:var(--surface-1);white-space:nowrap}.prof summary::-webkit-details-marker{display:none}" +
    ".prof-list{position:absolute;right:0;top:calc(100% + 4px);z-index:40;min-width:220px;background:var(--surface-1);border:1px solid var(--border);" +
    "border-radius:10px;padding:6px;box-shadow:0 6px 24px rgba(0,0,0,.15);display:flex;flex-direction:column}" +
    ".prof-list button,.prof-list a{all:unset;cursor:pointer;padding:6px 10px;border-radius:6px;color:var(--text-primary)}" +
    ".prof-list button:hover:not(:disabled),.prof-list a:hover{background:var(--page)}.prof-list button:disabled{opacity:.45;cursor:default}" +
    ".prof-list [aria-current]{font-weight:600}.prof-list hr{border:0;border-top:1px solid var(--border);margin:4px 0}" +
    ".prof-lock{padding:4px 10px 6px;color:var(--text-secondary);font-size:12px;max-width:240px}" +
    "dialog.ask{border:1px solid var(--border);border-radius:12px;background:var(--surface-1);color:var(--text-primary);padding:18px;min-width:320px}" +
    "dialog.ask::backdrop{background:rgba(0,0,0,.4)}dialog.ask label{display:flex;flex-direction:column;gap:8px;font:inherit}" +
    "dialog.ask input{font:inherit;padding:6px 8px;border:1px solid var(--border);border-radius:8px;background:var(--page);color:var(--text-primary)}" +
    ".ask-b{display:flex;gap:8px;justify-content:flex-end;margin-top:14px}.ask-b button{font:inherit;padding:5px 14px;border-radius:8px;" +
    "border:1px solid var(--border);background:var(--surface-1);color:var(--text-primary);cursor:pointer}" +
    ".ask-b button[value=ok]{background:var(--series-1);border-color:var(--series-1);color:#fff;font-weight:600}";
  function profStyle() {
    if (document.getElementById("profstyle")) return;
    const st = document.createElement("style"); st.id = "profstyle"; st.textContent = PROF_CSS; document.head.appendChild(st);
  }

  /** Вопрос с полем ввода — вместо window.prompt (в Electron его нет). → Promise: введённая строка или null (Отмена, Esc). */
  function ask(title, value = "") {
    return new Promise(done => {
      profStyle();
      const d = document.createElement("dialog");
      d.className = "ask";
      d.innerHTML = `<form><label>${escH(title)}<input maxlength="80" autocomplete="off"></label>` +
        `<div class="ask-b"><button type="button" data-no>Отмена</button><button value="ok">OK</button></div></form>`;
      const inp = d.querySelector("input");
      inp.value = value;
      let res = null;
      d.querySelector("form").onsubmit = e => { e.preventDefault(); res = inp.value; d.close(); };
      d.querySelector("[data-no]").onclick = () => d.close();
      d.addEventListener("close", () => { d.remove(); done(res); });
      document.body.appendChild(d);
      d.showModal(); inp.select();
    });
  }

  /** Меню профилей: {list: [{id, name}], current, locked: причина или null} → HTML (имена — только через escH). */
  function profileMenu(info) {
    const list = info.list || [], cur = list.find(p => p.id === info.current), off = info.locked ? " disabled" : "";
    return `<details class="prof"><summary title="Профиль — чьи данные открыты">${escH(cur ? cur.name : "Профиль")} ▾</summary><div class="prof-list">` +
      (info.locked ? `<div class="prof-lock">${escH(info.locked)}</div>` : "") +
      list.map(p => `<button data-prof="${escH(p.id)}"${p.id === info.current ? ' aria-current="true"' : ""}${p.id === info.current ? "" : off}>` +
        `${p.id === info.current ? "✓ " : ""}${escH(p.name)}</button>`).join("") +
      `<hr><button data-prof-new${off}>Новый профиль…</button><a href="settings.html#profiles">Профили…</a></div></details>`;
  }

  /** Страница сейчас что-то пишет (например, «Фото» — снимки) → причина, иначе "": тогда профиль не переключаем. */
  const pageBusy = () => (typeof window.pageBusy === "function" && window.pageBusy()) || "";

  function profileBar() {
    const nav = document.getElementById("nav");
    if (!nav || !inApp() || !window.health.profiles) return;
    profStyle();
    nav.style.alignItems = "center";
    const box = document.createElement("span");
    box.style.marginLeft = nav.querySelector(".app") ? "12px" : "auto";
    nav.appendChild(box);
    const draw = info => {
      const open = box.querySelector("details[open]");
      box.innerHTML = profileMenu(info);
      if (open) box.querySelector("details").open = true;
    };
    const refresh = () => window.health.profiles().then(draw);
    refresh();
    box.addEventListener("toggle", e => { if (e.target.open) refresh(); }, true);
    box.addEventListener("click", async e => {
      const b = e.target.closest("button");
      if (!b || b.disabled) return;
      const busy = pageBusy();
      if (busy) { alert("Сейчас нельзя сменить профиль: " + busy); return; }
      let r;
      if (b.hasAttribute("data-prof-new")) {
        box.querySelector("details").open = false;
        const name = await ask("Имя нового профиля (например, имя клиента)");
        if (name === null) return;
        r = await window.health.createProfile(name);
      } else if (b.getAttribute("aria-current")) { box.querySelector("details").open = false; return; }
      else r = await window.health.switchProfile(b.dataset.prof);
      if (r && !r.ok) { alert(r.error); refresh(); }
    });
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
    if (inApp()) { appBar(); profileBar(); if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", footer); else footer(); }
  }
  return {items, title, render, inApp, statusText, syncText, dataErrors, profileMenu, ask, NAMES, MARK, mark, logo, logoSvg};
})();
