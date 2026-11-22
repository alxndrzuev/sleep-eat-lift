#!/usr/bin/env node
// Библиотеки для страницы «Фото» → portal/vendor/ (всё внутри приложения: без CDN и интернета во время работы).
//
//   node scripts/vendor_fetch.js           # скачать фиксированные версии, проверить хэши, упаковать
//   node scripts/vendor_fetch.js --check   # только сверить уже лежащие файлы с README (sha256)
//
// Страница подключает их обычным <script> (без модулей и fetch): всё — classic-script .js; двоичные файлы (wasm,
// модель) — base64 в self.VENDOR_B64.<ключ>. Что получается (глобальные имена — для portal/photos_app.js):
//   mediapipe_vision.js       → Vision {FilesetResolver, PoseLandmarker, …}   @mediapipe/tasks-vision, Apache-2.0
//   mediapipe_wasm_loader.js  → ModuleFactory (загрузчик wasm; подключается до создания PoseLandmarker)
//   mediapipe_wasm.b64.js     → VENDOR_B64.vision_wasm
//   pose_model.b64.js         → VENDOR_B64.pose_model (pose_landmarker_full.task, Google, Apache-2.0)
//   libheif.js                → libheif (фабрика; wasm уже внутри)                libheif-js, LGPL-3.0
//   exifr.js                  → exifr {parse}                                      exifr (lite), MIT
// Тексты лицензий — portal/vendor/LICENSES/. Обновить версию: поменять PACKAGES/MODEL ниже (новый integrity/sha256).
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const crypto = require('node:crypto');

const OUT = path.join(__dirname, '..', 'portal', 'vendor');
const UA = {'User-Agent': 'health-portal-vendor/1.0'};

const PACKAGES = {  // пакет npm: [версия, integrity из registry.npmjs.org]
  '@mediapipe/tasks-vision': ['1.2.3', 'sha512-sxJyfhbN+EamexhaaCmUlw7v8vWWMum7VDsORe6d4c8Dk/xlI4qiIgoSw9cE9hpvYhVRRVLIA8y605FbqWkNeQ=='],
  'libheif-js': ['1.23.5', 'sha512-umXZPthnWZtF3iG/5mQG+AZ2V6i0UeYpo3z2CkggTEgL8dKmIIwJT6TDuAMuabXa1yTW8uJ1ZAgR+CxNTklYYw=='],
  'exifr': ['7.1.3', 'sha512-g/aje2noHivrRSLbAUtBPWFbxKdKhgj/xr1vATDdUXPOFYJlQ62Ft0oy+72V6XLIpDJfHs6gXLbBLAolqOXYRw=='],
};
const MODEL = ['https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_full/float16/latest/pose_landmarker_full.task',
  '4eaa5eb7a98365221087693fcc286334cf0858e2eb6e15b506aa4a7ecdcec4ad'];

// [пакет, файл в тарболе, что сделать, имя в vendor/ или ключ VENDOR_B64]
const FILES = [
  ['@mediapipe/tasks-vision', 'vision_bundle.js', 'js', 'mediapipe_vision.js'],
  ['@mediapipe/tasks-vision', 'wasm/vision_wasm_internal.js', 'js', 'mediapipe_wasm_loader.js'],
  ['@mediapipe/tasks-vision', 'wasm/vision_wasm_internal.wasm', 'b64', 'vision_wasm'],
  ['libheif-js', 'libheif-wasm/libheif-bundle.js', 'js', 'libheif.js'],
  ['exifr', 'dist/lite.umd.js', 'js', 'exifr.js'],
];
const LICENSES = [['libheif-js', 'LICENSE', 'libheif-js.txt'], ['libheif-js', 'libheif-wasm/LICENSE', 'libheif.txt'],
  ['exifr', 'LICENSE', 'exifr.txt']];
/** Лицензия MediaPipe и модели позы: кто автор + полный текст Apache 2.0 (scripts/licenses — копия apache.org, её sha256
 *  проверяет тест): по условиям лицензии получатель сборки должен получить сам текст, ссылки мало. */
const mediapipeLicense = () => '@mediapipe/tasks-vision и модель pose_landmarker_full.task — Copyright Google LLC (MediaPipe).\n' +
  'Распространяется по лицензии Apache License, Version 2.0 — полный текст ниже.\n\n' +
  fs.readFileSync(path.join(__dirname, 'licenses', 'Apache-2.0.txt'), 'utf8');

const sha256 = buf => crypto.createHash('sha256').update(buf).digest('hex');

/** integrity npm («sha512-<base64>») совпадает с содержимым. */
function integrityOk(buf, integrity) {
  const [algo, want] = [integrity.slice(0, integrity.indexOf('-')), integrity.slice(integrity.indexOf('-') + 1)];
  return crypto.createHash(algo).update(buf).digest('base64') === want;
}

/** .tgz → {путь без первой папки (package/): Buffer} — только файлы; ustar, длинные имена pax и GNU. */
function untar(tgz) {
  const tar = zlib.gunzipSync(tgz), out = {};
  const str = (b, a, n) => { const s = b.subarray(a, a + n); const z = s.indexOf(0); return (z < 0 ? s : s.subarray(0, z)).toString('utf8'); };
  let pos = 0, longName = null;
  while (pos + 512 <= tar.length) {
    const h = tar.subarray(pos, pos + 512);
    if (h.every(x => x === 0)) break;
    const size = parseInt(str(h, 124, 12).trim() || '0', 8), type = String.fromCharCode(h[156] || 48);
    const body = tar.subarray(pos + 512, pos + 512 + size);
    pos += 512 + Math.ceil(size / 512) * 512;
    if (type === 'x') { const m = body.toString('utf8').match(/^\d+ path=(.*)$/m); if (m) longName = m[1]; continue; }
    if (type === 'L') { longName = str(body, 0, size); continue; }
    if (type === 'g') continue;
    const prefix = str(h, 257, 6).startsWith('ustar') ? str(h, 345, 155) : '';
    const name = longName || (prefix ? prefix + '/' + str(h, 0, 100) : str(h, 0, 100));
    longName = null;
    if (type === '0' || type === '\0') out[name.split('/').slice(1).join('/')] = Buffer.from(body);
  }
  return out;
}

/** Убрать ссылку на .map (файла карты нет — консоль будет ругаться). Строки делятся как str.splitlines() в Python —
 * прежний скрипт так делал, и хэши в README от этого зависят. */
function stripMap(text) {
  return text.split(/\r\n|[\n\r\v\f\x1c\x1d\x1e\x85\u2028\u2029]/).filter((l, i, a) => !(i === a.length - 1 && l === ''))
    .filter(l => !l.startsWith('//# sourceMappingURL=')).join('\n') + '\n';
}

const b64Js = (key, data) => `(self.VENDOR_B64=self.VENDOR_B64||{}).${key}="${Buffer.from(data).toString('base64')}";\n`;

/** Разложить скачанное по out: tars — {пакет: untar(…)}, model — Buffer. → [[файл, источник]]. */
function build(tars, model, out = OUT) {
  fs.mkdirSync(path.join(out, 'LICENSES'), {recursive: true});
  const written = [];
  for (const [pkg, src, kind, dst] of FILES) {
    const data = tars[pkg][src];
    let file;
    if (kind === 'js') { file = path.join(out, dst); fs.writeFileSync(file, stripMap(data.toString('utf8'))); }
    else { file = path.join(out, dst === 'vision_wasm' ? 'mediapipe_wasm.b64.js' : dst + '.b64.js'); fs.writeFileSync(file, b64Js(dst, data)); }
    written.push([file, `${pkg}@${PACKAGES[pkg][0]}/${src}`]);
  }
  const mf = path.join(out, 'pose_model.b64.js');
  fs.writeFileSync(mf, b64Js('pose_model', model));
  written.push([mf, `pose_landmarker_full.task (${MODEL[0]})`]);
  for (const [pkg, src, dst] of LICENSES) fs.writeFileSync(path.join(out, 'LICENSES', dst), tars[pkg][src]);
  fs.writeFileSync(path.join(out, 'LICENSES', 'mediapipe.txt'), mediapipeLicense());
  const lines = ['# portal/vendor — библиотеки страницы «Фото»', '',
    'Собрано `scripts/vendor_fetch.js` — не править руками. Проверка: `node scripts/vendor_fetch.js --check`.', '',
    '| файл | источник | sha256 |', '|---|---|---|',
    ...written.map(([f, s]) => `| ${path.basename(f)} | ${s} | ${sha256(fs.readFileSync(f))} |`)];
  fs.writeFileSync(path.join(out, 'README.md'), lines.join('\n') + '\n');
  return written;
}

async function get(url) {
  const r = await fetch(url, {headers: UA});
  if (!r.ok) throw new Error(`${url}: HTTP ${r.status}`);
  return Buffer.from(await r.arrayBuffer());
}

async function fetchAll() {
  const tars = {};
  for (const [pkg, [ver, integrity]] of Object.entries(PACKAGES)) {
    const raw = await get(`https://registry.npmjs.org/${pkg}/-/${pkg.split('/').pop()}-${ver}.tgz`);
    if (!integrityOk(raw, integrity)) throw new Error(`${pkg}@${ver}: integrity не совпал`);
    tars[pkg] = untar(raw);
  }
  const model = await get(MODEL[0]);
  if (sha256(model) !== MODEL[1])
    throw new Error('модель pose_landmarker_full.task: sha256 не совпал (Google обновил latest?) — проверить и обновить MODEL');
  const written = build(tars, model);
  const total = written.reduce((s, [f]) => s + fs.statSync(f).size, 0);
  console.log(`OK -> portal/vendor (${written.length} файлов, ${(total / 1e6).toFixed(1)} МБ)`);
}

/** Сверить файлы с таблицей README. → сколько нет или изменено. */
function check(out = OUT) {
  let bad = 0;
  for (const line of fs.readFileSync(path.join(out, 'README.md'), 'utf8').split('\n')) {
    const parts = line.trim().replace(/^\||\|$/g, '').split('|').map(p => p.trim());
    if (parts.length === 3 && parts[2].length === 64) {
      const f = path.join(out, parts[0]);
      if (!fs.existsSync(f) || sha256(fs.readFileSync(f)) !== parts[2]) { console.log(`⚠ ${parts[0]}: нет или изменён`); bad++; }
    }
  }
  console.log(bad ? `Изменено/нет: ${bad}` : 'OK');
  return bad;
}

if (require.main === module) {
  if (process.argv.includes('--check')) process.exit(check() ? 1 : 0);
  fetchAll().catch(e => { console.error('ОШИБКА: ' + e.message); process.exit(1); });
}

module.exports = {untar, stripMap, b64Js, integrityOk, build, check, mediapipeLicense, FILES, LICENSES, PACKAGES};
