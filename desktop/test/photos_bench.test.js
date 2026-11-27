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
