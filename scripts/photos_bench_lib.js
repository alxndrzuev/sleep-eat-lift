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

module.exports = {VARIANTS, cropBox, truthMirror, rleEncode, rleDecode, cacheKey, readIndex, ownJobs, extraJobs};
