// Страница «Фото»: окно «Как снимать» перед загрузкой — схематичные фигурки поз, схемы кадра, правила съёмки
// (docs/superpowers/specs/2026-11-27-photo-upload-guide-design.md; правила — docs/06). Без DOM: строки разметки,
// окно открывает photos.html. Фигурки — SVG в цвете текста (currentColor): светлая и тёмная тема, без интернета.
(function (root) {
  "use strict";
  const C = root.PhotosCore;
  const NOTES = {front: "лицом, руки вдоль тела", side: "правым боком, руки любые", back: "спиной, руки вдоль тела",
                 back_flex: "спиной, руки вверх, согнуты", front_flex: "лицом, руки вверх, согнуты", side_left: "левым боком — по желанию"};

  // фигурка в поле 100×200: голова, корпус, руки, ноги; лицом — глаза, спиной — позвоночник, боком — в профиль
  const HEAD = '<circle cx="50" cy="20" r="10" fill="currentColor" fill-opacity=".1"/>';
  const TORSO = '<path d="M34 38 Q50 34 66 38 L62 100 L38 100 Z" fill="currentColor" fill-opacity=".1"/>';
  const LEGS = '<path d="M42 100 L41 140 L40 182 L34 184 M58 100 L59 140 L60 182 L66 184"/>';
  const ARMS_DOWN = '<path d="M34 40 L27 70 L26 98 M66 40 L73 70 L74 98"/>';
  const ARMS_UP = '<path d="M34 40 L18 42 L16 20 M66 40 L82 42 L84 20"/><circle cx="16" cy="16" r="3.5" fill="currentColor" fill-opacity=".1"/>' +
                  '<circle cx="84" cy="16" r="3.5" fill="currentColor" fill-opacity=".1"/>';
  const EYES = '<circle cx="46" cy="19" r="1.4" fill="currentColor" stroke="none"/><circle cx="54" cy="19" r="1.4" fill="currentColor" stroke="none"/>';
  const SPINE = '<path d="M50 42 L50 96" stroke-dasharray="3 3"/>';
  // боком — смотрит вправо: нос и носки вправо; пунктир — руки вперёд (тоже «Сбоку»)
  const SIDE = '<circle cx="49" cy="20" r="10" fill="currentColor" fill-opacity=".1"/><path d="M58.5 17 L62 21 L58 23"/>' +
               '<path d="M40 38 Q51 34 60 40 L59 70 Q61 86 58 100 L42 100 Q39 84 40 70 Z" fill="currentColor" fill-opacity=".1"/>' +
               '<path d="M50 41 L51 70 L53 98"/><path d="M50 41 L72 43 L92 44" stroke-dasharray="3 3" opacity=".55"/>' +
               '<path d="M46 100 L46 182 L58 184 M54 100 L54 182 L64 184"/>';

  function parts(pose) {
    switch (pose) {
      case "front": return HEAD + EYES + TORSO + ARMS_DOWN + LEGS;
      case "back": return HEAD + TORSO + SPINE + ARMS_DOWN + LEGS;
      case "front_flex": return HEAD + EYES + TORSO + ARMS_UP + LEGS;
      case "back_flex": return HEAD + TORSO + SPINE + ARMS_UP + LEGS;
      case "side": return SIDE;
      case "side_left": return `<g transform="translate(100,0) scale(-1,1)">${SIDE}</g>`;
      default: throw new Error("Нет такой позы: " + pose);
    }
  }

  const STYLE = 'fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"';
  const svg = (inner, label, w = 100) => `<svg viewBox="0 0 ${w} 200" role="img" aria-label="${label}" ${STYLE}>` +
    inner + "</svg>";

  /** Схематичная фигурка позы (SVG-строка). */
  function figure(pose) {
    return svg(parts(pose), C.POSE_NAMES[pose] || pose);
  }

  /** Схема кадра: full — человек целиком в кадре; cut — голова и стопы за краем (бледно), плечи и колени в кадре. */
  function frame(kind) {
    if (kind === "full")
      return svg('<rect x="8" y="2" width="84" height="196" rx="8" stroke-width="1.5"/>' +
        `<g transform="translate(9,12) scale(.82)">${parts("front")}</g>`, "В полный рост");
    return svg('<defs><clipPath id="gCut"><rect x="8" y="26" width="84" height="132"/></clipPath></defs>' +
      `<g opacity=".22">${parts("front")}</g><g clip-path="url(#gCut)">${parts("front")}</g>` +
      '<rect x="8" y="26" width="84" height="132" rx="8" stroke-width="1.5"/>' +
      '<path d="M10 38 H94 M10 140 H94" stroke-width="1" stroke-dasharray="2 3" opacity=".55"/>' +
      '<text x="96" y="42" font-size="13" fill="currentColor" stroke="none">плечи</text>' +
      '<text x="96" y="144" font-size="13" fill="currentColor" stroke="none">колени</text>', "Без головы или стоп", 145);
  }

  /** Содержимое окна «Как снимать»: позы, кадр, правила, кнопки «Отмена» (gCancel) и «Выбрать файлы» (gChoose). */
  function html() {
    const card = (pose, cls = "") => `<div class="g-pose${cls}">${figure(pose)}<b>${C.POSE_NAMES[pose]}</b>` +
      `<span class="muted">${NOTES[pose]}</span></div>`;
    return '<h2>Как снимать</h2>' +
      '<p class="muted">Позы определяются сами — по фигуре на снимке. Снимайте эти:</p>' +
      `<div class="g-poses">${C.PROTOCOL.map(p => card(p)).join("")}${card("side_left", " g-opt")}</div>` +
      '<div class="g-row">' +
      `<div class="g-frame">${frame("full")}<div><b>Лучше — в полный рост</b><span class="muted">со стопами и запасом пола</span></div></div>` +
      `<div class="g-frame">${frame("cut")}<div><b>Голова или стопы не влезли — тоже примется</b>` +
      '<span class="muted">главное, чтобы плечи и колени были в кадре; выравнивание чуть грубее</span></div></div>' +
      '<ul class="g-rules">' +
      '<li><b>Утром, до еды</b>, после туалета</li>' +
      '<li>Тот же коридор и тот же свет, без солнца из окна</li>' +
      '<li>Телефон на одной точке, на уровне пупка; таймер 3–10 с</li>' +
      '<li>Стоять на одной метке на полу, лицом к телефону прямо</li>' +
      '<li>Расслабленно, живот не втягивать</li>' +
      '<li>Вся серия — за один раз; неудачный снимок удалить и переснять</li>' +
      '</ul></div>' +
      '<div class="mfoot"><span class="muted">Снимки можно и перетащить на страницу</span>' +
      '<button class="btn" id="gCancel">Отмена</button><button class="btn main" id="gChoose">Выбрать файлы</button></div>';
  }

  root.PhotosGuide = {figure, frame, html};
})(globalThis);
