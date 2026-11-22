/* «Что нового» — только в приложении (window.health). После обновления — окно поверх страницы с новыми версиями
   («Понятно» / Esc — больше не показывать в этот запуск; «Вся история» — страница whatsnew.html). Вёрстка заметок —
   WhatsNew.html(releases), её же берёт страница истории; там же «← откуда пришли» — WhatsNew.back. Подключается на всех страницах после nav.js. */
var WhatsNew = (function () {
  const MONTHS = ["января", "февраля", "марта", "апреля", "мая", "июня", "июля", "августа", "сентября", "октября", "ноября", "декабря"];
  const esc = s => String(s).replace(/[&<>"]/g, c => ({"&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;"})[c]);
  const inline = s => esc(s).replace(/\*\*(.+?)\*\*/g, "<b>$1</b>");

  /** «2026-11-22» → «22 ноября 2026». */
  function date(d) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(d || "");
    return m ? `${+m[3]} ${MONTHS[+m[2] - 1]} ${m[1]}` : "";
  }

  /** [{version, date, sections: [{title, items}]}] → HTML (версии — в данном порядке). */
  function html(releases) {
    return (releases || []).map(r =>
      `<section class="wn-rel"><h3>${r.date ? "Версия " + esc(r.version) : esc(r.version) + " (черновик)"}` +
      (r.date ? ` <span class="muted">· ${date(r.date)}</span>` : "") + "</h3>" +
      r.sections.map(s => `<h4>${esc(s.title)}</h4><ul>${s.items.map(i => `<li>${inline(i)}</li>`).join("")}</ul>`).join("") +
      "</section>").join("");
  }

  /** Ссылка «назад» со страницы истории: last — последняя открытая страница меню (nav.js пишет её в sessionStorage).
      Известна → {href, title, history: true} (клик — history.back()); нет — на «Сводку» обычной ссылкой. */
  function back(last) {
    const t = last && typeof Nav !== "undefined" ? Nav.title(last) : null;
    return t ? {href: last, title: t, history: true} : {href: "dashboard.html", title: "Сводка", history: false};
  }

  function open(r) {
    const d = document.createElement("dialog");
    d.className = "wn-dialog";
    d.innerHTML = '<h2>Что нового в «Здоровье»</h2><div class="wn-body">' + html(r.releases) + "</div>" +
      '<div class="wn-foot"><a href="whatsnew.html" class="wn-all">Вся история</a><button class="wn-ok" autofocus>Понятно</button></div>';
    (document.querySelector(".viz-root") || document.body).appendChild(d);   // внутри .viz-root — цвета темы
    d.addEventListener("close", () => { window.health.whatsNewSeen(); d.remove(); });
    d.querySelector(".wn-ok").onclick = () => d.close();
    d.querySelector(".wn-all").onclick = () => { window.health.whatsNewSeen(); };
    d.showModal();
  }

  if (typeof window !== "undefined" && window.health && window.health.whatsNew &&
      (location.pathname.split("/").pop() !== "whatsnew.html"))
    window.health.whatsNew().then(r => { if (r && r.releases && r.releases.length) open(r); });

  return {html, date, back};
})();
