#!/usr/bin/env node
// Проверочный набор фото (docs/superpowers/specs/2026-11-27-photo-recognition-design.md, docs/06 → «Проверочный набор»).
// Набор и кэш — вне проекта и папки данных: PHOTO_BENCH, по умолчанию ~/Documents/SEL/photo-bench. В git ничего не попадает.
//
//   node scripts/photos_bench.js detect [--source own|extra|coco|all] [--profile <id>] [--limit N] [--min-detect X] [--side N]
//        поиск фигуры (Electron без окна, библиотеки приложения) → кэш; уже посчитанное не повторяет
'use strict';
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const {spawnSync} = require('node:child_process');
const B = require('./photos_bench_lib.js');

const ROOT = path.join(__dirname, '..');
const BENCH = process.env.PHOTO_BENCH || path.join(os.homedir(), 'Documents', 'SEL', 'photo-bench');
const MODEL = 'pose_landmarker_full';

/** --ключ значение → {ключ: значение}; первое слово — команда. */
function parseArgs(argv) {
  const o = {cmd: argv[0]};
  for (let i = 1; i < argv.length; i++) {
    const m = /^--(.+)$/.exec(argv[i]);
    if (!m) continue;
    const next = argv[i + 1];
    if (next === undefined || next.startsWith('--')) o[m[1]] = true; else { o[m[1]] = next; i++; }
  }
  return o;
}

/** Параметры поиска фигуры (от них зависит результат MediaPipe) и папка кэша под них. */
function params(o) {
  const p = {model: MODEL, side: o.side ? Number(o.side) : 1024, minDetect: o['min-detect'] ? Number(o['min-detect']) : null};
  const tag = 'p' + crypto.createHash('sha1').update(JSON.stringify(p)).digest('hex').slice(0, 8);
  return {p, dir: path.join(BENCH, 'cache', tag)};
}

/** Задания на поиск фигуры по источникам. */
function jobs(o) {
  const src = o.source || 'all', limit = o.limit ? Number(o.limit) : Infinity, out = [];
  if (src === 'own' || src === 'all') {
    const dir = require('./csv.js').profileDir(process.env, undefined, o.profile || null);
    if (!dir) throw new Error('Папка данных не найдена: откройте SEL и выберите её (или HEALTH_DATA=<папка>)');
    const photos = path.join(dir, 'photos'), idx = path.join(photos, 'photos.js');
    if (fs.existsSync(idx)) out.push(...B.ownJobs(B.readIndex(idx), photos).slice(0, limit).map(j => Object.assign(j, {source: 'own', crops: null})));
  }
  if (src === 'extra' || src === 'all')
    out.push(...B.extraJobs(path.join(BENCH, 'own'), console.warn).slice(0, limit).map(j => Object.assign(j, {source: 'extra', crops: null})));
  return out;
}

function detect(o) {
  const {p, dir} = params(o), list = jobs(o);
  fs.mkdirSync(dir, {recursive: true});
  fs.writeFileSync(path.join(dir, 'params.json'), JSON.stringify(p, null, 1));
  const file = path.join(dir, 'jobs.json');
  fs.writeFileSync(file, JSON.stringify({cacheDir: dir, params: p, jobs: list}));
  console.log(`снимков: ${list.length}, кэш: ${dir}`);
  const electron = require(path.join(ROOT, 'desktop', 'node_modules', 'electron'));
  const r = spawnSync(electron, [path.join(ROOT, 'desktop', 'bench', 'photos_detect.js'), file], {stdio: 'inherit'});
  fs.rmSync(file, {force: true});
  return r.status || 0;
}

if (require.main === module) {
  const o = parseArgs(process.argv.slice(2));
  const cmds = {detect};
  if (!cmds[o.cmd]) { console.error('Команды: ' + Object.keys(cmds).join(', ') + ' (см. начало scripts/photos_bench.js)'); process.exit(1); }
  try { process.exit(cmds[o.cmd](o)); } catch (e) { console.error('ОШИБКА: ' + e.message); process.exit(1); }
}

module.exports = {parseArgs, params, BENCH};
