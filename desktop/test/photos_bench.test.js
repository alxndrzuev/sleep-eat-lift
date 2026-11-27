// scripts/photos_bench_lib.js — проверочный набор фото: нарезка вариантов кадра, кэш, разметка, оценка (без настоящих фото).
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const B = require('../../scripts/photos_bench_lib.js');

// фигура на снимке 1000×2000 (пиксели): лицо 150…260, плечи 400, таз 900, колени 1400, щиколотки 1800
function figure({face = true, ankles = true} = {}) {
  const lm = Array.from({length: 33}, () => ({x: 0, y: 0, visibility: 0}));
  const set = (i, x, y) => { lm[i] = {x, y, visibility: 0.9}; };
  if (face) { set(0, 500, 200); for (let i = 1; i <= 8; i++) set(i, 480 + i * 5, 150 + i * 5); set(9, 490, 260); set(10, 510, 260); }
  set(11, 600, 400); set(12, 400, 400); set(13, 620, 650); set(14, 380, 650); set(15, 630, 880); set(16, 370, 880);
  set(23, 560, 900); set(24, 440, 900); set(25, 560, 1400); set(26, 440, 1400);
  if (ankles) { set(27, 560, 1800); set(28, 440, 1800); set(29, 560, 1830); set(30, 440, 1830); set(31, 600, 1850); set(32, 400, 1850); }
  return lm;
}

test('crop boxes: full is the whole photo', () => {
  assert.deepStrictEqual(B.cropBox('full', figure(), 1000, 2000, 'a', 0), {x: 0, y: 0, w: 1000, h: 2000});
});

test('crop boxes: no_head cuts below the face and above shoulders', () => {
  const b = B.cropBox('no_head', figure(), 1000, 2000, 'a', 0);
  assert.deepStrictEqual(b, {x: 0, y: 330, w: 1000, h: 1670});          // (260 + 400) / 2
  for (const seed of ['a', 'b', 'c', 'd', 'e']) {
    const j = B.cropBox('no_head', figure(), 1000, 2000, seed);
    assert.ok(j.y > 260 && j.y < 400, `${seed}: ${j.y}`);
  }
});

test('crop boxes: no_feet between knees and ankles', () => {
  assert.deepStrictEqual(B.cropBox('no_feet', figure(), 1000, 2000, 'a', 0), {x: 0, y: 0, w: 1000, h: 1600});
});

test('crop boxes: core — from the neck to mid-shin', () => {
  assert.deepStrictEqual(B.cropBox('core', figure(), 1000, 2000, 'a', 0), {x: 0, y: 330, w: 1000, h: 1270});
});

test('crop boxes: tight — shoulders and knees inside', () => {
  assert.deepStrictEqual(B.cropBox('tight', figure(), 1000, 2000, 'a', 0), {x: 0, y: 325, w: 1000, h: 1150});   // ± 0.15 · корпус 500
  for (const seed of ['a', 'b', 'c', 'd', 'e']) {
    const j = B.cropBox('tight', figure(), 1000, 2000, seed);
    assert.ok(j.y < 400 && j.y + j.h > 1400, `${seed}: ${J(j)}`);
  }
});

const J = JSON.stringify;

test('crop boxes: jitter is deterministic per seed and within ±3 %', () => {
  const a = B.cropBox('no_feet', figure(), 1000, 2000, 'x'), b = B.cropBox('no_feet', figure(), 1000, 2000, 'x');
  assert.deepStrictEqual(a, b);
  const hs = ['p', 'q', 'r', 's', 't'].map(s => B.cropBox('no_feet', figure(), 1000, 2000, s).h);
  assert.ok(new Set(hs).size > 1, J(hs));
  for (const h of hs) assert.ok(Math.abs(h - 1600) <= 60, J(hs));
});

test('crop boxes: impossible variants → null', () => {
  assert.strictEqual(B.cropBox('no_head', figure({face: false}), 1000, 2000, 'a'), null);
  assert.strictEqual(B.cropBox('core', figure({face: false}), 1000, 2000, 'a'), null);
  assert.strictEqual(B.cropBox('no_feet', figure({ankles: false}), 1000, 2000, 'a'), null);
  assert.ok(B.cropBox('tight', figure({face: false, ankles: false}), 1000, 2000, 'a'));
});

test('mirror truth', () => {
  assert.deepStrictEqual(['side', 'side_left', 'front', 'back_flex'].map(B.truthMirror), ['side_left', 'side', 'front', 'back_flex']);
});

test('rle roundtrip', () => {
  const data = [0, 0.2, 0.9, 1, 1, 0, 0.6, 0, 0];
  const rle = B.rleEncode(data);
  assert.deepStrictEqual(rle, [2, 3, 1, 1, 2]);
  assert.deepStrictEqual([...B.rleDecode(rle, data.length)], [0, 0, 1, 1, 1, 0, 1, 0, 0]);
  assert.deepStrictEqual(B.rleEncode([1, 1]), [0, 2]);
  assert.deepStrictEqual([...B.rleDecode([0, 2], 2)], [1, 1]);
});

test('cache key differs by params and variant', () => {
  const k = o => B.cacheKey(Object.assign({sha: 'abc', variant: 'full', params: {model: 'full', side: 1024}}, o));
  assert.strictEqual(k({}), k({}));
  assert.notStrictEqual(k({}), k({variant: 'tight'}));
  assert.notStrictEqual(k({}), k({params: {model: 'full', side: 1536}}));
  assert.notStrictEqual(k({}), k({params: {model: 'heavy', side: 1024}}));
});

test('own jobs from index', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bench-'));
  fs.writeFileSync(path.join(dir, 'photos.js'), '// Собрано страницей\nwindow.PHOTOS_INDEX = ' + J({version: 1, photos: {
    '2026-01-01_front': {date: '2026-01-01', pose: 'front', original: 'originals/2026-01-01_front.heic', sha: 's1'},
    '2026-01-01_side': {date: '2026-01-01', pose: 'side', original: 'originals/2026-01-01_side.jpg', sha: 's2'}}}) + ';\n');
  const idx = B.readIndex(path.join(dir, 'photos.js'));
  assert.deepStrictEqual(B.ownJobs(idx, dir), [
    {id: '2026-01-01_front', file: path.join(dir, 'originals/2026-01-01_front.heic'), pose: 'front', sha: 's1'},
    {id: '2026-01-01_side', file: path.join(dir, 'originals/2026-01-01_side.jpg'), pose: 'side', sha: 's2'}]);
});

test('extra jobs: pose from file name, side_left before side', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bench-'));
  for (const f of ['side_arms_1.jpg', 'side_left_arms.HEIC', 'front_x.jpg', 'IMG_1.jpg', 'notes.txt']) fs.writeFileSync(path.join(dir, f), f);
  const jobs = B.extraJobs(dir);
  assert.deepStrictEqual(jobs.map(j => [j.id, j.pose]), [['extra_front_x', 'front'], ['extra_side_arms_1', 'side'], ['extra_side_left_arms', 'side_left']]);
  assert.match(jobs[0].sha, /^[0-9a-f]{64}$/);
  assert.deepStrictEqual(B.extraJobs(path.join(dir, 'нет')), []);
});

// COCO: 17 точек [x, y, v] подряд (v: 0 — нет, 1 — размечена, но не видна, 2 — видна); left/right — от человека
function coco(pts) {
  const k = Array(51).fill(0);
  for (const [i, [x, y, v = 2]] of Object.entries(pts)) { k[i * 3] = x; k[i * 3 + 1] = y; k[i * 3 + 2] = v; }
  return k;
}
// лицом к камере: левое плечо человека — справа на снимке; корпус 500 px
const FRONT = {0: [500, 200], 3: [530, 190], 4: [470, 190], 5: [620, 400], 6: [380, 400], 9: [640, 880], 10: [360, 880],
  11: [570, 900], 12: [430, 900], 13: [565, 1400], 14: [435, 1400], 15: [560, 1800], 16: [440, 1800]};
const mirrorX = (pts, cx = 500) => Object.fromEntries(Object.entries(pts).map(([i, [x, y, v]]) => [i, [2 * cx - x, y, v]]));
// боком, смотрит вправо на снимке (правый бок к камере): плечи и таз почти в одной точке по x, нос впереди ушей
const SIDE = {0: [560, 200], 4: [500, 195], 5: [505, 400, 1], 6: [495, 400], 9: [520, 880, 1], 10: [510, 880],
  11: [505, 900, 1], 12: [495, 900], 13: [520, 1400, 1], 14: [515, 1400], 15: [500, 1800, 1], 16: [495, 1800]};

test('coco truth: front, back, side right/left, unclear 3/4, arms up', () => {
  const t = pts => B.cocoTruth(coco(pts)).pose;
  assert.strictEqual(t(FRONT), 'front');
  const up = Object.assign({}, FRONT, {9: [650, 230], 10: [350, 230]});
  assert.strictEqual(t(up), 'front_flex');
  assert.strictEqual(t(mirrorX(FRONT)), 'back');                    // левое плечо слева на снимке — спиной
  assert.strictEqual(t(Object.assign(mirrorX(up), {0: [0, 0, 0], 3: [0, 0, 0], 4: [0, 0, 0]})), 'back_flex');
  assert.strictEqual(t(SIDE), 'side');
  assert.strictEqual(t(mirrorX(SIDE)), 'side_left');
  const threeQ = Object.assign({}, FRONT, {5: [570, 400], 6: [450, 400], 11: [540, 900], 12: [470, 900]});   // sw 0.24
  assert.deepStrictEqual(B.cocoTruth(coco(threeQ)), {pose: null, facing: 'unclear', up: false});
  const half = Object.assign({}, FRONT, {9: [640, 380], 10: [360, 880]});                 // одна кисть у плеча — неясно
  assert.strictEqual(t(half), null);
  assert.strictEqual(t({0: [500, 200]}), null);
});

test('coco select: one large standing person only', () => {
  const img = (id, h = 2000) => ({id, height: h, width: 1000, file_name: `${id}.jpg`, coco_url: `http://x/${id}.jpg`});
  const ann = (image_id, pts, bh = 1800, extra = {}) => Object.assign({image_id, category_id: 1, bbox: [300, 100, 400, bh], keypoints: coco(pts), iscrowd: 0}, extra);
  const sitting = Object.assign({}, FRONT, {13: [565, 880], 14: [435, 880]});            // колени на высоте таза
  const noKnees = Object.assign({}, FRONT, {13: [0, 0, 0]});
  const data = {images: [img(1), img(2), img(3), img(4), img(5)], annotations: [
    ann(1, FRONT), ann(2, FRONT), ann(2, FRONT, 900), ann(3, sitting), ann(4, noKnees), ann(5, FRONT, 800)]};
  const sel = B.cocoSelect(data);
  assert.deepStrictEqual(sel.map(s => s.id), ['coco_1']);
  assert.deepStrictEqual([sel[0].url, sel[0].file, sel[0].truth.pose, sel[0].w, sel[0].h], ['http://x/1.jpg', '1.jpg', 'front', 1000, 2000]);
});

test('coco crops: person box with margin, variants inside it', () => {
  const sel = {box: [300, 100, 400, 1800], kps: coco(FRONT), w: 1000, h: 2000, id: 'coco_1'};
  const cr = Object.fromEntries(B.cocoCrops(sel, 0).map(c => [c.variant, c]));
  assert.deepStrictEqual(cr.full, {variant: 'full', x: 260, y: 0, w: 480, h: 2000});    // ±10 % рамки, по высоте до краёв снимка
  assert.deepStrictEqual(cr.no_feet, {variant: 'no_feet', x: 260, y: 0, w: 480, h: 1600});
  assert.ok(cr.no_head.y > 200 && cr.no_head.y < 400);
  assert.ok(cr.tight && cr.core);
});

test('ground truth in crop coordinates: shifted, mirrored with left/right swapped', () => {
  const k = coco(FRONT), crop = {x: 260, y: 100, w: 480, h: 1800};
  const g = B.gtInCrop(k, Object.assign({mirror: false}, crop));
  assert.deepStrictEqual([g[15], g[16], g[17]], [360, 300, 2]);                        // левое плечо: 620 − 260, 400 − 100
  const m = B.gtInCrop(k, Object.assign({mirror: true}, crop));
  assert.deepStrictEqual([m[15], m[16], m[17]], [480 - (380 - 260), 300, 2]);          // левое ← правое, отражено
});

test('lr swap: detected straight / swapped / side → null', () => {
  const k = coco(FRONT);
  const mp = (map) => {
    const lm = Array.from({length: 33}, () => ({x: 0, y: 0, visibility: 0}));
    for (const [i, c] of Object.entries(map)) lm[i] = {x: k[c * 3] + 5, y: k[c * 3 + 1] - 5, visibility: 0.9};
    return lm;
  };
  assert.strictEqual(B.lrSwapped(mp({11: 5, 12: 6, 23: 11, 24: 12, 25: 13, 26: 14}), k), false);
  assert.strictEqual(B.lrSwapped(mp({11: 6, 12: 5, 23: 12, 24: 11, 25: 14, 26: 13}), k), true);
  assert.strictEqual(B.lrSwapped(mp({11: 5, 12: 6, 23: 11, 24: 12}), coco(SIDE)), null);
});

// ---------- оценка по кэшу ----------
/** 33 точки MediaPipe (нормированные) из {индекс: [x, y]}; остальные невидимы. */
function mlm(points) {
  const out = Array.from({length: 33}, () => ({x: 0, y: 0, z: 0, visibility: 0}));
  for (const [i, [x, y]] of Object.entries(points)) out[i] = {x, y, z: 0, visibility: 0.99};
  return out;
}
const FRONT_LM = {0: [0.5, 0.1], 7: [0.53, 0.1], 8: [0.47, 0.1], 11: [0.6, 0.2], 12: [0.4, 0.2], 15: [0.62, 0.45], 16: [0.38, 0.45],
  23: [0.56, 0.45], 24: [0.44, 0.45], 25: [0.56, 0.7], 26: [0.44, 0.7], 27: [0.56, 0.9], 28: [0.44, 0.9]};
const SIDE_LM = {11: [0.51, 0.2], 12: [0.49, 0.2], 23: [0.51, 0.45], 24: [0.49, 0.45], 25: [0.52, 0.7], 26: [0.5, 0.7], 15: [0.5, 0.45]};
const rec = (source, id, variant, truth, points, extra = {}) => Object.assign({source, id, variant, truth,
  crop: {x: 0, y: 0, w: 1000, h: 2000, mirror: variant.endsWith('_mirror')}, full: {w: 1000, h: 2000}, w: 1000, h: 2000,
  lm: points && mlm(points), mask: null, ms: 40, gt: null}, extra);

test('evaluate on a synthetic cache: found, pose, confusion, alignment shift, left/right', () => {
  const gt = coco({5: [600, 400], 6: [400, 400], 11: [560, 900], 12: [440, 900], 13: [560, 1400], 14: [440, 1400]});
  const entries = [rec('own', 'a', 'full', 'front', FRONT_LM), rec('own', 'a', 'no_head', 'front', FRONT_LM),
    rec('own', 'b', 'full', 'side', SIDE_LM), rec('own', 'b', 'tight', 'side', null),
    rec('own', 'c', 'full', 'back', FRONT_LM),
    rec('coco', 'coco_1', 'full', 'front', FRONT_LM, {gt}), rec('coco', 'coco_2', 'full', null, FRONT_LM)];
  const s = B.evaluate(entries);
  assert.deepStrictEqual(['n', 'found', 'correct'].map(k => s.rows['own|full'][k]), [3, 3, 2]);
  assert.deepStrictEqual(s.rows['own|full'].confusion, {front: {front: 1}, side: {side: 1}, back: {front: 1}});
  assert.deepStrictEqual(['n', 'found', 'correct'].map(k => s.rows['own|tight'][k]), [1, 0, 0]);
  assert.strictEqual(s.align.no_head.n, 1);
  assert.ok(s.align.no_head.median < 0.01, J(s.align));
  assert.deepStrictEqual(s.lr, {n: 1, swapped: 0});
  assert.strictEqual(s.unclear, 1);
  assert.strictEqual(s.base, null);
});

test('baseline: pose and aligned points of full photos; later runs compare against it', () => {
  const entries = [rec('own', 'a', 'full', 'front', FRONT_LM), rec('own', 'c', 'full', 'back', FRONT_LM)];
  const base = B.baselineOf(entries);
  assert.deepStrictEqual(Object.keys(base.photos).sort(), ['a', 'c']);
  assert.strictEqual(base.photos.a.pose, 'front');
  assert.deepStrictEqual(B.evaluate(entries, {baseline: base}).base, {n: 2, poseChanged: [], maxShift: 0, consistency: base.consistency});
  base.photos.a.pose = 'side';
  assert.deepStrictEqual(B.evaluate(entries, {baseline: base}).base.poseChanged, ['a']);
});

test('report: tables and the bar with ✅/❌, no user coordinates', () => {
  const pts = Object.assign({}, FRONT_LM, {11: [0.61234, 0.2]});
  const s = B.evaluate([rec('own', 'a', 'full', 'front', pts), rec('own', 'a', 'no_head', 'front', pts)]);
  const r = B.report(s, {date: '2026-11-27', params: {model: 'full', side: 1024, minDetect: null}});
  assert.match(r, /# Проверка фото — 2026-11-27/);
  assert.match(r, /\| own \| full \| 1 \| 100 % \| 100 % \|/);
  assert.match(r, /✅ свои: поза верна во всех найденных/);
  assert.match(r, /❌|✅/);
  assert.doesNotMatch(r, /612|0\.612/);
});

test('consistency of full photos: a point left out of the fit lands at the same height on every photo of a pose', () => {
  // пять снимков позы — один человек в разном масштабе и сдвиге: идеальное выравнивание, разброс 0
  const entries = [0.9, 1.0, 1.1, 0.95, 1.05].map((k, i) => {
    const P = Object.fromEntries(Object.entries(FRONT_LM).map(([j, [x, y]]) => [j, [x, (y * k * 2000 + 50 * i) / 2400]]));
    return Object.assign(rec('own', `a${i}`, 'full', 'front', P), {h: 2400});
  });
  const c = B.consistency(entries);
  assert.ok(c.mean < 0.5, J(c));
  assert.deepStrictEqual(Object.keys(c.points).sort(), ['ankle', 'knees', 'neck', 'root']);   // глаз в наборе нет
});

test('retry like the app: a variant without a figure is taken from the padded run, if found there', () => {
  const a = [rec('own', 'a', 'no_head', 'front', null), rec('own', 'b', 'full', 'front', FRONT_LM), rec('own', 'c', 'tight', 'front', null)];
  const r = [rec('own', 'a', 'no_head', 'front', FRONT_LM, {ms: 70}), rec('own', 'b', 'full', 'front', SIDE_LM), rec('own', 'c', 'tight', 'front', null)];
  const m = B.mergeRetry(a, r);
  assert.deepStrictEqual(m.map(e => [e.id, !!e.lm]), [['a', true], ['b', true], ['c', false]]);
  assert.strictEqual(m[0].ms, 40 + 70);                  // время — обе попытки
  assert.strictEqual(m[1], a[1]);                        // нашли с первой попытки — повтора нет
});
