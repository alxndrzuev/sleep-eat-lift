// portal/photos_core.js — чистая логика страницы «Фото» (разбор имён, позы, медианы, выравнивание, данные страницы).
const test = require('node:test');
const assert = require('node:assert');
const {load, J} = require('./_portal');

const js = load('photos_core.js');

/** Как assertAlmostEqual в прежних тестах: до 7 знаков или с допуском delta. */
function near(a, b, {places = 7, delta} = {}) {
  const ok = delta != null ? Math.abs(a - b) <= delta : Math.abs(a - b) < 0.5 * 10 ** -places;
  assert.ok(ok, `${a} ≠ ${b}`);
}

// опорные точки снимка (пиксели, y вниз): силуэт макушка 100 — подошвы 4400 → 4300 px = FRAME.HS → масштаб 1
const KP = {w: 1000, h: 4600, head: [520, 300], neck: [520, 800], root: [520, 1800], ankle: [520, 4200],
  feet: [440, 600], crown: [520, 100], sole: [520, 4400], cx: 530};                 // ось тела вертикальна — без поворота
const NOSIL = Object.fromEntries(Object.entries(KP).filter(([k]) => !['crown', 'sole', 'cx'].includes(k)));
const MED = {rN: {front: 1.1}, rT: {front: 3.3}, offA: {front: 0.05}, offR: {front: 0.5},
  all: {rN: 1.12, rT: 3.4, offA: 0.04, offR: 0.5}};

/** Маска фигуры w×h (0/1) из прямоугольников [x0, y0, x1, y1], границы включительно. */
function mask(w, h, rects) {
  const m = Array(w * h).fill(0);
  for (const [x0, y0, x1, y1] of rects) for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) m[y * w + x] = 1;
  return m;
}

// фигура 100×200: голова, корпус, ноги, стопы; слева — поднятая рука с кулаком выше головы
const BODY = [[45, 10, 55, 30], [40, 30, 60, 110], [44, 110, 56, 175], [40, 175, 62, 180], [15, 2, 22, 8], [18, 8, 24, 40]];
const MKP = {head: [50, 20], neck: [50, 32], root: [50, 105], ankle: [50, 172], feet: [42, 60]};

// шаблон позы в кадре (y): макушка … подошвы = 4300 px; снимок = шаблон × k + o (k — пикселей снимка на пиксель кадра)
const TPL = {crown: 750, eyes: 1030, ears: 1060, neck: 1520, root: 2780, knees: 3830, ankle: 4870, heels: 4950, sole: 5050};

/** Опорные точки снимка из шаблона; drop — каких нет, shift — {точка: сдвиг по y в пикселях снимка}. */
function synth(k, o, {x = 2000, drop = [], shift = {}} = {}) {
  const y = Object.fromEntries(Object.entries(TPL).map(([n, v]) => [n, k * v + o + (shift[n] || 0)]));
  const pt = n => drop.includes(n) ? null : [x, y[n]];
  return {w: 4000, h: 7000, head: [x, k * 1045 + o], neck: pt('neck'), root: pt('root'), ankle: pt('ankle'),
    feet: [x - 100, x + 100], crown: pt('crown'), sole: pt('sole'), cx: x,
    pts: {eyes: pt('eyes'), ears: pt('ears'), knees: pt('knees'), heels: pt('heels')}};
}

/** Матрица canvas (a…f) к точке снимка → точка кадра. */
const apply = (t, p) => [t.a * p[0] + t.c * p[1] + t.e, t.b * p[0] + t.d * p[1] + t.f];

/** 33 точки MediaPipe (нормированные, все невидимые), кроме points: {индекс: [x, y] или [x, y, z]}. */
function lm(points, vis = 1.0) {
  const out = Array.from({length: 33}, () => ({x: 0, y: 0, visibility: 0.0}));
  for (const [i, [x, y, z]] of Object.entries(points)) out[i] = z === undefined ? {x, y, visibility: vis} : {x, y, z, visibility: vis};
  return J(out);
}

const item = (i, extra) => Object.assign({id: i, date: '2026-11-21', time: i, name: `IMG_${i}.HEIC`}, extra);
const plan = (items, existing = []) => js(`PhotosCore.planSeries(${J(items)}, ${J(existing)})`);

test('poses', () => {
  assert.deepStrictEqual(js('PhotosCore.POSES'), ['front', 'side', 'side_left', 'back', 'back_flex', 'front_flex']);
  assert.deepStrictEqual(js('[PhotosCore.POSE_NAMES.side, PhotosCore.POSE_NAMES.side_left]'), ['Сбоку справа', 'Сбоку слева']);
  assert.deepStrictEqual(js('PhotosCore.parseName("2026-07-12_side_left.jpg")'), {date: '2026-07-12', pose: 'side_left'});
});

test('already loaded: same file (SHA-256) or same shot (EXIF time, to the second)', () => {
  const photos = {'2026-07-12_front': {sha: 'aa', shot: 1000}, '2026-07-12_side': {sha: 'bb', shot: 5000},
    '2025-12-19_front': {}};                                                 // старый снимок без отпечатков — не сравнивается
  const items = [{id: 0, sha: 'aa', time: 1, fromExif: true}, {id: 1, sha: 'zz', time: 5000, fromExif: true},
    {id: 2, sha: 'zz', time: 5000, fromExif: false}, {id: 3, sha: 'cc', time: 9000, fromExif: true}];
  assert.deepStrictEqual(js(`PhotosCore.findAlready(${J(items)}, ${J(photos)})`), {0: '2026-07-12_front', 1: '2026-07-12_side'});
});

test('parse file name', () => {
  assert.deepStrictEqual(js('PhotosCore.parseName("2026-07-12_back_flex.jpg")'), {date: '2026-07-12', pose: 'back_flex'});
  assert.deepStrictEqual(js('PhotosCore.parseName("2026-07-12_front.HEIC")'), {date: '2026-07-12', pose: 'front'});
  assert.strictEqual(js('PhotosCore.parseName("2026-07-12_pose1.jpg")'), null);
  assert.strictEqual(js('PhotosCore.parseName("IMG_0001.HEIC")'), null);
});

test('EXIF date, or file time', () => {
  assert.deepStrictEqual(js('PhotosCore.exifDate(new Date(2026, 6, 12, 10, 58, 8), 0)'),
    {date: '2026-07-12', time: js('new Date(2026, 6, 12, 10, 58, 8).getTime()'), fromExif: true});
  const r = js('PhotosCore.exifDate(null, new Date(2026, 10, 1, 9, 0).getTime())');
  assert.deepStrictEqual([r.date, r.fromExif], ['2026-11-01', false]);
});

test('five shots: poses by time', () => {
  const items = [50, 10, 40, 20, 30].map((t, i) => item(i, {time: t}));
  const s = plan(items);
  assert.strictEqual(s.length, 1);
  assert.deepStrictEqual(s[0].rows.map(r => [r.id, r.pose]), [[1, 'front'], [3, 'side'], [4, 'back'], [2, 'back_flex'], [0, 'front_flex']]);
});

test('not five shots: poses not guessed', () => {
  assert.deepStrictEqual([...new Set(plan([0, 1, 2, 3].map(i => item(i)))[0].rows.map(r => r.pose))], [null]);
});

test('six shots: one pose twice — duplicates, last kept, first «skip»', () => {
  const g = ['front', 'front', 'side', 'back', 'back_flex', 'front_flex'];
  const rows = plan(g.map((p, i) => item(i, {time: 10 * i, guess: p})))[0].rows;
  assert.deepStrictEqual(rows[0], {id: 0, pose: 'skip', exists: false, dup: 'front'});
  assert.deepStrictEqual(rows[1], {id: 1, pose: 'front', exists: false, dup: 'front'});
  assert.deepStrictEqual(rows.slice(2).map(r => [r.pose, 'dup' in r]),
    [['side', false], ['back', false], ['back_flex', false], ['front_flex', false]]);
});

test('already loaded shot — «skip» with a mark, not a duplicate', () => {
  const items = ['front', 'front', 'side'].map((p, i) => item(i, {guess: p}));
  items[0].already = '2026-11-21_front';
  const rows = plan(items)[0].rows;
  assert.deepStrictEqual(rows[0], {id: 0, pose: 'skip', exists: false, already: '2026-11-21_front'});
  assert.deepStrictEqual(rows[1], {id: 1, pose: 'front', exists: false});
});

test('duplicate group', () => {
  const rows = [{id: 0, pose: 'skip', dup: 'front'}, {id: 1, pose: 'side'}, {id: 2, pose: 'front', dup: 'front'}];
  assert.deepStrictEqual(js(`PhotosCore.dupGroup(${J(rows)}, 0)`), [0, 2]);
  assert.deepStrictEqual(js(`PhotosCore.dupGroup(${J(rows)}, 2)`), [0, 2]);
  assert.deepStrictEqual(js(`PhotosCore.dupGroup(${J(rows)}, 1)`), [1]);
});

test('«keep this one»: chosen duplicate gets the pose, others «skip», replace reset', () => {
  const rows = [{id: 0, pose: 'skip', dup: 'front'}, {id: 1, pose: 'side'}, {id: 2, pose: 'front', dup: 'front', replace: true}];
  assert.deepStrictEqual(js(`PhotosCore.keepDup(${J(rows)}, 0)`).map(x => [x.pose, x.replace || false]),
    [['front', false], ['side', false], ['skip', false]]);
});

test('three duplicates', () => {
  const rows = plan([0, 1, 2].map(i => item(i, {guess: 'side'})))[0].rows;
  assert.deepStrictEqual(rows.map(r => r.pose), ['skip', 'skip', 'side']);
  assert.deepStrictEqual([...new Set(rows.map(r => r.dup))], ['side']);
});

test('five shots out of order — poses by landmarks, not by time', () => {
  const g = ['side', 'front', 'back', 'front_flex', 'back_flex'];
  assert.deepStrictEqual(plan(g.map((p, i) => item(i, {guess: p})))[0].rows.map(r => r.pose), g);
});

test('pose from file name, existing photos', () => {
  const items = [{id: 0, date: '2026-07-12', time: 0, name: '2026-07-12_side.jpg'}, {id: 1, date: '2026-11-21', time: 0, name: 'IMG_1.HEIC'}];
  const s = plan(items, ['2026-07-12_side']);
  assert.deepStrictEqual(s.map(x => x.date), ['2026-07-12', '2026-11-21']);
  assert.deepStrictEqual(s[0].rows, [{id: 0, pose: 'side', exists: true}]);
  assert.deepStrictEqual(s[1].rows, [{id: 1, pose: null, exists: false}]);
});

test('validate plan', () => {
  const v = p => js(`PhotosCore.validatePlan(${J(p)})`).join(' ');
  assert.deepStrictEqual(js(`PhotosCore.validatePlan(${J([{date: '2026-11-21', rows: [{id: 0, pose: 'front'}, {id: 1, pose: 'skip'}, {id: 2, pose: 'skip'}]}])})`), []);
  assert.match(v([{date: '2026-11-21', rows: [{id: 0, pose: 'front'}, {id: 1, pose: 'front'}]}]), /дважды/);
  assert.match(v([{date: '2026-11-21', rows: [{id: 0, pose: null}]}]), /не выбрана/);
  assert.match(v([{date: '2026-11-21', rows: [{id: 0, pose: 'front'}]},              // дату второй серии поменяли на ту же
                  {date: '2026-11-21', rows: [{id: 1, pose: 'front'}]}]), /дважды/);
  assert.match(v([{date: '', rows: [{id: 0, pose: 'front'}]}]), /дата/);
});

test('project path from the page address', () => {
  assert.strictEqual(js('PhotosCore.projectPath("/Users/u/Documents/claude/sleep-eat-lift/portal/photos.html")'), '/Users/u/Documents/claude/sleep-eat-lift');
  assert.strictEqual(js('PhotosCore.projectPath("/Users/a/My%20Docs/%D0%B7%D0%B4%D0%BE%D1%80%D0%BE%D0%B2%D1%8C%D0%B5/portal/photos.html")'),
    '/Users/a/My Docs/здоровье');
  assert.strictEqual(js('PhotosCore.projectPath("/x/photos.html")'), null);
});

test('chosen folder → where to write photos', () => {
  const r = (name, kids) => js(`PhotosCore.resolveFolder(${J(name)}, ${J(kids)})`);
  assert.deepStrictEqual(r('sleep-eat-lift', ['portal', 'data', 'scripts']), {path: ['data', 'photos'], warn: null});   // папка проекта
  assert.deepStrictEqual(r('мой-проект', ['data', 'portal']), {path: ['data', 'photos'], warn: null});         // как бы ни называлась
  assert.deepStrictEqual(r('data', ['body.csv', 'photos_2']), {path: ['photos'], warn: null});
  assert.deepStrictEqual(r('photos', ['originals']), {path: [], warn: null});
  const bad = r('Downloads', ['a.jpg']);
  assert.strictEqual(bad.path, null);
  assert.match(bad.warn, /sleep-eat-lift/);
});

const kp = pts => js(`PhotosCore.keypointsFromLandmarks(${lm(pts)}, 1000, 2000)`);

test('keypoints from landmarks', () => {
  const pts = {0: [0.5, 0.1], 11: [0.4, 0.2], 12: [0.6, 0.2], 23: [0.45, 0.5], 24: [0.55, 0.5], 27: [0.45, 0.9], 28: [0.55, 0.9],
    2: [0.48, 0.09], 5: [0.52, 0.09], 25: [0.45, 0.7], 26: [0.55, 0.7], 29: [0.45, 0.92], 30: [0.55, 0.92]};
  assert.deepStrictEqual(kp(pts), {w: 1000, h: 2000, head: [500, 200], neck: [500, 400], root: [500, 1000], ankle: [500, 1800],
    feet: [450, 550], pts: {eyes: [500, 180], ears: null, knees: [500, 1400], heels: [500, 1840]},
    look: {sw: -0.33, hw: -0.17, zs: null, up: null, el: null, dir: null}});
});

test('pose features: sw — shoulders by x / torso, up — hands above shoulders / torso, dir — facing', () => {
  const pts = {11: [0.6, 0.2], 12: [0.4, 0.2], 23: [0.45, 0.5], 24: [0.55, 0.5], 15: [0.62, 0.05], 16: [0.38, 0.05]};
  assert.deepStrictEqual(kp(pts).look, {sw: 0.33, hw: -0.17, zs: null, up: 0.5, el: null, dir: null});
  // куда смотрит: (нос − уши) + (носки − пятки) по x / корпус; > 0 — вправо на снимке (правым боком к камере)
  Object.assign(pts, {0: [0.56, 0.1], 7: [0.5, 0.11], 8: [0.5, 0.11], 29: [0.45, 0.95], 30: [0.45, 0.95], 31: [0.6, 0.96], 32: [0.6, 0.96]});
  assert.strictEqual(kp(pts).look.dir, 0.35);
});

test('pose features: hw — hips by x / torso, zs — depth left minus right (shoulders and hips), el — elbows above shoulders / torso', () => {
  const pts = {11: [0.6, 0.2, -0.3], 12: [0.4, 0.2, 0.3], 23: [0.55, 0.5, -0.1], 24: [0.45, 0.5, 0.1], 13: [0.62, 0.22], 14: [0.38, 0.24]};
  const L = kp(pts).look;
  assert.deepStrictEqual([L.hw, L.zs, L.el], [0.17, -0.4, -0.1]);
});

test('points outside the frame are ignored: MediaPipe guesses them with high visibility (off by 100–200 px on cut photos)', () => {
  const k = kp({0: [0.5, -0.3], 11: [0.6, 0.2], 12: [0.4, 0.2], 23: [0.55, 0.5], 24: [0.45, 0.5], 15: [0.62, -0.25], 27: [0.45, 1.01], 28: [0.55, 0.99]});
  assert.deepStrictEqual([k.head, k.look.up, k.ankle], [null, null, [550, 1980]]);
});

test('side with arms raised forward, no head and no feet → side (by depth), mirrored → side_left', () => {
  const pts = {11: [0.51, 0.2, 0.3], 12: [0.49, 0.2, -0.3], 23: [0.51, 0.5, 0.15], 24: [0.49, 0.5, -0.15],
    13: [0.65, 0.21], 14: [0.64, 0.21], 15: [0.78, 0.22], 16: [0.77, 0.22], 25: [0.52, 0.75], 26: [0.5, 0.75]};
  assert.strictEqual(js(`PhotosCore.guessPose(PhotosCore.keypointsFromLandmarks(${lm(pts)}, 1000, 2000))`), 'side');
  // зеркало: x отражён, глубина та же, левое и правое меняются местами (так их и называет MediaPipe на отражённом снимке)
  const swap = {11: 12, 12: 11, 13: 14, 14: 13, 15: 16, 16: 15, 23: 24, 24: 23, 25: 26, 26: 25};
  const m = Object.fromEntries(Object.entries(pts).map(([i, [x, y, z]]) => [swap[i], [1 - x, y, z]]));
  assert.strictEqual(js(`PhotosCore.guessPose(PhotosCore.keypointsFromLandmarks(${lm(m)}, 1000, 2000))`), 'side_left');
});

test('guess pose: depth decides the side, arms do not matter sideways, wide hips are not side, elbows when wrists are cut', () => {
  for (const [look, pose] of [
    [{sw: 0.05, hw: 0.02, up: -0.05, zs: 0.5, dir: null}, 'side'], [{sw: 0.05, hw: 0.02, up: 0.4, zs: -0.5, dir: null}, 'side_left'],
    [{sw: 0.05, hw: 0.02, zs: 0.4, dir: -0.2}, 'side'], [{sw: 0.05, hw: 0.02, zs: 0.05, dir: -0.3}, 'side_left'],
    [{sw: 0.3, hw: 0.3, up: -1}, 'front'],
    [{sw: 0.6, hw: 0.3, up: null, el: 0.05}, 'front_flex'], [{sw: -0.6, hw: -0.3, up: null, el: -0.6}, 'back'],
    [{sw: 0.6, hw: 0.3, up: -0.2}, 'front'], [{sw: 0.6, hw: 0.3, up: 0.05}, 'front_flex']])   // кисти у груди — не «Бицепс»
    assert.strictEqual(js(`PhotosCore.guessPose(${J({look})})`), pose, J(look));
});

test('guess pose (thresholds from 65 photos)', () => {
  for (const [look, pose] of [[{sw: 0.65, up: -1.0}, 'front'], [{sw: 0.6, up: 0.42}, 'front_flex'],
    [{sw: -0.67, up: -0.98}, 'back'], [{sw: -0.65, up: 0.4}, 'back_flex'],
    [{sw: 0.1, up: -1.0, dir: 0.48}, 'side'], [{sw: -0.05, up: 0.4}, 'side'],
    [{sw: 0.08, up: -1.0, dir: -0.5}, 'side_left'], [{sw: 0.6, up: null}, 'front']])
    assert.strictEqual(js(`PhotosCore.guessPose(${J({look})})`), pose, J(look));
  assert.strictEqual(js('PhotosCore.guessPose(null)'), null);
  assert.strictEqual(js('PhotosCore.guessPose({"neck": [1, 1]})'), null);
});

test('feet from heels and toes', () => {
  assert.deepStrictEqual(kp({11: [0.4, 0.2], 12: [0.6, 0.2], 23: [0.45, 0.5], 24: [0.55, 0.5], 27: [0.45, 0.9], 29: [0.43, 0.92], 32: [0.6, 0.93]}).feet, [430, 600]);
});

test('no hips — no keypoints', () => {
  assert.strictEqual(kp({0: [0.5, 0.1], 11: [0.4, 0.2], 12: [0.6, 0.2]}), null);
});

test('head from ear; no ankle — no feet', () => {
  const pts = {7: [0.5, 0.12], 11: [0.4, 0.2], 12: [0.6, 0.2], 23: [0.45, 0.5], 24: [0.55, 0.5], 27: [0.45, 0.9]};
  let k = kp(pts);
  assert.deepStrictEqual([k.head, k.ankle], [[500, 240], [450, 1800]]);
  delete pts[27];
  k = kp(pts);
  assert.deepStrictEqual([k.ankle, k.feet], [null, null]);
});

const sil = (rects, k = MKP) => js(`PhotosCore.silhouette(${J(mask(100, 200, rects))}, 100, 200, ${J(k)})`);

test('silhouette: crown is the top of the head, not a raised fist; sole — bottom of feet; centre — torso without the arm', () => {
  const r = sil(BODY);
  assert.deepStrictEqual([r.crown[1], r.sole[1], r.cx], [10, 180, 50]);
});

test('silhouette: feet cut by the frame', () => {
  const r = sil([...BODY.slice(0, 2), [44, 110, 56, 199]]);
  assert.strictEqual(r.sole, null);
  assert.strictEqual(r.crown[1], 10);
});

test('silhouette: head touches the top edge', () => {
  const r = sil([[45, 0, 55, 30], ...BODY.slice(1)]);
  assert.strictEqual(r.crown, null);
  assert.strictEqual(r.sole[1], 180);
});

test('silhouette: head or feet cut by the frame with a blurred mask edge — no crown, no sole', () => {
  const r = sil([[45, 2, 55, 30], BODY[1], [44, 110, 56, 197]]);
  assert.deepStrictEqual([r.crown, r.sole], [null, null]);
});

test('silhouette: arms raised forward at shoulder height do not move the torso centre', () => {
  const r = sil([...BODY.slice(0, 4), [60, 32, 95, 40]]);
  assert.ok(Math.abs(r.cx - 50) <= 2, String(r.cx));
});

test('silhouette: empty mask', () => {
  assert.deepStrictEqual(sil([]), {crown: null, sole: null, cx: null});
});

test('detect size: long side ≤ side, width a multiple of 4 (MediaPipe falls on odd mask rows)', () => {
  assert.deepStrictEqual(js('PhotosCore.detectSize(4284, 5712, 1024)'), {w: 768, h: 1024});
  assert.deepStrictEqual(js('PhotosCore.detectSize(4284, 5662, 1024)'), {w: 776, h: 1024});   // 774.8 → не 775
  assert.deepStrictEqual(js('PhotosCore.detectSize(5712, 4284, 1024)'), {w: 1024, h: 768});
  assert.deepStrictEqual(js('PhotosCore.detectSize(601, 403, 1024)'), {w: 604, h: 403});     // меньше side — без уменьшения
});

test('detection settings shared by the app and the check', () => {
  assert.deepStrictEqual(js('PhotosCore.DETECT'), {side: 1024, minDetect: 0.3, retryPad: 0.25});
});

test('detection on a padded copy → back to the photo: points and mask rows of the photo only', () => {
  // поле сверху и снизу — по четверти высоты снимка: копия 1.5 высоты, снимок — с 1/6 до 5/6
  const det = {lm: [{x: 0.3, y: 0.5, z: 0.1, visibility: 0.9}, {x: 0.3, y: 1 / 6, visibility: 0.8}],
    mask: {w: 2, h: 15, data: Array.from({length: 30}, (_, i) => Math.floor(i / 2))}};
  const r = js(`PhotosCore.unpadDetection(${J(det)}, 0.25)`);
  near(r.lm[0].y, 0.5); near(r.lm[1].y, 0); assert.deepStrictEqual([r.lm[0].x, r.lm[0].z, r.lm[0].visibility], [0.3, 0.1, 0.9]);
  assert.deepStrictEqual([r.mask.w, r.mask.h], [2, 10]);
  assert.deepStrictEqual([r.mask.data[0], r.mask.data[19]], [3, 12]);    // строки 3…12 маски копии
  assert.deepStrictEqual(js(`PhotosCore.unpadDetection({lm: null, mask: null}, 0.25)`), {lm: null, mask: null});
});

// результат MediaPipe как есть: 33 точки (нормированные) + маска в размере уменьшенной копии (здесь — вдвое меньше снимка)
const DET_LM = {0: [0.5, 0.1], 11: [0.4, 0.16], 12: [0.6, 0.16], 23: [0.45, 0.525], 24: [0.55, 0.525], 27: [0.45, 0.86], 28: [0.55, 0.86],
  29: [0.42, 0.88], 32: [0.6, 0.89]};
const fig = (det, w = 200, h = 400) => js(`PhotosCore.figureFromDetection(${det}, ${w}, ${h})`);

test('figure from detection: same as landmarks + silhouette, mask scaled to the photo', () => {
  const r = fig(`{lm: ${lm(DET_LM)}, mask: {w: 100, h: 200, data: ${J(mask(100, 200, BODY))}}}`);
  assert.deepStrictEqual(r.neck, [100, 64]);
  assert.deepStrictEqual([r.crown[1], r.sole[1], r.cx], [21, 361, 101]);   // (y маски + 0.5) · 2; кулак выше головы не в счёт
  const noMask = fig(`{lm: ${lm(DET_LM)}, mask: null}`);
  assert.deepStrictEqual(noMask, js(`PhotosCore.keypointsFromLandmarks(${lm(DET_LM)}, 200, 400)`));
  assert.strictEqual(fig('{lm: null, mask: null}'), null);
});

const align = (k, pose = 'front') => js(`PhotosCore.alignTransform(${J(k)}, "${pose}", ${J(MED)})`);

test('align by silhouette', () => {
  const t = align(KP);                                   // 4300 px → s = 1; подошвы на 5470 − 420, центр корпуса — в центр
  near(t.s, 1.0);
  assert.deepStrictEqual(apply(t, [530, 4400]), [1665, 5050]);
  assert.strictEqual(apply(t, KP.crown)[1], 750);
  assert.deepStrictEqual([t.by, t.feet_cut, t.th], ['силуэт', false, 0]);
});

test('align fallback: nose to ankles', () => {
  const t = align(NOSIL);                                // рост 3900 × 1.1 = 4290; подошвы = 4200 + 0.05 × 4290
  near(t.s, 4300 / 4290);
  near(apply(t, [520, 4200 + 0.05 * 4290])[0], 1665);    // без силуэта — центр по тазу
  near(apply(t, [520, 4200 + 0.05 * 4290])[1], 5050);
  assert.deepStrictEqual([t.by, t.feet_cut], ['рост', true]);
  near(align(NOSIL, 'side').s, 4300 / (3900 * 1.12));    // нет позы в медианах — общие
});

test('align: soles found, crown not', () => {
  const t = align({...NOSIL, sole: [520, 4400]});        // масштаб по росту, а пол — по найденным подошвам
  near(apply(t, [520, 4400])[1], 5050);
  assert.strictEqual(t.feet_cut, false);
});

const MED_K = Object.assign({}, MED, {rK: {front: 2}, offK: {front: 0.25}, all: Object.assign({}, MED.all, {rK: 1.93, offK: 0.27})});

test('align fallback: shoulders–knees (no head, no feet)', () => {
  const k = {w: 1000, h: 3000, head: null, neck: [520, 800], root: [520, 1800], ankle: null, feet: null, pts: {knees: [520, 2800]}};
  const t = js(`PhotosCore.alignTransform(${J(k)}, "front", ${J(MED_K)})`);
  assert.strictEqual(t.by, 'колени');
  near(t.s, 4300 / 4000);                                  // силуэт = (колени − плечи) · rK = 2000 · 2
  near(apply(t, [520, 3800])[1], 5470 - 420, {delta: 1e-6});   // пол = колени + offK · силуэт
});

test('tilt by knees when there are no ankles', () => {
  const k = {neck: [520, 800], root: [500, 1800], ankle: null, pts: {knees: [470, 3000], heels: null}};
  near(js(`PhotosCore.bodyAngle(${J(k)})`), Math.atan((520 - 470) / (800 - 3000)));
});

test('pose with only cut photos (no head, no feet): fitted by points, one scale for all', () => {
  const ks = [0.9, 1.0, 1.1, 0.95, 1.05];
  const entries = ks.map((k, i) => ({name: `p${i}`, pose: 'front',
    kp: Object.assign(synth(k, 100 * i, {drop: ['crown', 'sole', 'ankle', 'heels', 'eyes', 'ears']}), {head: null, feet: null})}));
  const res = js(`PhotosCore.alignAll(${J(entries)})`);
  const sk = ks.map((k, i) => res[`p${i}`].s * k);
  for (let i = 0; i < ks.length; i++) {
    assert.strictEqual(res[`p${i}`].by, 'точки');
    near(sk[i], sk[0], {delta: 0.01 * sk[0]});
  }
});

test('align fallback: torso', () => {
  const k = {...NOSIL, head: null};                      // корпус 1000 × 3.3 = 3300
  const t = align(k);
  near(t.s, 4300 / 3300);
  assert.strictEqual(t.by, 'корпус');
  near(apply(t, [520, 4200 + 0.05 * 3300])[1], 5050);
  k.ankle = null;                                        // подошвы = таз + 0.5 × 3300
  near(apply(align(k), [520, 1800 + 0.5 * 3300])[1], 5050);
});

test('align straightens tilt: neck right above ankles, no distortion', () => {
  const k = {...KP, neck: [620, 800]};                   // наклон 100 px на 3400 px ≈ 1.7°
  const t = align(k);
  near(t.th, -Math.atan(100 / 3400));
  const n = apply(t, k.neck), a = apply(t, k.ankle);
  near(n[0], a[0], {places: 6});
  near(Math.hypot(n[0] - a[0], n[1] - a[1]), Math.hypot(100, 3400) * t.s, {places: 6});
});

test('align tilt capped at 5°', () => {
  near(align({...KP, neck: [1520, 800]}).th, -5 * Math.PI / 180);   // ~16° — скорее ошибка точек
});

test('5+ photos of a pose: scale by many points — hair, hip outlier and cut feet do not throw it off', () => {
  const e = [synth(1.0, 0), synth(0.9, 300), synth(1.1, -200, {shift: {crown: -60}}),    // p2: волосы выше на 60 px
    synth(0.95, 100), synth(1.05, 50, {shift: {root: 150}}), synth(0.85, 400, {drop: ['crown', 'sole']}),
    synth(1.0, 30, {x: 2100})].map((k, i) => ({name: `p${i}`, pose: 'front', kp: k}));
  const r = js(`PhotosCore.alignAll(${J(e)})`);
  for (const x of e) {
    const t = r[x.name], k = x.kp;
    assert.strictEqual(t.by, 'точки', x.name);
    for (const [n, want] of [['eyes', 1030], ['knees', 3830], ['heels', 4950]]) near(apply(t, k.pts[n])[1], want, {delta: 6});
    near(apply(t, [k.cx, k.neck[1]])[0], 1665, {delta: 1});
  }
  assert.strictEqual(r.p5.feet_cut, true);
  assert.strictEqual(r.p0.feet_cut, false);
});

test('few photos — by silhouette; without keypoints — skipped', () => {
  const e = [{name: 'a', pose: 'side', kp: KP}, {name: 'b', pose: 'side', kp: KP}, {name: 'c', pose: 'front', kp: null}];
  const r = js(`PhotosCore.alignAll(${J(e)})`);
  assert.deepStrictEqual([r.a.by, r.b.by], ['силуэт', 'силуэт']);
  assert.ok(!('c' in r));
});

test('pose medians', () => {
  assert.deepStrictEqual(js('PhotosCore.poseMedians([])'),
    {rN: {}, rT: {}, offA: {}, offR: {}, rK: {}, offK: {}, all: {rN: 1.12, rT: 3.4, offA: 0.04, offR: 0.5, rK: 1.93, offK: 0.27}});
  const kn = Object.assign({}, KP, {pts: {knees: [520, 3000]}});     // колени: силуэт / «плечи–колени» = 4300 / 2200
  const m = js(`PhotosCore.poseMedians(${J([{pose: 'front', kp: kn}, {pose: 'front', kp: NOSIL}])})`);   // без силуэта — не в счёт
  near(m.rK.front, 4300 / 2200);
  near(m.offK.front, 1400 / 4300);
  near(m.rN.front, 4300 / 3900);
  near(m.rT.front, 4.3);
  near(m.offA.front, 200 / 4300);
  near(m.offR.front, 2600 / 4300);
  near(m.all.rT, 4.3);
});

test('nearest weight within 14 days', () => {
  const w = J([['2026-07-01', 72], ['2026-07-20', 73]]);
  assert.strictEqual(js(`PhotosCore.nearestWeight(${w}, "2026-07-12")`), 73);
  assert.strictEqual(js(`PhotosCore.nearestWeight(${w}, "2026-08-03")`), 73);       // ровно 14 дней
  assert.strictEqual(js(`PhotosCore.nearestWeight(${w}, "2026-08-04")`), null);
});

test('page view: paths, sessions, buttons only for poses that exist', () => {
  const idx = {photos: {'2026-07-12_front': {date: '2026-07-12', pose: 'front', kp: KP, feet_cut: true, v: 3},
    '2026-07-12_side': {date: '2026-07-12', pose: 'side', kp: null, feet_cut: false, v: 3}}};
  const data = {weight: [['2026-07-13', 73]]};
  const v = js(`PhotosCore.buildView(${J(idx)}, ${J(data)}, "../photos/")`);
  assert.deepStrictEqual(v.aligned, {'2026-07-12_front': '../photos/aligned/2026-07-12_front.jpg?v=3'});
  assert.strictEqual(v.img['2026-07-12_side'], '../photos/view/2026-07-12_side.jpg?v=3');
  assert.strictEqual(v.thumb['2026-07-12_side'], '../photos/thumbs/2026-07-12_side.jpg?v=3');
  assert.deepStrictEqual(v.sessions, [{date: '2026-07-12', weight: 73}]);           // заметок и вывода по фото больше нет
  assert.deepStrictEqual(v.feet_cut, ['2026-07-12']);
  assert.ok(!('summary' in v));
  assert.deepStrictEqual(js('PhotosCore.buildView({photos: {}}, {}, "x/").sessions'), []);
  assert.deepStrictEqual(v.poses, ['front', 'side']);
});

test('exactWeight — weight on that very date, not the nearest', () => {
  assert.strictEqual(js(`PhotosCore.exactWeight([['2026-11-01', 80], ['2026-11-03', 81]], '2026-11-01')`), 80);
  assert.strictEqual(js(`PhotosCore.exactWeight([['2026-11-01', 80]], '2026-11-02')`), null);
  assert.strictEqual(js(`PhotosCore.exactWeight(undefined, '2026-11-02')`), null);
});

test('parseKg on the page — same rules as the app (settings.parseKg)', () => {
  const settings = require('../settings');
  for (const v of ['80,1', ' 80.1 ', '75']) assert.strictEqual(js(`PhotosCore.parseKg(${J(v)})`), settings.parseKg(v));
  for (const bad of ['abc', '0', '500', '80,1,2']) {
    assert.throws(() => js(`PhotosCore.parseKg(${J(bad)})`), /Вес: число от 20 до 300/);
    assert.throws(() => settings.parseKg(bad));
  }
});

test('validatePlan: a wrong weight of a series is an error; empty — fine', () => {
  const rows = [{id: 0, pose: 'front'}];
  assert.deepStrictEqual(js(`PhotosCore.validatePlan([{date: '2026-11-01', weight: '', rows: ${J(rows)}}])`), []);
  assert.deepStrictEqual(js(`PhotosCore.validatePlan([{date: '2026-11-01', weight: '80,5', rows: ${J(rows)}}])`), []);
  assert.deepStrictEqual(js(`PhotosCore.validatePlan([{date: '2026-11-01', weight: 'abc', rows: ${J(rows)}}])`),
    ['2026-11-01: Вес: число от 20 до 300']);
});

test('drop zone: files dragged in from outside — overlay and upload; a photo dragged on the page itself — neither', () => {
  const run = steps => js(`(() => { const t = PhotosCore.dropTracker(); return ${J(steps)}.map(([m, a]) => t[m](a)); })()`);
  const F = ['Files'], IMG = ['text/uri-list', 'text/html', 'Files'];   // Chrome: картинку со страницы тоже помечает «Files»
  // снаружи: вход — показать, вложенный элемент — всё ещё показывать, выход из обоих — спрятать
  assert.deepStrictEqual(run([['enter', F], ['enter', F], ['leave', F], ['leave', F]]), [true, true, true, false]);
  assert.deepStrictEqual(run([['enter', F], ['drop', F]]), [true, true]);           // бросили — принять
  // снимок со страницы: dragstart → ни подсветки, ни загрузки; после dragend снаружи — снова как обычно
  assert.deepStrictEqual(run([['start'], ['enter', IMG], ['drop', IMG], ['end'], ['enter', F]]), [null, false, false, null, true]);   // start/end ничего не возвращают (null — после JSON)
  assert.deepStrictEqual(run([['enter', ['text/plain']]]), [false]);              // не файлы — не наше
});
