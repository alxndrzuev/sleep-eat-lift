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

module.exports = {VARIANTS, cropBox, truthMirror, rleEncode, rleDecode, cacheKey, readIndex, ownJobs, extraJobs,
  cocoTruth, cocoSelect, cocoAsLm, cocoCrops, gtInCrop, lrSwapped};
