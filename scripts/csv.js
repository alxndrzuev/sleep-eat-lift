#!/usr/bin/env node
// Данные пользователя из командной строки — для работы с Claude в чате: те же правила записи, что в приложении
// (desktop/store.js: колонки по схеме desktop/schema.json, сортировка, LF, числа без лишних нулей).
// Страницы приложения берут данные из CSV при загрузке — новое видно после перезагрузки страницы (⌘R).
//
//   node scripts/csv.js dir                                        # папка текущего профиля и список профилей
//   node scripts/csv.js read body.csv [N]                          # последние N строк (по умолчанию 10), JSON
//   node scripts/csv.js upsert body.csv '{"2026-11-22": {"weight_kg": 75.4, "note": "утро"}}'
//   node scripts/csv.js remove events.csv 2026-11-10 [ключ…]
//   supplements.csv — только через «Настройки» (строки одной даты различаются названием)
//   --profile <id> (в любом месте) — другой профиль, не текущий
//
// Папка данных (корень с profiles/): HEALTH_DATA → папка, выбранная в приложении SEL (~/Library/Application Support/SEL/
// config.json → dataDir). Профиль — текущий в SEL (config.json → profile) или --profile; HEALTH_DATA может указывать и на сам профиль.
const path = require('node:path');
const store = require('../desktop/store');
const fs = require('node:fs');
const datadir = require('../desktop/datadir');
const profiles = require('../desktop/profiles');

/** Корень папки данных или null. */
function rootDir(env = process.env, userData = datadir.appUserData()) {
  if (env.HEALTH_DATA) return env.HEALTH_DATA;
  return datadir.current(userData).dir;
}

/** Папка профиля: id → он; иначе текущий в SEL, иначе первый. HEALTH_DATA — сам профиль (есть profile.json) или корень;
 *  корень старого вида (1.x: CSV прямо в нём, профилей нет) — он сам. */
function profileDir(env = process.env, userData = datadir.appUserData(), id) {
  const root = rootDir(env, userData);
  if (!root) return null;
  if (fs.existsSync(path.join(root, 'profile.json'))) return root;
  if (id) { if (!profiles.readMeta(root, id)) throw new Error('Нет такого профиля: ' + id); return profiles.dir(root, id); }
  const cur = profiles.pick(root, env.HEALTH_DATA ? null : datadir.readCfg(userData).profile);
  return cur ? profiles.dir(root, cur) : root;
}

/** Корень и все профили — для проверок (public_check). */
function allDirs(root) { return [root, ...profiles.list(root).map(p => profiles.dir(root, p.id))]; }

/** argv → {args без --profile <id>, profile}. */
function parseArgs(argv) {
  const args = [...argv], i = args.indexOf('--profile');
  let profile;
  if (i >= 0) { profile = args[i + 1]; args.splice(i, 2); }
  return {args, profile};
}

/** «dir»: папка профиля и список профилей. */
function describe(env = process.env, userData = datadir.appUserData(), id) {
  const dir = profileDir(env, userData, id), root = rootDir(env, userData);
  return [dir, ...profiles.list(root).map(p => `  ${p.id} — ${p.name}${profiles.dir(root, p.id) === dir ? ' (текущий)' : ''}`)].join('\n');
}

function known(name) {
  if (!store.SCHEMA.schema[name]) throw new Error(`${name}: такого файла нет в схеме (${Object.keys(store.SCHEMA.schema).join(', ')})`);
}

/** Выполнить команду (args — без node и имени скрипта) → текст для вывода. */
function run(args, dir) {
  const [cmd, name, ...rest] = args;
  if (cmd === 'read') {
    known(name);
    const n = Number(rest[0] || 10);
    return store.read(dir, name).slice(-n).map(r => JSON.stringify(r)).join('\n');
  }
  if (cmd === 'upsert') {
    known(name);
    const fresh = JSON.parse(rest[0] || '');
    const r = store.upsert(dir, name, fresh);
    return `${name}: добавлено ${r.added}, обновлено ${r.updated}, всего ${r.total}`;
  }
  if (cmd === 'remove') {
    known(name);
    const n = store.remove(dir, name, rest);
    return `${name}: удалено ${n}`;
  }
  throw new Error('команды: dir · read <файл.csv> [N] · upsert <файл.csv> <json> · remove <файл.csv> <ключ…>');
}

if (require.main === module) {
  try {
    const {args, profile} = parseArgs(process.argv.slice(2));
    const dir = profileDir(process.env, undefined, profile);
    if (!dir) { console.error('Папка данных не найдена: откройте SEL и выберите её (или HEALTH_DATA=<папка>)'); process.exit(1); }
    console.log(args[0] === 'dir' ? describe(process.env, undefined, profile) : run(args, path.resolve(dir)));
  } catch (e) { console.error('ОШИБКА: ' + e.message); process.exit(1); }
}

module.exports = {rootDir, profileDir, allDirs, parseArgs, describe, run};
