// scripts/vendor_fetch.js — библиотеки «Фото»: распаковка .tgz, хэши, сборка portal/vendor (без сети) и проверка --check.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const {execFileSync} = require('node:child_process');
const vf = require('../../scripts/vendor_fetch');
const {ROOT} = require('./_portal');

const tmp = p => fs.mkdtempSync(path.join(os.tmpdir(), p));
const LONG = 'a-very-long-directory-name-for-testing/' + 'b'.repeat(90) + '/file.js';     // длиннее 100 байт — pax или prefix

/** .tgz системным tar: package/<путь> → содержимое. */
function tgz(files) {
  const d = tmp('vf-tar-');
  for (const [rel, text] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(d, 'package', rel)), {recursive: true});
    fs.writeFileSync(path.join(d, 'package', rel), text);
  }
  execFileSync('tar', ['-czf', path.join(d, 'p.tgz'), '-C', d, 'package'], {env: {...process.env, COPYFILE_DISABLE: '1'}});   // без ._файлов macOS
  return fs.readFileSync(path.join(d, 'p.tgz'));
}

test('untar: files without the package/ folder, long names, binary content', () => {
  const bin = Buffer.from([0, 1, 2, 255, 0, 10]);
  const out = vf.untar(tgz({'a.js': 'x\n', 'wasm/b.wasm': bin, [LONG]: 'long'}));
  assert.deepStrictEqual(Object.keys(out).sort(), [LONG, 'a.js', 'wasm/b.wasm'].sort());
  assert.strictEqual(out['a.js'].toString(), 'x\n');
  assert.deepStrictEqual(out['wasm/b.wasm'], bin);
  assert.strictEqual(out[LONG].toString(), 'long');
});

test('integrity of npm tarball', () => {
  const buf = Buffer.from('tarball');
  assert.ok(vf.integrityOk(buf, 'sha512-' + crypto.createHash('sha512').update(buf).digest('base64')));
  assert.ok(!vf.integrityOk(Buffer.from('other'), 'sha512-' + crypto.createHash('sha512').update(buf).digest('base64')));
});

test('source map link removed, lines as before', () => {
  assert.strictEqual(vf.stripMap('a\r\nb\n//# sourceMappingURL=x.map\nc'), 'a\nb\nc\n');
  assert.strictEqual(vf.stripMap(''), '\n');
  assert.strictEqual(vf.b64Js('k', Buffer.from('hi')), '(self.VENDOR_B64=self.VENDOR_B64||{}).k="aGk=";\n');
});

test('build writes files, licenses and README; --check sees a changed file', () => {
  const tars = {};
  for (const [pkg, src] of [...vf.FILES, ...vf.LICENSES].map(([p, s]) => [p, s])) (tars[pkg] ||= {})[src] = Buffer.from(`${pkg}/${src}\n`);
  const out = tmp('vf-out-');
  const written = vf.build(tars, Buffer.from('model'), out);
  assert.strictEqual(written.length, 6);
  assert.strictEqual(fs.readFileSync(path.join(out, 'exifr.js'), 'utf8'), 'exifr/dist/lite.umd.js\n');
  assert.match(fs.readFileSync(path.join(out, 'mediapipe_wasm.b64.js'), 'utf8'), /^\(self\.VENDOR_B64=self\.VENDOR_B64\|\|\{\}\)\.vision_wasm="/);
  assert.ok(fs.existsSync(path.join(out, 'LICENSES', 'mediapipe.txt')));
  assert.match(fs.readFileSync(path.join(out, 'README.md'), 'utf8'), /node scripts\/vendor_fetch\.js --check/);
  const log = console.log; console.log = () => {};
  try {
    assert.strictEqual(vf.check(out), 0);
    fs.appendFileSync(path.join(out, 'libheif.js'), '//');
    assert.strictEqual(vf.check(out), 1);
  } finally { console.log = log; }
});

test('portal/vendor matches its README', () => {
  const log = console.log; console.log = () => {};
  try { assert.strictEqual(vf.check(path.join(ROOT, 'portal', 'vendor')), 0); } finally { console.log = log; }
});
