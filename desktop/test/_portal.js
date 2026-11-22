// Помощник тестов страниц: скрипты portal/*.js (обычные <script>, без модулей) выполняются в отдельном контексте Node,
// как в браузере без DOM; значения возвращаются через JSON — как их увидела бы страница.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.join(__dirname, '..', '..');
const PORTAL = path.join(ROOT, 'portal');
const source = name => fs.readFileSync(path.join(PORTAL, name), 'utf8');

/** Загрузить скрипты портала по порядку → js(выражение) = значение после JSON-круга. */
function load(...files) {
  const ctx = vm.createContext({});
  for (const f of files) vm.runInContext(source(f), ctx, {filename: f});
  return expr => {
    const s = vm.runInContext(`JSON.stringify(${expr})`, ctx);
    return s === undefined ? undefined : JSON.parse(s);
  };
}

const J = JSON.stringify;

module.exports = {ROOT, PORTAL, source, load, J};
