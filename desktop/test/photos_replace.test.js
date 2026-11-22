// «Фото»: замена снимка, который уже есть, — если новый не удалось разобрать (HEIC, библиотеки, поиск фигуры, нет места),
// прежний оригинал и запись в индексе остаются. Страница (photos_app.js) — в Node поверх настоящего photosfs.js;
// библиотеки не загружаются (как при сбое), поэтому разбор нового снимка падает.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const pfs = require('../photosfs');
const {source} = require('./_portal');

function page() {
  const root = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'health-photo-')), 'photos');
  fs.mkdirSync(root);
  const call = f => async (...a) => { try { return f(root, ...a); } catch (e) { throw Object.assign(new Error(e.message), {code: e.code}); } };
  const health = {photos: {list: call(pfs.list), read: call(pfs.read), write: call(pfs.write), mkdir: call(pfs.mkdir),
                           remove: call(pfs.remove), exists: call(pfs.exists)}};
  const document = {currentScript: null, createElement: () => ({}), head: {appendChild: s => setTimeout(() => s.onerror())}};
  const ctx = vm.createContext({health, document, File, Blob, TextEncoder, Uint8Array, ArrayBuffer, DOMException, crypto, console, setTimeout,
                                createImageBitmap: async () => { throw new Error('не удалось разобрать снимок'); }});
  ctx.window = ctx;
  for (const f of ['photos_core.js', 'photos_fs.js', 'photos_app.js']) vm.runInContext(source(f), ctx, {filename: f});
  return {root, dir: ctx.PhotosFs.root(), app: ctx.PhotosApp};
}

const OLD = {date: '2026-11-01', pose: 'front', original: 'originals/2026-11-01_front.jpg', kp: null, by: null, feet_cut: false, v: 1, sha: 'x', shot: null};

for (const [what, name, type] of [['другой формат (HEIC вместо JPG)', 'IMG_1.heic', 'image/heic'], ['тот же формат', 'IMG_1.jpg', 'image/jpeg']])
  test(`замена не удалась — прежний оригинал и индекс на месте: ${what}`, async () => {
    const {root, dir, app} = page();
    fs.mkdirSync(path.join(root, 'originals'));
    fs.writeFileSync(path.join(root, 'originals', '2026-11-01_front.jpg'), 'OLD');
    await app.writeIndex(dir, {version: 1, photos: {'2026-11-01_front': OLD}});
    const res = await app.saveSeries(dir, [{file: new File(['NEW'], name, {type}), date: '2026-11-01', pose: 'front'}]);
    assert.strictEqual(res.saved, 0);
    assert.strictEqual(res.failed.length, 1);
    assert.deepStrictEqual(fs.readdirSync(path.join(root, 'originals')), ['2026-11-01_front.jpg']);
    assert.strictEqual(fs.readFileSync(path.join(root, 'originals', '2026-11-01_front.jpg'), 'utf8'), 'OLD');
    assert.deepStrictEqual(JSON.parse(JSON.stringify((await app.readIndex(dir)).photos['2026-11-01_front'])), OLD);
  });
