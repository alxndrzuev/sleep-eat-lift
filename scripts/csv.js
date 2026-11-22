#!/usr/bin/env node
// Данные пользователя из командной строки — для работы с Claude в чате: те же правила записи, что в приложении
// (desktop/store.js: колонки по схеме desktop/schema.json, сортировка, LF, числа без лишних нулей).
// После записи пересобирает data.js — страницы приложения покажут новое после перезагрузки (⌘R).
//
//   node scripts/csv.js dir                                        # папка данных
//   node scripts/csv.js read body.csv [N]                          # последние N строк (по умолчанию 10), JSON
//   node scripts/csv.js upsert body.csv '{"2026-11-22": {"weight_kg": 75.4, "waist_cm": 81}}'
//   node scripts/csv.js remove events.csv 2026-11-10 [ключ…]
//
// Папка данных: HEALTH_DATA → папка, выбранная в приложении SEL (~/Library/Application Support/SEL/config.json → dataDir).
const path = require('node:path');
const store = require('../desktop/store');
const datadir = require('../desktop/datadir');

/** Папка данных или null. */
function dataDir(env = process.env, userData = datadir.appUserData()) {
  if (env.HEALTH_DATA) return env.HEALTH_DATA;
  return datadir.current(userData).dir;
}

const today = () => { const d = new Date(); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0, 10); };

function known(name) {
  if (!store.SCHEMA.schema[name]) throw new Error(`${name}: такого файла нет в схеме (${Object.keys(store.SCHEMA.schema).join(', ')})`);
}

/** Выполнить команду (args — без node и имени скрипта) → текст для вывода. */
function run(args, dir) {
  const [cmd, name, ...rest] = args;
  if (cmd === 'dir') return dir;
  if (cmd === 'read') {
    known(name);
    const n = Number(rest[0] || 10);
    return store.read(dir, name).slice(-n).map(r => JSON.stringify(r)).join('\n');
  }
  if (cmd === 'upsert') {
    known(name);
    const fresh = JSON.parse(rest[0] || '');
    const r = store.upsert(dir, name, fresh);
    store.writeDataJs(dir, today());
    return `${name}: добавлено ${r.added}, обновлено ${r.updated}, всего ${r.total}`;
  }
  if (cmd === 'remove') {
    known(name);
    const n = store.remove(dir, name, rest);
    store.writeDataJs(dir, today());
    return `${name}: удалено ${n}`;
  }
  throw new Error('команды: dir · read <файл.csv> [N] · upsert <файл.csv> <json> · remove <файл.csv> <ключ…>');
}

if (require.main === module) {
  const dir = dataDir();
  if (!dir) { console.error('Папка данных не найдена: откройте SEL и выберите её (или HEALTH_DATA=<папка>)'); process.exit(1); }
  try { console.log(run(process.argv.slice(2), path.resolve(dir))); }
  catch (e) { console.error('ОШИБКА: ' + e.message); process.exit(1); }
}

module.exports = {dataDir, run};
