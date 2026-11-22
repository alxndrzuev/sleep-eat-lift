// portal/photos_fs.js (страница) поверх window.health.photos (приложение → photosfs.js): тот же интерфейс,
// что FileSystemDirectoryHandle, которым пользуется photos_app.js.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const pfs = require('../photosfs');

function page() {
  const root = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'health-pfs-')), 'photos');
  fs.mkdirSync(root);
  const call = f => async (...a) => { try { return f(root, ...a); } catch (e) { throw Object.assign(new Error(e.message), {code: e.code}); } };
  const health = {photos: {list: call(pfs.list), read: call(pfs.read), write: call(pfs.write), mkdir: call(pfs.mkdir),
                           remove: call(pfs.remove), exists: call(pfs.exists)}};
  const ctx = vm.createContext({window: {health}, File, Blob, TextEncoder, Uint8Array, ArrayBuffer, DOMException, console});
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../../portal/photos_fs.js'), 'utf8'), ctx);
  return {root, dir: ctx.window.PhotosFs.root()};
}

test('write via createWritable, read via getFile, entries, removeEntry', async () => {
  const {root, dir} = page();
  assert.strictEqual(await dir.queryPermission({mode: 'readwrite'}), 'granted');
  const sub = await dir.getDirectoryHandle('aligned', {create: true});
  const fh = await sub.getFileHandle('a.jpg', {create: true});
  const w = await fh.createWritable();
  await w.write(new Blob([new Uint8Array([7, 8])])); await w.write('9'); await w.close();
  assert.deepStrictEqual([...fs.readFileSync(path.join(root, 'aligned', 'a.jpg'))], [7, 8, 57]);
  const f = await (await (await dir.getDirectoryHandle('aligned')).getFileHandle('a.jpg')).getFile();
  assert.strictEqual(f.name, 'a.jpg');
  assert.deepStrictEqual([...new Uint8Array(await f.arrayBuffer())], [7, 8, 57]);
  const names = [];
  for await (const [n, h] of dir.entries()) names.push([n, h.kind]);
  assert.deepStrictEqual(names, [['aligned', 'directory']]);
  await sub.removeEntry('a.jpg');
  assert.deepStrictEqual(fs.readdirSync(path.join(root, 'aligned')), []);
});

test('missing file or folder without create → NotFoundError', async () => {
  const {dir} = page();
  await assert.rejects(dir.getFileHandle('photos.js'), e => e.name === 'NotFoundError');
  await assert.rejects(dir.getDirectoryHandle('originals'), e => e.name === 'NotFoundError');
});
