// Страница «Фото»: чистая логика без DOM — разбор имён, позы серии, медианы, расчёт выравнивания, данные для показа.
// Подключается обычным <script> (страница открывается с file://); тесты — desktop/test/portal_photos.test.js.
// Выравнивание (alignAll): рост человека не меняется — к нему и приводится масштаб, только по высоте (ширины плеч и талии
// и есть то, что сравниваем, по ним не равняем). 1) Наклон: ось «щиколотки → плечи» — вертикально (не больше 5°).
// 2) Масштаб и высота — подгонка по многим точкам (макушка, глаза, уши, плечи, таз, колени, щиколотки, пятки, подошвы)
// к общему шаблону позы: шаблон — медианы по всем снимкам позы, рост в шаблоне (макушка–подошвы) = FRAME.HS, подошвы
// на FRAME.H − SOLE_Y; шумные точки весят меньше, выбросы (волосы, таз) отбрасываются. 3) Центр корпуса по силуэту —
// в центр кадра. Снимков позы меньше трёх — масштаб по силуэту «макушка–подошвы»; нет макушки или подошв — по
// «нос–щиколотки» или корпусу через типичное соотношение с силуэтом. Координаты — пиксели, y вниз.
(function (root) {
  "use strict";
  const POSES = ["front", "side", "side_left", "back", "back_flex", "front_flex"];
  const POSE_NAMES = {front: "Спереди", side: "Сбоку справа", side_left: "Сбоку слева", back: "Сзади", back_flex: "Спина, бицепс",
                      front_flex: "Бицепс"};
  const PROTOCOL = ["front", "side", "back", "back_flex", "front_flex"];   // 5 снимков по порядку съёмки (docs/06); side — правым боком
  const FRAME = {W: 3330, H: 5470, HS: 4300, SOLE_Y: 420, BG: "rgb(232,230,224)"};   // HS — макушка–подошвы, SOLE_Y — подошвы от низа
  // силуэт/«нос–щиколотки», силуэт/корпус, (подошвы−щиколотки)/силуэт, (подошвы−таз)/силуэт, силуэт/«плечи–колени»,
  // (подошвы−колени)/силуэт; rK и offK — медианы по 53 полным снимкам (11.2026)
  const DEFAULT_MED = {rN: 1.12, rT: 3.4, offA: 0.04, offR: 0.5, rK: 1.93, offK: 0.27};
  const MAX_TILT = 5 * Math.PI / 180;                                 // больший наклон — скорее ошибка точек
  const FIT = ["crown", "eyes", "ears", "neck", "root", "knees", "ankle", "heels", "sole"];   // точки подгонки (по высоте)
  const MIN_FIT = 3;                                                  // столько снимков позы нужно для подгонки по точкам
  const VAR_FLOOR = 900;                                              // для весов σ точки не меньше 30 px — иначе 2–3 точки «перетягивают» подгонку
  const TRIM_FLOOR = 25;                                              // для отбраковки выбросов (волосы, таз) σ не меньше 5 px; выброс — дальше 4σ
  const FOLDER = "photos";          // папка data/photos внутри папки проекта (личные данные — в data/)
  const VIS = 0.5;                      // порог видимости точки MediaPipe
  const EDGE = 0;                       // точка за краем кадра (доля снимка) — выдумана MediaPipe (ошибка 100–200 px), не в счёт
  const HW = 0.2, ZS = 0.15;            // боком: |hw| таза меньше HW; сторона по глубине, если |zs| ≥ ZS
  const NAME = /^(\d{4}-\d{2}-\d{2})_([a-z_]+)\.[A-Za-z0-9]+$/;
  const DATE = /^\d{4}-\d{2}-\d{2}$/;

  const pad = n => String(n).padStart(2, "0");
  const ymd = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const r1 = v => Math.round(v * 10) / 10;
  const median = a => a.length ? a.slice().sort((x, y) => x - y)[Math.floor(a.length / 2)] : null;
  const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
  const days = (a, b) => Math.round((Date.parse(a + "T12:00:00Z") - Date.parse(b + "T12:00:00Z")) / 864e5);

  /** «2026-07-12_back_flex.jpg» → {date, pose}; не наша поза или другое имя → null. */
  function parseName(filename) {
    const m = NAME.exec(filename || "");
    return m && POSES.includes(m[2]) ? {date: m[1], pose: m[2]} : null;
  }

  /** Дата съёмки: из EXIF (Date в местном времени), иначе — дата файла (fromExif: false, надо проверить глазами). */
  function exifDate(exif, lastModified) {
    const d = exif instanceof Date && !isNaN(exif) ? exif : new Date(lastModified);
    return {date: ymd(d), time: d.getTime(), fromExif: d === exif};
  }

  /**
   * Снимки → серии по датам. Поза: из имени файла; иначе по точкам тела (it.guess — guessPose); если ни у одного снимка дня
   * нет ни того ни другого и снимков ровно 5 — по порядку съёмки; иначе null. Одна поза несколько раз — дубли (dup = поза):
   * оставлен последний по времени (пересняли — значит, последний лучше), остальные — «skip» (не сохранять).
   */
  function planSeries(items, existing) {
    const have = new Set(existing || []), byDate = {};
    for (const it of items) (byDate[it.date] = byDate[it.date] || []).push(it);
    return Object.keys(byDate).sort().map(date => {
      const list = byDate[date].slice().sort((a, b) => a.time - b.time);
      const named = list.map(it => parseName(it.name));
      const fresh = list.filter(it => !it.already);
      const auto = fresh.length === PROTOCOL.length && fresh.every(it => !parseName(it.name) && !it.guess);
      const rows = list.map((it, i) => it.already ? {id: it.id, pose: "skip", already: it.already} :
        {id: it.id, pose: named[i] ? named[i].pose : it.guess || (auto ? PROTOCOL[fresh.indexOf(it)] : null)});
      const groups = {};
      for (const r of rows) if (r.pose && !r.already) (groups[r.pose] = groups[r.pose] || []).push(r);
      for (const [pose, g] of Object.entries(groups)) if (g.length > 1) g.forEach((r, i) => { r.dup = pose; if (i < g.length - 1) r.pose = "skip"; });
      for (const r of rows) r.exists = !!r.pose && r.pose !== "skip" && !r.already && have.has(`${date}_${r.pose}`);
      return {date, rows};
    });
  }

  /** Номера строк серии в той же группе дублей, что и строка ri (не дубль — только она сама). */
  function dupGroup(rows, ri) {
    const d = rows[ri] && rows[ri].dup;
    return d ? rows.map((r, i) => r.dup === d ? i : -1).filter(i => i >= 0) : [ri];
  }

  /** «Оставить этот»: строка ri получает позу своей группы дублей, остальные дубли — «не сохранять». Меняет rows. */
  function keepDup(rows, ri) {
    const d = rows[ri].dup;
    for (const i of dupGroup(rows, ri)) { rows[i].pose = i === ri ? d : "skip"; rows[i].replace = false; }
    return rows;
  }

  /**
   * Повторная загрузка: {id снимка: имя уже сохранённого}. Тот же файл — по SHA-256 (it.sha), тот же кадр в другом
   * формате — по времени съёмки из EXIF до секунды (it.time при it.fromExif). photos — индекс (поля sha, shot у снимков).
   */
  function findAlready(items, photos) {
    const bySha = {}, byShot = {}, res = {};
    for (const [name, p] of Object.entries(photos || {})) {
      if (p.sha) bySha[p.sha] = name;
      if (p.shot) byShot[Math.floor(p.shot / 1000)] = name;
    }
    for (const it of items) {
      const hit = (it.sha && bySha[it.sha]) || (it.fromExif && it.time && byShot[Math.floor(it.time / 1000)]);
      if (hit) res[it.id] = hit;
    }
    return res;
  }

  /** Ошибки, мешающие сохранить: нет даты, не выбрана поза, одна поза дважды в дне. pose "skip" — «не сохранять». */
  function validatePlan(series) {
    const errors = [], byDate = {};
    for (const s of series) {
      if (!DATE.test(s.date || "")) errors.push("Не указана дата серии");
      const none = s.rows.filter(r => !r.pose).length;
      if (none) errors.push(`${s.date}: у ${none} снимк${none === 1 ? "а" : "ов"} не выбрана поза`);
      if (String(s.weight ?? "").trim()) try { parseKg(s.weight); } catch (e) { errors.push(`${s.date}: ${e.message}`); }
      // по дате, а не по серии: дату серии могли поменять на дату другой серии
      (byDate[s.date] = byDate[s.date] || []).push(...s.rows.map(r => r.pose).filter(p => p && p !== "skip"));
    }
    for (const [date, poses] of Object.entries(byDate))
      for (const p of new Set(poses.filter((p, i) => poses.indexOf(p) !== i)))
        errors.push(`${date}: поза «${POSE_NAMES[p] || p}» выбрана дважды`);
    return errors;
  }

  /** Путь папки проекта по адресу страницы (location.pathname …/portal/photos.html) или null. */
  function projectPath(pathname) {
    const m = /^(.*)\/portal\/[^/]*$/.exec(pathname || "");
    if (!m) return null;
    try { return decodeURIComponent(m[1]); } catch (e) { return m[1]; }
  }

  /**
   * Папка, выбранная в окне Chrome (имя и что в ней лежит) → куда писать фото: путь внутри неё (папки создаются).
   * Папка проекта (в ней portal и data) → data/photos; data → photos; photos → она сама; иначе path null и предупреждение.
   */
  function resolveFolder(name, children) {
    const has = n => (children || []).includes(n);
    if (has("portal") && has("data")) return {path: ["data", "photos"], warn: null};
    if (name === "data") return {path: [FOLDER], warn: null};
    if (name === FOLDER) return {path: [], warn: null};
    return {path: null, warn: `Выбрана папка «${name}». Выберите папку проекта sleep-eat-lift (в ней лежат portal и data) — ` +
                              `фото сохранятся в data/photos, иначе страница их не увидит.`};
  }


  /**
   * 33 точки MediaPipe (нормированные) → опорные точки в пикселях снимка; без плеч или таза — null. Точка за краем кадра
   * (дальше EDGE) не в счёт: MediaPipe дорисовывает обрезанные голову и кисти с высокой «видимостью».
   */
  function keypointsFromLandmarks(lm, w, h) {
    if (!lm || lm.length < 29) return null;
    const inside = q => q.x >= -EDGE && q.x <= 1 + EDGE && q.y >= -EDGE && q.y <= 1 + EDGE;
    const p = i => (lm[i] && (lm[i].visibility ?? 1) >= VIS && inside(lm[i])) ? [r1(lm[i].x * w), r1(lm[i].y * h)] : null;
    const mid = (a, b) => a && b ? [r1((a[0] + b[0]) / 2), r1((a[1] + b[1]) / 2)] : null;
    const neck = mid(p(11), p(12)), rootP = mid(p(23), p(24));
    if (!neck || !rootP) return null;
    const avg = (...ids) => {                                   // среднее видимых (левая/правая)
      const a = ids.map(p).filter(Boolean);
      return a.length ? [r1(a.reduce((s, q) => s + q[0], 0) / a.length), r1(a.reduce((s, q) => s + q[1], 0) / a.length)] : null;
    };
    const ankle = avg(27, 28);
    const foot = [27, 28, 29, 30, 31, 32].map(p).filter(Boolean).map(a => a[0]);   // щиколотки, пятки, носки — по x
    // признаки позы (на корпус T): sw, hw — (левое − правое) по x у плеч и таза: лицом > 0, спиной < 0, боком ≈ 0;
    // up — кисти выше плеч, el — локти выше плеч (кисти обрезаны — руки вверх видно по локтям);
    // zs — глубина левых минус правых (плечи и таз; меньше — ближе к камере): > 0 — ближе правый бок
    const T = dist(neck, rootP), r2 = v => Math.round(v * 100) / 100;
    const mean = a => a.length ? r2(a.reduce((x, y) => x + y, 0) / a.length) : null;
    const above = pairs => mean(pairs.filter(([j]) => p(j)).map(([j, sh]) => (p(sh)[1] - p(j)[1]) / T));
    const z = i => typeof lm[i].z === "number" ? lm[i].z : null;
    const zs = [[11, 12], [23, 24]].filter(([a, b]) => z(a) !== null && z(b) !== null).map(([a, b]) => z(a) - z(b));
    // куда смотрит (для «сбоку»): (нос − середина ушей) + (носки − пятки) по x / корпус; > 0 — вправо на снимке = правым боком
    const ears = avg(7, 8), heels = avg(29, 30), toes = avg(31, 32);
    const dirs = [p(0) && ears && p(0)[0] - ears[0], toes && heels && toes[0] - heels[0]].filter(v => typeof v === "number");
    return {w, h, head: p(0) || p(7) || p(8), neck, root: rootP, ankle,
            feet: ankle && foot.length ? [Math.min(...foot), Math.max(...foot)] : null,
            pts: {eyes: avg(2, 5), ears: avg(7, 8), knees: avg(25, 26), heels: avg(29, 30)},
            look: {sw: r2((p(11)[0] - p(12)[0]) / T), hw: r2((p(23)[0] - p(24)[0]) / T), zs: mean(zs),
                   up: above([[15, 11], [16, 12]]), el: above([[13, 11], [14, 12]]),
                   dir: dirs.length ? r2(dirs.reduce((a, b) => a + b, 0) / T) : null}};
  }

  /**
   * Поза по точкам тела (kp.look) или null. Пороги — по 65 снимкам и их вариантам (без стоп, без головы, только
   * плечи–колени, зеркально; проверочный набор, 11.2026): боком — узкие плечи (|sw| < 0.35) и таз (|hw| < HW); сторона —
   * по глубине (|zs| ≥ ZS: ближнее плечо и бедро), иначе по носу и носкам; руки боком не смотрятся (вперёд, вверх — всё
   * «Сбоку»). Руки вверх: кисти выше плеч (up > 0: «Бицепс» +0.35…+0.55, вдоль тела ≈ −1, у груди −0.1…−0.3 — не «Бицепс»,
   * по 305 людям COCO), кистей нет — локти (el > −0.3). Итог (11.2026): свои — 519 из 538 вариантов, COCO — 91 %.
   */
  function guessPose(kp) {
    const L = kp && kp.look;
    if (!L || L.sw == null) return null;
    if (Math.abs(L.sw) < 0.35 && (L.hw == null || Math.abs(L.hw) < HW)) {
      const d = L.zs != null && Math.abs(L.zs) >= ZS ? L.zs : L.dir;
      return d != null && d < 0 ? "side_left" : "side";
    }
    const flex = L.up != null ? L.up > 0 : L.el != null && L.el > -0.3;
    return L.sw > 0 ? (flex ? "front_flex" : "front") : (flex ? "back_flex" : "back");
  }

  /**
   * Силуэт по маске фигуры (mw×mh, значения 0…1; kp — в координатах маски):
   * crown — верх головы (только над головой: кулаки поднятых рук не в счёт), sole — низ стоп, cx — середина корпуса
   * между плечами и тазом (по отрезку маски, где корпус, — без рук сбоку). Касается края кадра — null (обрезано).
   */
  function silhouette(mask, mw, mh, kp) {
    const on = (x, y) => x >= 0 && y >= 0 && x < mw && y < mh && mask[y * mw + x] > 0.5;
    const RUN = 3;                                              // столько пикселей подряд — не случайная точка
    const torso = dist(kp.neck, kp.root), out = {crown: null, sole: null, cx: null};
    // макушка: сверху вниз в полосе над головой
    const hx = Math.round((kp.head || kp.neck)[0]), hb = Math.max(2, Math.round(0.12 * torso));
    let top = Infinity, topX = null;
    for (let x = hx - hb; x <= hx + hb; x++)
      for (let y = 0; y < kp.neck[1]; y++)
        if ([...Array(RUN).keys()].every(i => on(x, y + i))) { if (y < top) { top = y; topX = x; } break; }
    const EDGE_PX = Math.max(2, Math.round(0.005 * mh));        // маска размыта: у среза кадра фигура начинается не с 0
    if (top !== Infinity && top > EDGE_PX) out.crown = [topX, top];
    // подошвы: снизу вверх в полосе стоп
    if (kp.feet && kp.ankle) {
      const fb = Math.max(2, Math.round(0.1 * torso)), stop = Math.max(0, Math.round(kp.ankle[1] - 0.1 * torso));
      let bottom = -1, botX = null;
      for (let x = Math.round(kp.feet[0]) - fb; x <= Math.round(kp.feet[1]) + fb; x++)
        for (let y = mh - 1; y >= stop; y--)
          if ([...Array(RUN).keys()].every(i => on(x, y - i))) { if (y > bottom) { bottom = y; botX = x; } break; }
      if (bottom >= 0 && bottom < mh - 1 - EDGE_PX) out.sole = [botX, bottom];
    }
    // центр корпуса: середины отрезков маски, на которых лежит линия «шея–таз»
    const mids = [];
    for (let y = Math.round(kp.neck[1]); y <= Math.round(kp.root[1]); y++) {
      const t = (y - kp.neck[1]) / ((kp.root[1] - kp.neck[1]) || 1);
      const x0 = Math.round(kp.neck[0] + t * (kp.root[0] - kp.neck[0]));
      if (!on(x0, y)) continue;
      let a = x0, b = x0;
      while (on(a - 1, y)) a--;
      while (on(b + 1, y)) b++;
      mids.push((a + b) / 2);
    }
    if (mids.length) out.cx = median(mids);
    return out;
  }

  /**
   * Размер копии снимка для поиска фигуры: длинная сторона ≤ side, ширина кратна 4 — MediaPipe с маской падает
   * («Check failed: 1 == ChannelSize()») на ширине, не кратной 4 (строки одноканальной маски выравниваются).
   * Растяжение по ширине — меньше 4 px: точки нормированы и пересчитываются в пиксели снимка, на них не влияет.
   */
  function detectSize(w, h, side) {
    const k = Math.min(1, side / Math.max(w, h));
    return {w: Math.ceil(Math.round(w * k) / 4) * 4, h: Math.round(h * k)};
  }

  /**
   * Результат MediaPipe как есть → опорные точки в пикселях снимка w×h (+ макушка, подошвы, центр корпуса по маске) или null.
   * det = {lm: 33 точки (нормированные), mask: {w, h, data: 0…1} | null} — маска в размере уменьшенной копии снимка.
   * Один путь для приложения (PhotosApp.detect) и проверки (scripts/photos_bench.js).
   */
  function figureFromDetection(det, w, h) {
    const kp = det && det.lm ? keypointsFromLandmarks(det.lm, w, h) : null;
    const m = det && det.mask;
    if (!kp || !m) return kp;
    // точки — в размер маски, силуэт — обратно в пиксели снимка
    const sx = m.w / w, sy = m.h / h;
    const to = a => a && [a[0] * sx, a[1] * sy];
    const sil = silhouette(m.data, m.w, m.h,
      {head: to(kp.head), neck: to(kp.neck), root: to(kp.root), ankle: to(kp.ankle), feet: kp.feet && [kp.feet[0] * sx, kp.feet[1] * sx]});
    const back = a => a && [Math.round((a[0] + 0.5) / sx * 10) / 10, Math.round((a[1] + 0.5) / sy * 10) / 10];
    return Object.assign(kp, {crown: back(sil.crown), sole: back(sil.sole), cx: sil.cx === null ? null : Math.round((sil.cx + 0.5) / sx * 10) / 10});
  }

  /** Медианы по позам — по снимкам, где найден силуэт: силуэт/«нос–щиколотки», силуэт/корпус, где подошвы. */
  function poseMedians(entries) {
    const by = {};
    for (const e of entries) {
      const k = e.kp;
      if (!k || !k.crown || !k.sole) continue;
      const S = k.sole[1] - k.crown[1], b = by[e.pose] = by[e.pose] || {rN: [], rT: [], offA: [], offR: [], rK: [], offK: []};
      if (k.head && k.ankle) b.rN.push(S / (k.ankle[1] - k.head[1]));
      b.rT.push(S / dist(k.neck, k.root));
      if (k.ankle) b.offA.push((k.sole[1] - k.ankle[1]) / S);
      b.offR.push((k.sole[1] - k.root[1]) / S);
      const kn = k.pts && k.pts.knees;
      if (kn) { b.rK.push(S / (kn[1] - k.neck[1])); b.offK.push((k.sole[1] - kn[1]) / S); }
    }
    const res = {rN: {}, rT: {}, offA: {}, offR: {}, rK: {}, offK: {}, all: {}};
    for (const key of Object.keys(DEFAULT_MED)) {
      for (const [pose, b] of Object.entries(by)) { const m = median(b[key]); if (m !== null) res[key][pose] = m; }
      res.all[key] = median(Object.values(res[key])) ?? DEFAULT_MED[key];
    }
    return res;
  }

  /** Наклон оси тела «щиколотки (пятки, колени) → середина плеч» от вертикали, радианы; поворот на него ставит ось вертикально. */
  function bodyAngle(kp) {
    const a = kp.ankle || (kp.pts && (kp.pts.heels || kp.pts.knees));
    if (!a || !kp.neck || kp.neck[1] >= a[1]) return 0;
    const th = Math.atan((kp.neck[0] - a[0]) / (kp.neck[1] - a[1]));
    return Math.max(-MAX_TILT, Math.min(MAX_TILT, th));
  }

  /** Снимок после поворота вокруг стоп: высоты точек подгонки и центр корпуса (в пикселях снимка). */
  function prepare(kp) {
    const th = bodyAngle(kp), A = kp.ankle || (kp.pts && (kp.pts.heels || kp.pts.knees)) || kp.root, co = Math.cos(th), si = Math.sin(th);
    const R = q => q && [A[0] + co * (q[0] - A[0]) - si * (q[1] - A[1]), A[1] + si * (q[0] - A[0]) + co * (q[1] - A[1])];
    const src = Object.assign({}, kp.pts || {}, {crown: kp.crown, neck: kp.neck, root: kp.root, ankle: kp.ankle, sole: kp.sole, head: kp.head});
    const V = {};
    for (const [n, q] of Object.entries(src)) if (q) V[n] = R(q)[1];
    const c = R(kp.cx != null ? [kp.cx, (kp.neck[1] + kp.root[1]) / 2] : kp.root);
    return {th, A, co, si, V, c};
  }

  /** Матрица canvas (ctx.setTransform(a, b, c, d, e, f)): поворот вокруг стоп, масштаб s, центр корпуса в центр, высота ty. */
  function matrix(p, s, ty) {
    const tx = FRAME.W / 2 - s * p.c[0];
    return {a: s * p.co, b: s * p.si, c: -s * p.si, d: s * p.co,
            e: s * (p.A[0] - p.co * p.A[0] + p.si * p.A[1]) + tx, f: s * (p.A[1] - p.si * p.A[0] - p.co * p.A[1]) + ty};
  }

  /** Один снимок без шаблона позы: масштаб по силуэту, иначе по «нос–щиколотки», «плечи–колени» или корпусу (медианы med). */
  function alignTransform(kp, pose, med) {
    const m = key => med[key][pose] ?? med.all[key], p = prepare(kp), V = p.V;
    let S, by;
    if (V.crown != null && V.sole != null) { S = V.sole - V.crown; by = "силуэт"; }
    else if (V.head != null && V.ankle != null) { S = (V.ankle - V.head) * m("rN"); by = "рост"; }
    else if (V.knees != null && V.knees > V.neck) { S = (V.knees - V.neck) * m("rK"); by = "колени"; }
    else { S = dist(kp.neck, kp.root) * m("rT"); by = "корпус"; }
    const floor = V.sole ?? (V.ankle != null ? V.ankle + m("offA") * S : by === "колени" ? V.knees + m("offK") * S : V.root + m("offR") * S);
    const s = FRAME.HS / S;
    return Object.assign(matrix(p, s, (FRAME.H - FRAME.SOLE_Y) - s * floor), {s, th: p.th, by, feet_cut: !kp.sole});
  }

  /** Взвешенный МНК «высота в кадре = s·высота на снимке + ty»; sd — σ точек: отбрасывать точки дальше 4σ (null — нет). */
  function fitScale(V, T, w, sd, fit = FIT) {
    let use = fit.filter(n => V[n] != null && T[n] != null && w[n] > 0);
    for (;;) {
      if (use.length < 2) return null;
      let W = 0, my = 0, mt = 0, sxx = 0, sxt = 0;
      for (const n of use) { W += w[n]; my += w[n] * V[n]; mt += w[n] * T[n]; }
      my /= W; mt /= W;
      for (const n of use) { sxx += w[n] * (V[n] - my) ** 2; sxt += w[n] * (V[n] - my) * (T[n] - mt); }
      if (sxx <= 0 || sxt <= 0) return null;
      const s = sxt / sxx, ty = mt - s * my;
      let worst = null, wz = 0;
      if (sd) for (const n of use) { const z = Math.abs(s * V[n] + ty - T[n]) / sd[n]; if (z > wz) { wz = z; worst = n; } }
      if (wz > 4 && use.length > 3) { use = use.filter(n => n !== worst); continue; }
      return {s, ty};
    }
  }

  /**
   * Подгонка всех снимков одной позы к общему шаблону (итерации: шаблон ← медианы, веса ← разброс точек). Старт — по
   * силуэту; полных снимков (макушка и подошвы) меньше двух — неполные стартуют по медианам позы (alignTransform), так и
   * поза без единого полного снимка идёт по точкам.
   */
  function fitPose(list, fit = FIT, floor = VAR_FLOOR, med = null, pose = null) {
    const P = list.map(e => prepare(e.kp)), FLOOR = FRAME.H - FRAME.SOLE_Y;
    let tf = P.map(p => {
      if (p.V.crown == null || p.V.sole == null) return null;
      const s = FRAME.HS / (p.V.sole - p.V.crown);
      return {s, ty: FLOOR - s * p.V.sole};
    });
    // полных снимков позы меньше двух — старт неполных по медианам (с ними подгонка сходится хуже, поэтому только тогда)
    if (tf.filter(Boolean).length < 2 && med) tf = tf.map((t, i) => t || (() => {
      const a = alignTransform(list[i].kp, pose, med), p = P[i];
      return {s: a.s, ty: a.f - a.s * (p.A[1] - p.si * p.A[0] - p.co * p.A[1])};
    })());
    if (tf.filter(Boolean).length < 2) return {};
    const w = Object.fromEntries(fit.map(n => [n, 1])), sd = Object.fromEntries(fit.map(n => [n, Infinity]));
    for (let it = 0; it < 15; it++) {
      const T = {};
      for (const n of FIT) {          // шаблон — по всем точкам (и тем, что вне подгонки: их положение тоже нужно знать)
        const v = P.map((p, i) => tf[i] && p.V[n] != null ? tf[i].s * p.V[n] + tf[i].ty : null).filter(x => x !== null);
        if (v.length >= 2) T[n] = median(v);
      }
      // рост в шаблоне — FRAME.HS (нет макушки или подошв ни у одного снимка — масштаб остаётся от старта)
      if (T.crown != null && T.sole != null) {
        const a = FRAME.HS / (T.sole - T.crown), b = FLOOR - a * T.sole;
        for (const n in T) T[n] = a * T[n] + b;
      }
      tf = P.map(p => fitScale(p.V, T, w, it > 0 ? sd : null, fit));
      for (const n of fit) {
        const r = P.map((p, i) => tf[i] && p.V[n] != null && T[n] != null ? tf[i].s * p.V[n] + tf[i].ty - T[n] : null).filter(x => x !== null);
        // вес — по обычному разбросу точки; порог выброса — по устойчивому (1.4826 × медиана отклонений),
        // чтобы один выброс (волосы, таз) не раздувал порог сам себе
        const mean = r.reduce((x, y) => x + y, 0) / (r.length || 1), m = median(r);
        const v = r.reduce((x, y) => x + (y - mean) ** 2, 0) / (r.length || 1);
        const rob = r.length ? (1.4826 * median(r.map(x => Math.abs(x - m)))) ** 2 : 0;
        w[n] = r.length >= 3 ? 1 / Math.max(v, floor) : 0;
        sd[n] = r.length >= 3 ? Math.sqrt(Math.max(rob, TRIM_FLOOR)) : Infinity;
      }
    }
    const out = {};
    list.forEach((e, i) => {
      if (tf[i]) out[e.name] = Object.assign(matrix(P[i], tf[i].s, tf[i].ty), {s: tf[i].s, th: P[i].th, by: "точки", feet_cut: !e.kp.sole});
    });
    return out;
  }

  /**
   * Все снимки → {имя: матрица кадра + s, th, by, feet_cut}. entries: [{name, pose, kp}]; без kp (фигура не найдена) — нет.
   * opts (для проверок): fit — точки подгонки, floor — нижняя граница дисперсии точки (px²).
   */
  function alignAll(entries, opts = {}) {
    const withKp = entries.filter(e => e.kp), med = poseMedians(withKp), byPose = {}, res = {};
    for (const e of withKp) (byPose[e.pose] = byPose[e.pose] || []).push(e);
    for (const [pose, list] of Object.entries(byPose)) {
      const fitted = list.length >= MIN_FIT ? fitPose(list, opts.fit || FIT, opts.floor || VAR_FLOOR, med, pose) : {};
      for (const e of list) res[e.name] = fitted[e.name] || alignTransform(e.kp, pose, med);
    }
    return res;
  }

  /** Вес на дату — ближайшее взвешивание не дальше 14 дней. */
  function nearestWeight(weights, date) {
    let best = null;
    for (const [d, kg] of weights || []) {
      const dd = Math.abs(days(d, date));
      if (dd <= 14 && (!best || dd < best.dd)) best = {dd, kg};
    }
    return best ? best.kg : null;
  }

  /** Вес ровно на дату (для поля «Вес, кг» серии) или null. */
  function exactWeight(weights, date) {
    const w = (weights || []).find(([d]) => d === date);
    return w ? w[1] : null;
  }

  /** «80,1» → 80.1; не число или вне 20–300 → ошибка (те же правила, что settings.parseKg в приложении). */
  function parseKg(v) {
    const s = String(v ?? "").trim().replace(",", ".");
    const kg = /^\d+(\.\d+)?$/.test(s) ? Number(s) : NaN;
    if (!(kg >= 20 && kg <= 300)) throw new Error("Вес: число от 20 до 300");
    return kg;
  }

  /** Индекс data/photos/photos.js + DATA портала → данные страницы (та же форма, что у прежнего photos_data.js). */
  function buildView(index, data, base) {
    const photos = (index && index.photos) || {}, img = {}, aligned = {}, thumb = {}, cut = new Set(), dates = new Set();
    for (const [name, p] of Object.entries(photos)) {
      const q = `${name}.jpg?v=${p.v || 0}`;
      img[name] = `${base}view/${q}`;
      thumb[name] = `${base}thumbs/${q}`;
      if (p.kp) aligned[name] = `${base}aligned/${q}`;
      if (p.feet_cut) cut.add(p.date);
      dates.add(p.date);
    }
    return {
      sessions: [...dates].sort().map(date => ({date, weight: nearestWeight(data && data.weight, date)})),
      img, aligned, thumb, feet_cut: [...cut].sort(),
      poses: POSES.filter(p => Object.values(photos).some(x => x.pose === p)),
    };
  }

  root.PhotosCore = {POSES, POSE_NAMES, PROTOCOL, FRAME, FIT, FOLDER, parseName, exifDate, planSeries, findAlready, dupGroup, keepDup, validatePlan, resolveFolder, projectPath,
                     keypointsFromLandmarks, guessPose, silhouette, detectSize, figureFromDetection, poseMedians, bodyAngle, alignTransform, alignAll, nearestWeight, exactWeight, parseKg, buildView};
})(globalThis);
