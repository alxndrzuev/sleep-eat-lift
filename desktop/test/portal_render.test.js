// Отрисовка страниц в headless Chrome (file://) — только при RENDER=1 и если есть Chrome:  RENDER=1 npm test
// Временная папка: portal → ссылка на настоящий portal/, data/data.js — собирает store.js из CSV временной папки данных.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {pathToFileURL} = require('node:url');
const {spawnSync} = require('node:child_process');
const store = require('../store');
const {dataDir} = require('../../scripts/csv');
const {PORTAL, source} = require('./_portal');

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const skip = !(process.env.RENDER === '1' && fs.existsSync(CHROME)) && 'RENDER=1 и Chrome';

/** Страница из папки base → DOM после отрисовки, без <script> и <style> (только то, что видно). */
function render(base, page) {
  const r = spawnSync(CHROME, ['--headless=new', '--disable-gpu', '--virtual-time-budget=4000', '--dump-dom',
    pathToFileURL(path.join(base, 'portal', page)).href], {encoding: 'utf8', timeout: 60000});
  return r.stdout.replace(/<(script|style)\b[\s\S]*?<\/\1>/g, '');
}

function site(dataFolder) {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'portal-render-'));
  fs.symlinkSync(PORTAL, path.join(base, 'portal'));
  fs.mkdirSync(path.join(base, 'data'));
  fs.writeFileSync(path.join(base, 'data', 'data.js'), 'const RAW = ' + JSON.stringify(store.raw(dataFolder, '2026-11-21')) + ';\n');
  return base;
}

/** Временная папка данных с пустыми CSV → {put(имя, строки), page(страница)}. */
function data() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'health-render-data-'));
  store.init(dir);
  return {
    put: (name, rows) => store.write(dir, name, rows),
    page: name => { const base = site(dir); try { return render(base, name); } finally { fs.rmSync(base, {recursive: true, force: true}); } },
  };
}

const days = (n, row) => Array.from({length: n}, (_, i) => Object.assign({date: `2026-11-${String(i + 1).padStart(2, '0')}`}, row));

function fatsecret(d) {
  d.put('nutrition_daily.csv', days(20, {kcal: '2100', protein: '120', fat: '60', carbs: '250'}));
  d.put('body.csv', [{date: '2026-11-10', weight_kg: '75.5'}, {date: '2026-11-20', weight_kg: '75.8'}]);
  d.put('goal_weight.csv', [{date: '2026-11-01', goal_weight_kg: '80'}]);
  d.put('targets.csv', [{start: '2026-11-01', kcal: '2200', protein: '130', fat: '70', carbs: '260'}]);
  return d;
}
// текст из CSV и от сервисов (заметки, вид спорта) выводится как текст, а не как разметка
const TAG = '<img src="x" id="injected">';
const has = (dom, s) => assert.ok(dom.includes(s), s);
const hasNot = (dom, s) => assert.ok(!dom.includes(s), s);

test('FatSecret only: dashboard', {skip}, () => {
  const dom = fatsecret(data()).page('dashboard.html');
  has(dom, 'href="nutrition.html"');
  hasNot(dom, 'href="training.html"');
  hasNot(dom, 'Recovery');
  hasNot(dom, '/ 8');
  for (const card of ['supps', 'plan'])                              // пустые блоки скрыты
    assert.match(dom, new RegExp(`id="card-${card}"[^>]*hidden`), card);
  for (const gone of ['card-events', 'card-labs', 'card-good', 'id="prio"', 'Самочувствие', 'Талия'])   // убраны в 1.2
    hasNot(dom, gone);
  has(dom, 'цель 80');
  has(dom, 'цель 2');                                                // калории: «цель 2 200» из targets.csv
});

test('Whoop only: dashboard', {skip}, () => {
  const d = data();
  d.put('whoop_daily.csv', days(20, {recovery: '60', hrv: '70', rhr: '55', sleep_h: '7.5', steps: '8000'}));
  const dom = d.page('dashboard.html');
  has(dom, 'href="training.html"');
  hasNot(dom, 'href="nutrition.html"');
  hasNot(dom, 'Калории');
  hasNot(dom, 'Подключите');
});

function workouts(d) {
  d.put('whoop_daily.csv', days(20, {recovery: '60', hrv: '70', rhr: '55', sleep_h: '7'}));
  d.put('whoop_workouts.csv', [{id: '1', date: '2026-11-10', start: '2026-11-10 19:00', sport: 'squash', duration_min: '60'},
                               {id: '2', date: '2026-11-12', start: '2026-11-12 19:00', sport: 'weightlifting_msk', duration_min: '60'},
                               {id: '3', date: '2026-11-12', start: '2026-11-12 20:05', sport: 'cycling', duration_min: '15'}]);
  return d;
}

test('«Кардио» on «Тренировки» for everyone, no goals — no plan numbers', {skip}, () => {
  const dom = workouts(data()).page('training.html');
  has(dom, 'Кардио');
  hasNot(dom, 'Сквош');
  hasNot(dom, 'Другое');
  hasNot(dom, 'план 2');
});

test('no goals: dashboard and «Восстановление» render', {skip}, () => {
  const d = workouts(data());
  const dom = d.page('dashboard.html');
  has(dom, 'Силовые, 4 нед');
  has(dom, 'Кардио, 4 нед');
  hasNot(dom, '<small> / ');
  hasNot(dom, 'NaN');
  const rec = d.page('recovery.html');
  hasNot(rec, 'NaN');
  has(rec, '7,5');                                                   // цель сна по умолчанию
});

test('workout and sleep goals from «Цели»', {skip}, () => {
  const d = workouts(data());
  d.put('targets.csv', [{start: '2026-11-01', sleep_h: '8', strength_wk: '2', cardio_wk: '3'}]);
  const dom = d.page('dashboard.html');
  has(dom, '/ 8</small>');                                           // силовые: 2 в неделю × 4
  has(dom, '/ 12</small>');                                          // кардио: 3 × 4
  has(dom, 'цель 8');
  has(d.page('training.html'), 'план 2 в неделю');
});

test('plan text on the dashboard: escaped, line breaks kept', {skip}, () => {
  const d = data();
  d.put('body.csv', [{date: '2026-11-10', weight_kg: '75.5'}]);
  d.put('plans.csv', [{start: '2026-10-01', text: 'старый'}, {start: '2026-11-16', text: 'Сон 7,5+\n' + TAG}]);
  const dom = d.page('dashboard.html');
  hasNot(dom, TAG);
  has(dom, 'Сон 7,5+\n&lt;img');
  has(dom, 'с 16 нояб');
  hasNot(dom, 'старый');
});

test('empty dashboard', {skip}, () => {
  has(data().page('dashboard.html'), 'Подключите FatSecret или Whoop');
  has(source('common.css'), '[hidden]{display:none!important}');
});

test('nutrition without targets (new user) renders', {skip}, () => {
  const d = fatsecret(data());
  d.put('targets.csv', []);
  const dom = d.page('nutrition.html');
  assert.ok(dom.split('<svg').length - 1 >= 3);
  hasNot(dom, 'цель null');
  has(dom, 'ккал');
  for (const lab of ['Выполнил', 'Рядом с целью', 'Мимо цели', 'смена цели']) hasNot(dom, lab);   // без целей не с чем сравнивать
});

test('only sleep and workout goals: «Питание» has no nutrition goal', {skip}, () => {
  const d = fatsecret(data());
  d.put('targets.csv', [{start: '2026-11-01', sleep_h: '8', strength_wk: '2'}]);
  const dom = d.page('nutrition.html');
  hasNot(dom, 'null');
  for (const lab of ['Выполнил', 'Мимо цели', 'смена цели']) hasNot(dom, lab);
  has(dom, 'Не задана');
});

test('target set today, diary kept long ago — history not cut', {skip}, () => {
  const d = fatsecret(data());
  d.put('targets.csv', [{start: '2026-11-21', kcal: '2100', protein: '120', fat: '60', carbs: '270'}]);
  const dom = d.page('nutrition.html');
  hasNot(dom, '0 дней');
  hasNot(dom, 'NaN');
  has(dom, '14 дней');
});

test('targets of the last 2 weeks under the calendar', {skip}, () => {
  const d = fatsecret(data());
  const t = (start, kcal, protein) => ({start, kcal: String(kcal), protein: String(protein), fat: '60', carbs: '270'});
  d.put('targets.csv', [t('2026-10-01', 2100, 120), t('2026-11-18', 2300, 140)]);
  let dom = d.page('nutrition.html');
  has(dom, 'Цели за эти 2 недели');
  has(dom, '2&nbsp;300');
  hasNot(dom, 'История целей');
  d.put('targets.csv', [t('2026-10-01', 2100, 120), t('2026-11-18', 2100, 120)]);
  dom = d.page('nutrition.html');
  has(dom, 'Цель по питанию');
  has(dom, 'с 1 окт');
});

test('dashboard without targets', {skip}, () => {
  const d = fatsecret(data());
  d.put('targets.csv', []);
  assert.ok(d.page('dashboard.html').split('<svg').length - 1 >= 2);
});

test('empty nutrition', {skip}, () => {
  has(data().page('nutrition.html'), 'Подключите FatSecret или Whoop');
});


test('escaped: supplements on the dashboard', {skip}, () => {
  const d = data();
  d.put('supplements.csv', [{name: TAG, start: '2026-11-01'}]);
  d.put('body.csv', [{date: '2026-11-10', weight_kg: '75.5'}]);
  const dom = d.page('dashboard.html');
  hasNot(dom, TAG);
  has(dom, '&lt;img');
});

test('escaped: sport name on «Тренировки»', {skip}, () => {
  const d = data();
  d.put('whoop_daily.csv', days(20, {recovery: '60', hrv: '70', rhr: '55'}));
  d.put('whoop_workouts.csv', [{id: '1', date: '2026-11-18', start: '2026-11-18 19:00', sport: TAG, duration_min: '45'}]);
  const dom = d.page('training.html');
  hasNot(dom, TAG);
  has(dom, '&lt;img');
});

test('owner data folder: priorities, workout goal, all menu items', {skip}, t => {
  const dir = dataDir();
  if (!dir || !fs.existsSync(path.join(dir, 'meta.json'))) return t.skip('нет папки данных с meta.json');
  const meta = JSON.parse(fs.readFileSync(path.join(dir, 'meta.json'), 'utf8'));
  const base = site(dir);                                            // настоящие данные — только читаем
  const dom = render(base, 'dashboard.html');
  fs.rmSync(base, {recursive: true, force: true});
  const now = store.read(dir, 'targets.csv').filter(r => r.start <= '2026-11-21').pop() || {};
  if (now.strength_wk) has(dom, `/ ${Number(now.strength_wk) * 4}`);
  has(dom, 'href="training.html"');
  if (store.read(dir, 'plans.csv').length) has(dom, '<h2>План');
});
