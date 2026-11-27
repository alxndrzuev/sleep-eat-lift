// Проверочный набор фото (docs/superpowers/specs/2026-11-27-photo-recognition-design.md): чистые функции без браузера —
// нарезка вариантов кадра, кэш, разметка своих и доснятых снимков. Поиск фигуры — desktop/bench/, команды — scripts/photos_bench.js.
// Распознавание — тот же portal/photos_core.js, что в приложении.
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
require('../portal/photos_core.js');
const C = globalThis.PhotosCore;

const VARIANTS = ['full', 'no_feet', 'no_head', 'core', 'tight'];
const VIS = 0.5;
const JITTER = 0.03;                     // сдвиг каждой границы среза — до ±3 % высоты снимка
const IMAGE = /\.(heic|heif|jpe?g|png)$/i;

/** Детерминированный ГПСЧ (mulberry32) от строки: одинаковое зерно — одинаковые срезы. */
function rng(seed) {
  let a = crypto.createHash('sha1').update(String(seed)).digest().readUInt32LE(0);
  return () => {
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Рамка варианта кадра {x, y, w, h} по 33 точкам MediaPipe в пикселях целого снимка ({x, y, visibility}); null — вариант
 * невозможен (нет нужных точек). Срез только по высоте. amp — доля высоты для случайного сдвига границ (0 — без сдвига).
 * no_head — ниже всех точек лица, выше плеч; no_feet — посередине «колени–щиколотки»; core — от середины шеи до середины
 * голени; tight — плечи − 0.15·корпус … колени + 0.15·корпус (плечи и колени всегда внутри).
 */
function cropBox(variant, lm, w, h, seed, amp = JITTER) {
  const vis = i => lm[i] && lm[i].visibility >= VIS ? lm[i] : null;
  const ys = ids => ids.map(vis).filter(Boolean).map(p => p.y);
  const mean = a => a.length ? a.reduce((s, v) => s + v, 0) / a.length : null;
  const face = ys([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10]), sh = ys([11, 12]), hips = ys([23, 24]);
  const knee = mean(ys([25, 26])), ankle = mean(ys([27, 28]));
  if (variant === 'full') return {x: 0, y: 0, w, h};
  if (!sh.length || !hips.length || knee === null) return null;
  const shoulder = Math.min(...sh), T = mean(hips) - mean(sh), r = rng(`${seed}|${variant}`);
  const j = () => amp * h * (2 * r() - 1);
  const neck = face.length ? (Math.max(...face) + shoulder) / 2 : null;
  const shin = ankle !== null ? (knee + ankle) / 2 : null;
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  let top = 0, bottom = h;
  if (variant === 'no_head' || variant === 'core') {
    if (neck === null) return null;
    top = clamp(neck + j(), Math.max(...face) + 1, shoulder - 0.05 * T);
  }
  if (variant === 'no_feet' || variant === 'core') {
    if (shin === null) return null;
    bottom = clamp(shin + j(), knee + 0.05 * T, ankle - 1);
  }
  if (variant === 'tight') {
    top = clamp(shoulder - 0.15 * T + j(), 0, shoulder - 0.05 * T);
    bottom = clamp(knee + 0.15 * T + j(), knee + 0.05 * T, h);
  }
  top = Math.round(Math.max(0, top)); bottom = Math.round(Math.min(h, bottom));
  return {x: 0, y: top, w, h: bottom - top};
}

/** Правильная поза зеркального снимка: правый бок ↔ левый, остальные — как есть. */
const truthMirror = pose => pose === 'side' ? 'side_left' : pose === 'side_left' ? 'side' : pose;

/** Маска 0…1 → длины чередующихся серий (первая — нули, может быть 0). */
function rleEncode(data, thr = 0.5) {
  const out = [];
  let cur = 0, run = 0;
  for (const v of data) {
    const b = v > thr ? 1 : 0;
    if (b === cur) run++; else { out.push(run); cur = b; run = 1; }
  }
  out.push(run);
  return out;
}

function rleDecode(rle, n) {
  const out = new Uint8Array(n);
  let i = 0, b = 0;
  for (const run of rle) { if (b) out.fill(1, i, i + run); i += run; b ^= 1; }
  return out;
}

/** Ключ кэша: файл (sha) + вариант + параметры поиска (модель, размер, пороги). */
const cacheKey = ({sha, variant, params}) => crypto.createHash('sha1').update(`${sha}|${variant}|${JSON.stringify(params)}`).digest('hex');

/** Индекс фото профиля (photos.js = «window.PHOTOS_INDEX = {...};»). */
function readIndex(file) {
  const s = fs.readFileSync(file, 'utf8');
  return JSON.parse(s.slice(s.indexOf('{'), s.lastIndexOf('}') + 1));
}

/** Свои снимки: правильная поза — из индекса (её проверил пользователь). photosDir — папка photos профиля. */
function ownJobs(index, photosDir) {
  return Object.entries((index && index.photos) || {}).filter(([, p]) => p.original && p.pose)
    .map(([id, p]) => ({id, file: path.join(photosDir, p.original), pose: p.pose, sha: p.sha}));
}

/** Доснятые снимки (photo-bench/own/): поза — начало имени файла (side_left раньше side); без позы — пропуск. */
function extraJobs(dir, warn = () => {}) {
  if (!fs.existsSync(dir)) return [];
  const poses = C.POSES.slice().sort((a, b) => b.length - a.length);
  const out = [];
  for (const f of fs.readdirSync(dir).sort()) {
    if (!IMAGE.test(f)) continue;
    const pose = poses.find(p => f.startsWith(p + '_') || f.startsWith(p + '.'));
    if (!pose) { warn(`${f}: в начале имени нет позы (${C.POSES.join(', ')}) — пропущен`); continue; }
    const file = path.join(dir, f);
    out.push({id: 'extra_' + f.replace(/\.[^.]+$/, ''), file, pose, sha: crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')});
  }
  return out;
}

// ---------- публичные фото: COCO 2017 val (разметка CC BY 4.0) ----------
// Точки COCO: 17 по [x, y, v] подряд; v: 0 — нет, 1 — размечена, но не видна, 2 — видна; левое/правое — от человека.
const COCO_TO_MP = [0, 2, 5, 7, 8, 11, 12, 13, 14, 15, 16, 23, 24, 25, 26, 27, 28];   // индекс COCO → индекс MediaPipe
const cp = (k, i) => k[i * 3 + 2] > 0 ? [k[i * 3], k[i * 3 + 1]] : null;

/**
 * Правильная поза по ручной разметке COCO: {pose | null, facing: front|back|side|unclear, up: true|false|null}.
 * Корпус T — середина плеч … середина таза; sw, hw — (левое − правое) по x / T у плеч и таза. Лицом: sw > 0.35 и hw > 0.15;
 * спиной: sw < −0.35 и hw < −0.15; боком: |sw| < 0.2 и |hw| < 0.15 (направление — по носу относительно ушей или плеч,
 * > 0.05·T; вправо на снимке = правым боком = side); иначе unclear. Руки вверх — все размеченные кисти выше плеч на > 0.3·T,
 * вниз — все ниже плеч; иначе null (для лицом/спиной поза тогда неясна).
 */
function cocoTruth(k) {
  const none = {pose: null, facing: 'unclear', up: null};
  const ls = cp(k, 5), rs = cp(k, 6), lh = cp(k, 11), rh = cp(k, 12);
  if (!ls || !rs || !lh || !rh) return none;
  const ms = [(ls[0] + rs[0]) / 2, (ls[1] + rs[1]) / 2], mh = [(lh[0] + rh[0]) / 2, (lh[1] + rh[1]) / 2];
  const T = Math.hypot(ms[0] - mh[0], ms[1] - mh[1]);
  if (!T) return none;
  const sw = (ls[0] - rs[0]) / T, hw = (lh[0] - rh[0]) / T;
  const ups = [[9, ls], [10, rs]].map(([i, s]) => cp(k, i) && (s[1] - cp(k, i)[1]) / T).filter(v => typeof v === 'number');
  const up = !ups.length ? null : ups.every(v => v > 0.3) ? true : ups.every(v => v < 0) ? false : null;
  let facing = 'unclear', pose = null;
  if (sw > 0.35 && hw > 0.15) facing = 'front';
  else if (sw < -0.35 && hw < -0.15) facing = 'back';
  else if (Math.abs(sw) < 0.2 && Math.abs(hw) < 0.15) facing = 'side';
  if (facing === 'side') {
    const nose = cp(k, 0), ears = [cp(k, 3), cp(k, 4)].filter(Boolean);
    const ref = ears.length ? ears.reduce((a, e) => a + e[0], 0) / ears.length : ms[0];
    const dx = nose ? nose[0] - ref : 0;
    if (Math.abs(dx) > 0.05 * T) pose = dx > 0 ? 'side' : 'side_left';
  } else if (facing !== 'unclear' && up !== null) pose = facing === 'front' ? (up ? 'front_flex' : 'front') : (up ? 'back_flex' : 'back');
  return {pose, facing, up};
}

/**
 * Подходящие люди из разметки COCO ({images, annotations}): один крупный человек на снимке (рамка ≥ 50 % высоты, прочие
 * люди < 30 %), размечены плечи, таз, колени (из каждой пары хотя бы одна видна), стоит: таз выше колен, щиколотки (если
 * размечены) ниже колен. → [{id, url, file, box, kps, truth, w, h}].
 */
function cocoSelect(data) {
  const byImg = {};
  for (const a of data.annotations || []) if (a.category_id === 1) (byImg[a.image_id] = byImg[a.image_id] || []).push(a);
  const out = [];
  for (const im of data.images || []) {
    const people = byImg[im.id] || [];
    const big = people.filter(a => a.bbox[3] >= 0.5 * im.height);
    if (big.length !== 1 || people.some(a => a !== big[0] && a.bbox[3] >= 0.3 * im.height)) continue;
    const k = big[0].keypoints, v = i => k[i * 3 + 2];
    if (![[5, 6], [11, 12], [13, 14]].every(([a, b]) => v(a) > 0 && v(b) > 0 && (v(a) === 2 || v(b) === 2))) continue;
    const y = i => k[i * 3 + 1], my = (a, b) => (y(a) + y(b)) / 2;
    if (!(my(11, 12) < my(13, 14))) continue;
    const ank = [15, 16].filter(i => v(i) > 0);
    if (ank.length && !(ank.reduce((s, i) => s + y(i), 0) / ank.length > my(13, 14))) continue;
    out.push({id: `coco_${im.id}`, url: im.coco_url, file: im.file_name, box: big[0].bbox, kps: k, truth: cocoTruth(k), w: im.width, h: im.height});
  }
  return out;
}

/** Точки COCO → 33 точки в формате MediaPipe (пиксели; размеченная = видима) — для cropBox. */
function cocoAsLm(k) {
  const lm = Array.from({length: 33}, () => ({x: 0, y: 0, visibility: 0}));
  COCO_TO_MP.forEach((m, i) => { if (k[i * 3 + 2] > 0) lm[m] = {x: k[i * 3], y: k[i * 3 + 1], visibility: 1}; });
  return lm;
}

/** Варианты кадра для человека COCO: «целый» — его рамка ±10 % (по высоте — до краёв снимка), прочие — срез внутри неё. */
function cocoCrops(sel, amp = JITTER) {
  const [bx, by, bw, bh] = sel.box;
  const x0 = Math.max(0, Math.round(bx - 0.1 * bw)), x1 = Math.min(sel.w, Math.round(bx + 1.1 * bw));
  const y0 = Math.max(0, Math.round(by - 0.1 * bh)), y1 = Math.min(sel.h, Math.round(by + 1.1 * bh));
  const lm = cocoAsLm(sel.kps), out = [];
  for (const v of VARIANTS) {
    const b = v === 'full' ? {y: y0, h: y1 - y0} : cropBox(v, lm, sel.w, sel.h, sel.id, amp);
    if (!b) continue;
    const top = Math.max(y0, b.y), bottom = Math.min(y1, b.y + b.h);
    if (bottom > top) out.push({variant: v, x: x0, y: top, w: x1 - x0, h: bottom - top});
  }
  return out;
}

/** Разметка COCO → в координаты варианта кадра (сдвиг; зеркало — отражение по x и левое ↔ правое). */
function gtInCrop(k, crop) {
  const out = k.slice();
  for (let i = 0; i < 17; i++) {
    const src = crop.mirror && i > 0 ? (i % 2 ? i + 1 : i - 1) : i;
    const x = k[src * 3], y = k[src * 3 + 1], v = k[src * 3 + 2];
    out[i * 3] = v > 0 ? (crop.mirror ? crop.w - (x - crop.x) : x - crop.x) : 0;
    out[i * 3 + 1] = v > 0 ? y - crop.y : 0;
    out[i * 3 + 2] = v;
  }
  return out;
}

/**
 * Перепутал ли MediaPipe левое и правое (lm — 33 точки в пикселях, k — разметка COCO в тех же координатах): плечи, таз,
 * колени «накрест» ближе к разметке, чем «прямо». null — нет пар или человек боком (плечи уже 0.15 корпуса — сравнивать нечего).
 */
function lrSwapped(lm, k) {
  const ls = cp(k, 5), rs = cp(k, 6), lh = cp(k, 11), rh = cp(k, 12);
  if (!ls || !rs || !lh || !rh) return null;
  const T = Math.hypot((ls[0] + rs[0] - lh[0] - rh[0]) / 2, (ls[1] + rs[1] - lh[1] - rh[1]) / 2);
  if (Math.abs(ls[0] - rs[0]) < 0.15 * T) return null;
  const m = i => lm[i] && lm[i].visibility > 0 ? [lm[i].x, lm[i].y] : null;
  const d = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
  let straight = 0, cross = 0, n = 0;
  for (const [ml, mr, cl, cr] of [[11, 12, 5, 6], [23, 24, 11, 12], [25, 26, 13, 14]]) {
    const a = m(ml), b = m(mr), g = cp(k, cl), h = cp(k, cr);
    if (!a || !b || !g || !h) continue;
    straight += d(a, g) + d(b, h); cross += d(a, h) + d(b, g); n++;
  }
  return n ? cross < straight : null;
}

// ---------- оценка по кэшу и отчёт ----------
const median = a => a.length ? a.slice().sort((x, y) => x - y)[Math.floor(a.length / 2)] : null;
const pct = (a, q) => a.length ? a.slice().sort((x, y) => x - y)[Math.min(a.length - 1, Math.floor(q * a.length))] : null;
const r1 = v => v === null ? null : Math.round(v * 10) / 10;
const apply = (t, p) => [t.a * p[0] + t.c * p[1] + t.e, t.b * p[0] + t.d * p[1] + t.f];
const baseVariant = v => v.replace(/_mirror$/, '');

/** Запись кэша → опорные точки тем же путём, что в приложении (PhotosCore.figureFromDetection). */
function figure(e) {
  if (!e.lm) return null;
  const mask = e.mask && {w: e.mask.w, h: e.mask.h, data: rleDecode(e.mask.rle, e.mask.w * e.mask.h)};
  return C.figureFromDetection({lm: e.lm, mask}, e.w, e.h);
}

/** Точки сравнения выравнивания (плечи, таз, колени) целого снимка → в координаты варианта кадра (без зеркала). */
function anchors(kp, crop) {
  return [kp.neck, kp.root, kp.pts && kp.pts.knees].filter(Boolean).map(p => [p[0] - crop.x, p[1] - crop.y]);
}

/** Выровненные положения точек целых снимков своей позы: {id: [[x, y], …]} (как alignAll в приложении — по всей позе). */
function alignedFull(fulls) {
  const byPose = {}, out = {};
  for (const f of fulls) (byPose[f.e.truth] = byPose[f.e.truth] || []).push(f);
  for (const [pose, list] of Object.entries(byPose)) {
    const tf = C.alignAll(list.map(f => ({name: f.e.id, pose, kp: f.kp})));
    for (const f of list) if (tf[f.e.id]) out[f.e.id] = {tf: tf[f.e.id], pts: anchors(f.kp, f.e.crop).map(p => apply(tf[f.e.id], p))};
  }
  return out;
}

const meanDist = (a, b) => { const n = Math.min(a.length, b.length); let s = 0; for (let i = 0; i < n; i++) s += Math.hypot(a[i][0] - b[i][0], a[i][1] - b[i][1]); return n ? s / n : 0; };

const ownFulls = entries => entries.filter(e => e.source === 'own' && e.variant === 'full' && e.truth).map(e => ({e, kp: figure(e)})).filter(f => f.kp);

/**
 * Согласованность выравнивания целых своих снимков (правды о «верном» выравнивании нет — есть постоянство тела): точка
 * исключается из подгонки, и смотрим, насколько по-разному она легла по высоте на снимках одной позы (1.4826 · MAD, px).
 * → {points: {точка: px — среднее по позам}, mean}. Меньше — лучше; сравнивать с исходной точкой.
 */
function consistency(entries) {
  const fulls = ownFulls(entries), points = {};
  for (const n of ['eyes', 'neck', 'root', 'knees', 'ankle']) {
    const sds = [];
    for (const pose of new Set(fulls.map(f => f.e.truth))) {
      const list = fulls.filter(f => f.e.truth === pose);
      if (list.length < 3) continue;
      const tf = C.alignAll(list.map(f => ({name: f.e.id, pose, kp: f.kp})), {fit: C.FIT.filter(x => x !== n)}), ys = [];
      for (const f of list) {
        const p = Object.assign({neck: f.kp.neck, root: f.kp.root, ankle: f.kp.ankle}, f.kp.pts)[n], t = tf[f.e.id];
        if (p && t) ys.push(apply(t, p)[1]);
      }
      if (ys.length < 3) continue;
      const m = median(ys);
      sds.push(1.4826 * median(ys.map(y => Math.abs(y - m))));
    }
    if (sds.length) points[n] = r1(sds.reduce((a, b) => a + b, 0) / sds.length);
  }
  const v = Object.values(points);
  return {points, mean: v.length ? r1(v.reduce((a, b) => a + b, 0) / v.length) : null};
}

/** Как в приложении: вариант без фигуры — из прогона с полем (retry), если там нашлась; время — обе попытки. */
function mergeRetry(primary, retry) {
  const by = new Map(retry.map(e => [`${e.source}|${e.id}|${e.variant}`, e]));
  return primary.map(e => {
    if (figure(e)) return e;
    const r = by.get(`${e.source}|${e.id}|${e.variant}`);
    return r && figure(r) ? Object.assign({}, r, {ms: e.ms + r.ms}) : e;
  });
}

/** Исходная точка: поза и выровненные точки целых своих снимков по нынешнему коду + их согласованность. */
function baselineOf(entries) {
  const fulls = ownFulls(entries), al = alignedFull(fulls), photos = {};
  for (const f of fulls) photos[f.e.id] = {pose: C.guessPose(f.kp), pts: al[f.e.id] ? al[f.e.id].pts.map(p => p.map(r1)) : []};
  return {photos, consistency: consistency(entries).mean};
}

/**
 * Записи кэша → цифры: rows[«источник|вариант»] = {n, found, correct, confusion: {правильная: {угаданная | none: n}}, ms};
 * lr — COCO: левое/правое перепутаны; align[вариант] — свои, без зеркала: сдвиг выравнивания против целого (px, медиана, p90)
 * и разница наклона (°); base — против исходной точки (opts.baseline); unclear — снимков без правильной позы.
 */
function evaluate(entries, opts = {}) {
  const rows = {}, lr = {n: 0, swapped: 0};
  let unclear = 0;
  const withKp = entries.map(e => ({e, kp: figure(e)}));
  for (const {e, kp} of withKp) {
    if (!e.truth) { unclear++; continue; }
    const key = `${e.source}|${e.variant}`;
    const r = rows[key] = rows[key] || {source: e.source, variant: e.variant, n: 0, found: 0, correct: 0, confusion: {}, ms: []};
    const guess = kp ? C.guessPose(kp) : null;
    r.n++; r.ms.push(e.ms);
    if (kp) r.found++;
    if (kp && guess === e.truth) r.correct++;
    if (kp) { const c = r.confusion[e.truth] = r.confusion[e.truth] || {}; c[guess || 'none'] = (c[guess || 'none'] || 0) + 1; }
    if (e.source === 'coco' && e.gt && e.lm) {
      const sw = lrSwapped(e.lm.map(p => ({x: p.x * e.w, y: p.y * e.h, visibility: p.visibility})), gtInCrop(e.gt, e.crop));
      if (sw !== null) { lr.n++; if (sw) lr.swapped++; }
    }
  }
  for (const r of Object.values(rows)) r.ms = Math.round(r.ms.reduce((a, b) => a + b, 0) / (r.ms.length || 1));
  // выравнивание: вариант вместо целого в серии своей позы
  const own = withKp.filter(x => x.e.source === 'own' && x.kp && x.e.truth);
  const fulls = own.filter(x => x.e.variant === 'full'), byId = Object.fromEntries(fulls.map(f => [f.e.id, f]));
  const al = alignedFull(fulls), shifts = {};
  for (const x of own) {
    const v = x.e.variant, f = byId[x.e.id];
    if (v === 'full' || v.endsWith('_mirror') || !f || !al[x.e.id]) continue;
    const list = fulls.filter(g => g.e.truth === x.e.truth).map(g => ({name: g.e.id, pose: g.e.truth, kp: g === f ? x.kp : g.kp}));
    const tf = C.alignAll(list)[x.e.id];
    if (!tf) continue;
    const s = shifts[v] = shifts[v] || {d: [], th: []};
    s.d.push(meanDist(anchors(f.kp, x.e.crop).map(p => apply(tf, p)), al[x.e.id].pts));
    s.th.push(Math.abs(tf.th - al[x.e.id].tf.th) * 180 / Math.PI);
  }
  const align = Object.fromEntries(Object.entries(shifts).map(([v, s]) =>
    [v, {n: s.d.length, median: r1(median(s.d)), p90: r1(pct(s.d, 0.9)), dth: r1(median(s.th))}]));
  let base = null;
  if (opts.baseline) {
    const now = baselineOf(entries).photos, was = opts.baseline.photos, ids = Object.keys(was);
    base = {n: ids.length, poseChanged: ids.filter(id => now[id] && now[id].pose !== was[id].pose),
            maxShift: r1(Math.max(0, ...ids.filter(id => now[id]).map(id => meanDist(now[id].pts, was[id].pts)))),
            consistency: opts.baseline.consistency};
  }
  return {rows, lr, align, base, unclear, consistency: consistency(entries)};
}

/** Цифры → отчёт (markdown): таблицы и планка «готово» из дизайна. Только сводные цифры — без координат точек. */
function report(s, {date, params} = {}) {
  const P = (a, b) => b ? `${Math.round(100 * a / b)} %` : '—';
  const L = [`# Проверка фото — ${date || ''}`, '', `Параметры поиска: ${JSON.stringify(params || {})}`, '',
    '## Фигура найдена / поза верна', '', '| источник | вариант | снимков | найдена | поза верна (из найденных) | мс |', '|---|---|---|---|---|---|'];
  const rows = Object.values(s.rows).sort((a, b) => a.source.localeCompare(b.source) ||
    VARIANTS.indexOf(baseVariant(a.variant)) - VARIANTS.indexOf(baseVariant(b.variant)) || a.variant.localeCompare(b.variant));
  for (const r of rows) L.push(`| ${r.source} | ${r.variant} | ${r.n} | ${P(r.found, r.n)} | ${P(r.correct, r.found)} | ${r.ms} |`);
  L.push('', '## Ошибки позы (правильная → угаданная: снимков)', '');
  const errs = {};
  for (const r of rows) for (const [t, g] of Object.entries(r.confusion)) for (const [k, n] of Object.entries(g))
    if (k !== t) { const key = `${r.source}: ${t} → ${k}`; errs[key] = (errs[key] || 0) + n; }
  L.push(...(Object.keys(errs).length ? Object.entries(errs).sort((a, b) => b[1] - a[1]).map(([k, n]) => `- ${k}: ${n}`) : ['- нет']));
  if (s.lr.n) L.push('', `## Левое/правое (COCO)`, '', `MediaPipe перепутал стороны: ${s.lr.swapped} из ${s.lr.n} (${P(s.lr.swapped, s.lr.n)})`);
  L.push('', '## Сдвиг выравнивания (свои, вариант против целого)', '', '| вариант | снимков | медиана, px | p90, px | наклон, ° |', '|---|---|---|---|---|');
  for (const v of VARIANTS) if (s.align[v]) L.push(`| ${v} | ${s.align[v].n} | ${s.align[v].median} | ${s.align[v].p90} | ${s.align[v].dth} |`);
  if (s.base) L.push('', '## Против исходного кода', '', `Снимков: ${s.base.n}; поза изменилась: ${s.base.poseChanged.length ? s.base.poseChanged.join(', ') : 'нет'}; наибольший сдвиг: ${s.base.maxShift} px`);
  if (s.consistency && s.consistency.mean !== null) L.push('', '## Согласованность целых (точка вне подгонки, разброс по высоте, px)', '',
    Object.entries(s.consistency.points).map(([n, v]) => `${n} ${v}`).join(' · ') + ` — среднее ${s.consistency.mean}` +
    (s.base && s.base.consistency != null ? ` (исходный код: ${s.base.consistency})` : ''));
  // планка
  const sum = (src, pred) => rows.filter(r => r.source === src && pred(baseVariant(r.variant)))
    .reduce((a, r) => ({n: a.n + r.n, found: a.found + r.found, correct: a.correct + r.correct}), {n: 0, found: 0, correct: 0});
  const bar = [], ok = (c, text) => bar.push(`${c ? '✅' : '❌'} ${text}`);
  const own = sum('own', () => true);
  if (own.n) {
    ok(own.correct === own.found, `свои: поза верна во всех найденных (${own.correct} из ${own.found})`);
    for (const [vs, need] of [[['full'], 1], [['no_feet', 'no_head', 'core'], 0.95], [['tight'], 0.9]])
      for (const v of vs) { const x = sum('own', w => w === v); if (x.n) ok(x.found / x.n >= need, `свои, ${v}: фигура найдена ${P(x.found, x.n)} (нужно ≥ ${need * 100} %)`); }
    for (const v of VARIANTS) if (s.align[v]) ok(s.align[v].median <= 25 && s.align[v].p90 <= 50, `свои, ${v}: сдвиг медиана ${s.align[v].median} ≤ 25, p90 ${s.align[v].p90} ≤ 50`);
    if (s.base) ok(!s.base.poseChanged.length && s.base.maxShift <= 5, `65 целых: поза та же, сдвиг ${s.base.maxShift} ≤ 5 px`);
    if (s.base && s.base.consistency != null && s.consistency.mean !== null)
      ok(s.consistency.mean <= s.base.consistency + 1, `целые выровнены не хуже: согласованность ${s.consistency.mean} ≤ ${s.base.consistency} + 1 px`);
  }
  const coco = sum('coco', () => true);
  if (coco.n) ok(coco.correct / (coco.found || 1) >= 0.9, `COCO: поза верна ${P(coco.correct, coco.found)} найденных (нужно ≥ 90 %)`);
  const extra = rows.filter(r => r.source === 'extra' && /^side/.test(Object.keys(r.confusion)[0] || ''))
    .reduce((a, r) => ({found: a.found + r.found, correct: a.correct + r.correct}), {found: 0, correct: 0});
  if (extra.found) ok(extra.correct / extra.found >= 0.95, `доснятые сбоку: «Сбоку» ${P(extra.correct, extra.found)} (нужно ≥ 95 %)`);
  L.push('', '## Планка «готово»', '', ...bar, '');
  return L.join('\n');
}

module.exports = {VARIANTS, cropBox, truthMirror, rleEncode, rleDecode, cacheKey, readIndex, ownJobs, extraJobs,
  cocoTruth, cocoSelect, cocoAsLm, cocoCrops, gtInCrop, lrSwapped,
  figure, mergeRetry, evaluate, baselineOf, consistency, report};
