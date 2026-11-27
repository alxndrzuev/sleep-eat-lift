// Проверочный набор фото, шаг 1 — поиск фигуры (медленно, результат в кэш). Запускает scripts/photos_bench.js detect:
//   electron desktop/bench/photos_detect.js <jobs.json>
// jobs.json = {cacheDir, params, jobs: [{source, id, file, pose, sha, crops | null, gt?}]}; crops null — свои снимки:
// варианты кадра (scripts/photos_bench_lib.js VARIANTS) режутся по точкам, найденным на целом снимке. Каждый вариант — ещё и
// зеркально. Кэш: <cacheDir>/<source>/<id>__<variant>.json (точки MediaPipe как есть, маска RLE, рамка среза, правильная поза).
// Не часть приложения: main.js это не подключает, в сборку не входит.
'use strict';
const {app, BrowserWindow} = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const B = require('../../scripts/photos_bench_lib.js');

const cfg = JSON.parse(fs.readFileSync(process.argv[process.argv.length - 1], 'utf8'));
const out = (job, variant) => path.join(cfg.cacheDir, job.source, `${job.id}__${variant}.json`);

async function main() {
  const win = new BrowserWindow({show: false, webPreferences: {backgroundThrottling: false}});
  await win.loadFile(path.join(__dirname, 'detect.html'));
  const call = (fn, ...args) => win.webContents.executeJavaScript(`Bench.${fn}(${args.map(a => JSON.stringify(a)).join(', ')})`);
  let fresh = 0, n = 0;
  for (const job of cfg.jobs) {
    n++;
    fs.mkdirSync(path.join(cfg.cacheDir, job.source), {recursive: true});
    const wanted = (job.crops ? job.crops.map(c => c.variant) : B.VARIANTS).flatMap(v => [v, v + '_mirror']);
    if (wanted.every(v => fs.existsSync(out(job, v)))) continue;
    try {
      const {w, h} = await call('load', fs.readFileSync(job.file).toString('base64'), path.basename(job.file));
      const save = (crop, r) => {
        const variant = crop.mirror ? crop.variant + '_mirror' : crop.variant;
        const mask = r.mask && {w: r.mask.w, h: r.mask.h, rle: B.rleEncode(Buffer.from(r.mask.b64, 'base64'))};
        const rec = {key: B.cacheKey({sha: job.sha, variant, params: cfg.params}), source: job.source, id: job.id, variant,
          truth: crop.mirror ? B.truthMirror(job.pose) : job.pose, crop: {x: crop.x, y: crop.y, w: crop.w, h: crop.h, mirror: crop.mirror},
          full: {w, h}, w: r.w, h: r.h, lm: r.lm, mask, ms: r.ms, params: cfg.params, gt: job.gt || null};
        fs.writeFileSync(out(job, variant), JSON.stringify(rec));
        fresh++;
        return rec;
      };
      const both = c => [Object.assign({}, c, {mirror: false}), Object.assign({}, c, {mirror: true})];
      let crops = job.crops;
      if (!crops) {
        // целый снимок — первым: по его точкам режутся остальные варианты
        let full = fs.existsSync(out(job, 'full')) ? JSON.parse(fs.readFileSync(out(job, 'full'), 'utf8')) : null;
        if (!full) {
          const c = {variant: 'full', x: 0, y: 0, w, h, mirror: false};
          full = save(c, (await call('run', [c], cfg.params))[0]);
        }
        const lmPx = full.lm && full.lm.map(p => ({x: p.x * w, y: p.y * h, visibility: p.visibility}));
        crops = B.VARIANTS.map(v => lmPx || v === 'full' ? Object.assign({variant: v}, B.cropBox(v, lmPx, w, h, job.id)) : null)
          .filter(c => c && c.w);
      }
      const todo = crops.flatMap(both).filter(c => !fs.existsSync(out(job, c.mirror ? c.variant + '_mirror' : c.variant)));
      const res = todo.length ? await call('run', todo, cfg.params) : [];
      todo.forEach((c, i) => save(c, res[i]));
      await call('free');
      console.log(`${n}/${cfg.jobs.length} ${job.id}`);
    } catch (e) {
      console.log(`ОШИБКА ${job.id}: ${e.message}`);
      await win.loadFile(path.join(__dirname, 'detect.html'));   // после сбоя wasm страница мертва — заново
    }
  }
  console.log(`готово: ${fresh} новых`);
}

app.whenReady().then(main).catch(e => console.error(e)).finally(() => app.quit());
