// Файлы фото для страницы «Фото» в приложении — только внутри data/photos (страница сама строит из этого
// подобие FileSystemDirectoryHandle: portal/photos_fs.js). Любой путь наружу — ошибка «недопустимый путь».
const fs = require('node:fs');
const path = require('node:path');

function safe(root, rel, allowRoot = false) {
  const parts = String(rel).split('/');
  if (rel === '' && allowRoot) return root;
  if (rel === '' || parts.some(p => !p || p === '.' || p === '..' || p.includes('\\') || p.includes('\0')) || path.isAbsolute(rel))
    throw new Error('недопустимый путь: ' + rel);
  const p = path.join(root, ...parts);
  const realRoot = fs.realpathSync(root);
  let probe = p;                                    // ближайший существующий предок не должен уводить наружу (симлинки)
  while (!fs.existsSync(probe)) probe = path.dirname(probe);
  const real = fs.realpathSync(probe);
  if (real !== realRoot && !real.startsWith(realRoot + path.sep)) throw new Error('недопустимый путь: ' + rel);
  return p;
}

function notFound(rel) { const e = new Error('нет файла: ' + rel); e.code = 'NotFoundError'; return e; }

function list(root, rel) {
  const p = safe(root, rel, true);
  if (!fs.existsSync(p)) throw notFound(rel);
  return fs.readdirSync(p, {withFileTypes: true}).filter(d => d.isFile() || d.isDirectory())
    .map(d => ({name: d.name, kind: d.isDirectory() ? 'directory' : 'file'})).sort((a, b) => (a.name < b.name ? -1 : 1));
}

function read(root, rel) {
  const p = safe(root, rel);
  if (!fs.existsSync(p) || !fs.statSync(p).isFile()) throw notFound(rel);
  return new Uint8Array(fs.readFileSync(p));
}

function write(root, rel, bytes) {
  const p = safe(root, rel);
  fs.mkdirSync(path.dirname(p), {recursive: true});
  fs.writeFileSync(p + '.tmp', Buffer.from(bytes));
  fs.renameSync(p + '.tmp', p);
}

function mkdir(root, rel) { fs.mkdirSync(safe(root, rel), {recursive: true}); }

function remove(root, rel) {
  const p = safe(root, rel);
  if (!fs.existsSync(p)) throw notFound(rel);
  fs.rmSync(p, {recursive: true});
}

function exists(root, rel) {
  const p = safe(root, rel);
  return !fs.existsSync(p) ? null : fs.statSync(p).isDirectory() ? 'directory' : 'file';
}

module.exports = {list, read, write, mkdir, remove, exists, safe};
