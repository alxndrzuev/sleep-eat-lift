// Файлы фото для страницы «Фото» в приложении: только внутри data/photos.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const pfs = require('../photosfs');

function tmp() {
  const root = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'health-ph-')), 'photos');
  fs.mkdirSync(root);
  return root;
}

test('write, read, list, remove inside photos', () => {
  const root = tmp();
  pfs.write(root, 'aligned/2026-11-21_front.jpg', new Uint8Array([1, 2, 3]));
  pfs.write(root, 'photos.js', new TextEncoder().encode('window.PHOTOS_INDEX = {};'));
  assert.deepStrictEqual([...pfs.read(root, 'aligned/2026-11-21_front.jpg')], [1, 2, 3]);
  assert.deepStrictEqual(pfs.list(root, ''), [{name: 'aligned', kind: 'directory'}, {name: 'photos.js', kind: 'file'}]);
  assert.deepStrictEqual(pfs.list(root, 'aligned'), [{name: '2026-11-21_front.jpg', kind: 'file'}]);
  pfs.mkdir(root, 'originals');
  assert.ok(fs.statSync(path.join(root, 'originals')).isDirectory());
  pfs.remove(root, 'aligned/2026-11-21_front.jpg');
  assert.deepStrictEqual(pfs.list(root, 'aligned'), []);
  assert.throws(() => pfs.read(root, 'nope.jpg'), e => e.code === 'NotFoundError');
});

test('paths outside photos rejected', () => {
  const root = tmp();
  fs.writeFileSync(path.join(root, '..', 'secret.json'), '{}');
  fs.symlinkSync(path.join(root, '..'), path.join(root, 'link'));
  for (const bad of ['..', '../secret.json', 'a/../../secret.json', '/etc/passwd', 'a\\..\\b', 'link/secret.json', '', './x'])
    assert.throws(() => pfs.read(root, bad), /недопустимый путь/, bad);
  assert.throws(() => pfs.write(root, '../x', new Uint8Array([1])), /недопустимый путь/);
});
