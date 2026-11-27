#!/usr/bin/env node
// Проверочный набор фото (docs/superpowers/specs/2026-11-27-photo-recognition-design.md, docs/06 → «Проверочный набор»).
// Набор и кэш — вне проекта и папки данных: PHOTO_BENCH, по умолчанию ~/Documents/SEL/photo-bench. В git ничего не попадает.
//
//   node scripts/photos_bench.js detect [--source own|extra|coco|all] [--profile <id>] [--limit N] [--min-detect X] [--side N]
//        поиск фигуры (Electron без окна, библиотеки приложения) → кэш; уже посчитанное не повторяет
//   node scripts/photos_bench.js fetch [--yes] [--max N]
//        публичные фото COCO 2017 val: без --yes — только что и откуда скачает; с --yes — разметка (архив 241 МБ, из него
//        остаётся person_keypoints_val2017.json) и подходящие снимки поштучно → photo-bench/public/
//   node scripts/photos_bench.js eval [--baseline] [--min-detect X] [--side N]
//        оценка кэша текущим portal/photos_core.js → консоль и photo-bench/report.md; --baseline — до правок алгоритма
//        сохранить исходную точку (позы и выровненные точки целых своих снимков) в photo-bench/baseline.json
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
  if (src === 'coco' || src === 'all') {
    const f = path.join(BENCH, 'public', 'coco.json');
    if (fs.existsSync(f)) out.push(...JSON.parse(fs.readFileSync(f, 'utf8')).slice(0, limit)
      .map(c => ({source: 'coco', id: c.id, file: path.join(BENCH, 'public', 'coco', c.file), pose: c.truth.pose, sha: c.id,
                  crops: B.cocoCrops(c), gt: c.kps})).filter(j => fs.existsSync(j.file)));
  }
  return out;
}

const ANN_URL = 'http://images.cocodataset.org/annotations/annotations_trainval2017.zip';
const ANN_FILE = 'annotations/person_keypoints_val2017.json';

function fetchCoco(o) {
  const pub = path.join(BENCH, 'public'), ann = path.join(pub, 'person_keypoints_val2017.json');
  if (!o.yes) {
    console.log(`Скачает:\n  ${ANN_URL} — архив разметки, 241 МБ (останется только ${path.basename(ANN_FILE)}, ~10 МБ)` +
      `\n  подходящие снимки COCO val2017 поштучно с images.cocodataset.org (несколько сотен, ~150 КБ каждый)\n  → ${pub}` +
      `\nЗапуск: node scripts/photos_bench.js fetch --yes`);
    return 0;
  }
  fs.mkdirSync(path.join(pub, 'coco'), {recursive: true});
  const curl = (url, out) => spawnSync('curl', ['-fsSL', '--retry', '2', '-o', out, url], {stdio: 'inherit'}).status === 0;
  if (!fs.existsSync(ann)) {
    const zip = path.join(pub, 'annotations.zip');
    console.log('разметка…');
    if (!curl(ANN_URL, zip)) throw new Error('не скачался ' + ANN_URL);
    const r = spawnSync('unzip', ['-o', '-j', zip, ANN_FILE, '-d', pub], {stdio: 'inherit'});
    fs.rmSync(zip, {force: true});
    if (r.status !== 0) throw new Error('не распаковался ' + ANN_FILE);
  }
  let sel = B.cocoSelect(JSON.parse(fs.readFileSync(ann, 'utf8')));
  if (o.max) sel = sel.slice(0, Number(o.max));
  const by = {};
  for (const c of sel) by[c.truth.pose || 'unclear'] = (by[c.truth.pose || 'unclear'] || 0) + 1;
  console.log(`отобрано людей: ${sel.length}`, by);
  let n = 0;
  for (const c of sel) {
    const f = path.join(pub, 'coco', c.file);
    if (!fs.existsSync(f) && !curl(c.url, f)) { console.log('не скачался ' + c.url); continue; }
    if (++n % 50 === 0) console.log(`${n}/${sel.length}`);
  }
  fs.writeFileSync(path.join(pub, 'coco.json'), JSON.stringify(sel));
  console.log(`снимков: ${n} → ${path.join(pub, 'coco')}`);
  return 0;
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

function evalCmd(o) {
  const {p, dir} = params(o), entries = [];
  for (const src of fs.existsSync(dir) ? fs.readdirSync(dir) : []) {
    const d = path.join(dir, src);
    if (!fs.statSync(d).isDirectory()) continue;
    for (const f of fs.readdirSync(d)) if (f.endsWith('.json')) entries.push(JSON.parse(fs.readFileSync(path.join(d, f), 'utf8')));
  }
  if (!entries.length) throw new Error('Кэш пуст — сначала: node scripts/photos_bench.js detect');
  const bf = path.join(BENCH, 'baseline.json');
  if (o.baseline) {
    const b = B.baselineOf(entries);
    fs.writeFileSync(bf, JSON.stringify(b));
    console.log(`исходная точка: ${Object.keys(b).length} снимков → ${bf}`);
  }
  const stats = B.evaluate(entries, {baseline: fs.existsSync(bf) ? JSON.parse(fs.readFileSync(bf, 'utf8')) : null});
  const d = new Date(), pad = n => String(n).padStart(2, '0');
  const text = B.report(stats, {date: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`, params: p});
  fs.writeFileSync(path.join(BENCH, 'report.md'), text);
  console.log(text);
  return 0;
}

if (require.main === module) {
  const o = parseArgs(process.argv.slice(2));
  const cmds = {detect, fetch: fetchCoco, eval: evalCmd};
  if (!cmds[o.cmd]) { console.error('Команды: ' + Object.keys(cmds).join(', ') + ' (см. начало scripts/photos_bench.js)'); process.exit(1); }
  try { process.exit(cmds[o.cmd](o)); } catch (e) { console.error('ОШИБКА: ' + e.message); process.exit(1); }
}

module.exports = {parseArgs, params, BENCH};
