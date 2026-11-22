// Протокол app://h/ — что окно приложения может загрузить: страницы портала (из приложения), data.js и фото
// (из папки данных пользователя). Всё остальное — null (404): CSV, meta.json, ключи, логи, выход за папки.
const path = require('node:path');

function inside(base, p) {
  const rel = path.relative(base, p);
  return rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel);
}

/** URL → путь файла или null. */
function resolve(url, portalDir, dataDir) {
  let u;
  try { u = new URL(url); } catch (e) { return null; }
  if (u.protocol !== 'app:' || u.host !== 'h') return null;
  let parts;
  try { parts = u.pathname.split('/').slice(1).map(decodeURIComponent); } catch (e) { return null; }
  if (parts.some(s => s === '..' || s === '.' || s.includes('/') || s.includes('\\') || s.includes('\0'))) return null;
  let base, rest;
  if (parts[0] === 'portal' && parts.length > 1) { base = portalDir; rest = parts.slice(1); }
  else if (parts[0] === 'data' && parts.length === 2 && parts[1] === 'data.js') { base = dataDir; rest = ['data.js']; }
  else if (parts[0] === 'data' && parts[1] === 'photos' && parts.length > 2) { base = path.join(dataDir, 'photos'); rest = parts.slice(2); }
  else return null;
  if (rest.some(s => s === '')) return null;
  const p = path.join(base, ...rest);
  return inside(path.resolve(base), path.resolve(p)) ? p : null;
}

// Политика содержимого для всего, что отдаёт app://h/: страницы ничего не берут и не шлют наружу (ни скриптов, ни картинок,
// ни fetch) — даже если в данные попала разметка. Встроенные <script> и стили — свои у каждой страницы; wasm и blob: — для «Фото»
// (MediaPipe, libheif). Внешние ссылки открываются только через window.health.openExternal (белый список в settings.js).
const CSP = ["default-src 'self'", "script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval'", "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:", "connect-src 'self' data: blob:", "worker-src 'self' blob:", "font-src 'self' data:",
  "object-src 'none'", "base-uri 'none'", "form-action 'none'", "frame-ancestors 'none'"].join('; ');

module.exports = {resolve, inside, CSP};
