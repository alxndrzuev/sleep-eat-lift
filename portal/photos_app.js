// Страница «Фото»: обработка снимков в браузере — HEIC (libheif), поиск фигуры (MediaPipe), выровненный кадр (canvas).
// Библиотеки — portal/vendor/ (scripts/vendor_fetch.py), грузятся только при загрузке/пересборке, по одной, тегами <script>:
// страница открыта с file://, fetch и модули там запрещены. Логика без DOM — photos_core.js.
(function (root) {
  "use strict";
  const C = root.PhotosCore;
  const SELF = document.currentScript && document.currentScript.src;
  const VENDOR_BASE = SELF ? SELF.replace(/[^/]*$/, "vendor/") : "vendor/";
  const VENDOR = ["mediapipe_vision.js", "mediapipe_wasm_loader.js", "mediapipe_wasm.b64.js", "pose_model.b64.js", "libheif.js", "exifr.js"];
  const DETECT_SIDE = 1024;
  let vendorReady = null, heif = null, heifDecoder = null, landmarker = null;

  const b64bytes = s => { const bin = atob(s), u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); return u; };
  const addScript = src => new Promise((ok, fail) => {
    const s = document.createElement("script");
    s.src = src; s.onload = ok; s.onerror = () => fail(new Error("Не загрузилась библиотека " + src.split("/").pop()));
    document.head.appendChild(s);
  });
  const canvas = (w, h) => { const c = document.createElement("canvas"); c.width = w; c.height = h; return c; };
  const toBlob = (c, q) => new Promise((ok, fail) => c.toBlob(b => b ? ok(b) : fail(new Error("Не удалось сохранить JPEG")), "image/jpeg", q));

  /** Подключить библиотеки и создать поиск фигуры (один раз за жизнь страницы). */
  function loadVendor() {
    return vendorReady = vendorReady || (async () => {
      for (const f of VENDOR) await addScript(VENDOR_BASE + f);
      heif = await root.libheif();
      // загрузчик wasm подключён своим тегом (у MediaPipe тег с crossOrigin — с file:// не грузится), сам wasm — Blob URL
      const wasm = URL.createObjectURL(new Blob([b64bytes(root.VENDOR_B64.vision_wasm)], {type: "application/wasm"}));
      landmarker = await root.Vision.PoseLandmarker.createFromOptions({wasmLoaderPath: "", wasmBinaryPath: wasm}, {
        baseOptions: {modelAssetBuffer: b64bytes(root.VENDOR_B64.pose_model), delegate: "CPU"}, runningMode: "IMAGE", numPoses: 1,
        outputSegmentationMasks: true});
      URL.revokeObjectURL(wasm);
      delete root.VENDOR_B64.vision_wasm; delete root.VENDOR_B64.pose_model;   // ~30 МБ строк больше не нужны
    })().catch(e => { vendorReady = null; throw e; });
  }

  const isHeic = file => /\.(heic|heif)$/i.test(file.name || "") || /hei[cf]/i.test(file.type || "");

  /** Файл → картинка с учётом поворота: {img: canvas | ImageBitmap, w, h}. После работы — release(img). */
  async function decode(file) {
    if (!isHeic(file)) {
      const bmp = await createImageBitmap(file, {imageOrientation: "from-image"});
      return {img: bmp, w: bmp.width, h: bmp.height};
    }
    await loadVendor();
    // один декодер на страницу и контекст освобождается сразу: libheif-js сам освобождает контекст только при следующем
    // decode того же декодера — новый HeifDecoder на каждый снимок оставлял в wasm-куче по копии файла
    const dec = heifDecoder = heifDecoder || new heif.HeifDecoder();
    const list = dec.decode(new Uint8Array(await file.arrayBuffer()));
    const data = await (async () => {
      try {
        if (!list.length) throw new Error("HEIC не читается");
        const im = list.find(x => x.is_primary()) || list[0], d = new ImageData(im.get_width(), im.get_height());
        await new Promise((ok, fail) => im.display(d, r => r ? ok() : fail(new Error("HEIC не раскладывается"))));
        return d;
      } finally {
        list.forEach(x => x.free());
        if (dec.decoder) { heif.heif_context_free(dec.decoder); dec.decoder = null; }
      }
    })();
    const w = data.width, h = data.height;
    const c = canvas(w, h);
    c.getContext("2d").putImageData(data, 0, 0);
    return {img: c, w, h};
  }

  function release(img) {
    if (!img) return;
    if (img.close) img.close(); else { img.width = 0; img.height = 0; }
  }

  /** Опорные точки фигуры в пикселях снимка (+ макушка, подошвы, центр корпуса по маске) или null (фигура не найдена). */
  async function detect(img) {
    await loadVendor();
    const k = Math.min(1, DETECT_SIDE / Math.max(img.width, img.height));
    const c = canvas(Math.round(img.width * k), Math.round(img.height * k));
    c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
    const res = landmarker.detect(c);
    release(c);
    const masks = (res && res.segmentationMasks) || [];
    try {
      const lm = res && res.landmarks && res.landmarks[0];
      const kp = lm ? C.keypointsFromLandmarks(lm, img.width, img.height) : null;
      if (!kp || !masks[0]) return kp;
      // маска — в размере уменьшенной копии: точки туда, силуэт обратно в пиксели снимка
      const m = masks[0], sx = m.width / img.width, sy = m.height / img.height;
      const to = a => a && [a[0] * sx, a[1] * sy];
      const sil = C.silhouette(m.getAsFloat32Array(), m.width, m.height,
        {head: to(kp.head), neck: to(kp.neck), root: to(kp.root), ankle: to(kp.ankle), feet: kp.feet && [kp.feet[0] * sx, kp.feet[1] * sx]});
      const back = a => a && [Math.round((a[0] + 0.5) / sx * 10) / 10, Math.round((a[1] + 0.5) / sy * 10) / 10];
      return Object.assign(kp, {crown: back(sil.crown), sole: back(sil.sole), cx: sil.cx === null ? null : Math.round((sil.cx + 0.5) / sx * 10) / 10});
    } finally { masks.forEach(x => x.close && x.close()); }
  }

  /** Выровненный кадр FRAME.W×FRAME.H (× scale — для превью) по матрице из PhotosCore.alignAll (поворот + масштаб) → JPEG. */
  async function renderAligned(img, tf, scale = 1, quality = 0.9) {
    const F = C.FRAME, c = canvas(Math.round(F.W * scale), Math.round(F.H * scale)), ctx = c.getContext("2d");
    ctx.fillStyle = F.BG; ctx.fillRect(0, 0, c.width, c.height);
    ctx.imageSmoothingQuality = "high";
    ctx.setTransform(tf.a * scale, tf.b * scale, tf.c * scale, tf.d * scale, tf.e * scale, tf.f * scale);
    ctx.drawImage(img, 0, 0);
    try { return await toBlob(c, quality); } finally { release(c); }
  }

  /** Уменьшенная копия (длинная сторона ≤ maxSide) → JPEG. */
  async function renderScaled(img, maxSide, quality) {
    const k = Math.min(1, maxSide / Math.max(img.width, img.height));
    const c = canvas(Math.round(img.width * k), Math.round(img.height * k)), ctx = c.getContext("2d");
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(img, 0, 0, c.width, c.height);
    try { return await toBlob(c, quality); } finally { release(c); }
  }

  /** Отпечаток файла (SHA-256, hex) — узнать тот же файл при повторной загрузке. */
  async function sha256(file) {
    const h = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
    return [...new Uint8Array(h)].map(b => b.toString(16).padStart(2, "0")).join("");
  }

  /** Дата съёмки из EXIF (HEIC/JPEG) или null. */
  async function readExif(file) {
    await loadVendor();
    try {
      const x = await root.exifr.parse(file, {tiff: true, exif: true, xmp: false});
      return (x && (x.DateTimeOriginal || x.CreateDate)) || null;
    } catch (e) { return null; }
  }

  // ---------- папка data/photos внутри проекта (File System Access API; ссылка на папку — в IndexedDB) ----------

  const DB = "health-photos";
  let dirOverride = null;
  const idb = () => new Promise((ok, fail) => {
    const q = indexedDB.open(DB, 1);
    q.onupgradeneeded = () => q.result.createObjectStore("handles");
    q.onsuccess = () => ok(q.result); q.onerror = () => fail(q.error);
  });
  async function idbDo(mode, fn) {
    const db = await idb();
    try {
      return await new Promise((ok, fail) => {
        const t = db.transaction("handles", mode), q = fn(t.objectStore("handles"));
        t.oncomplete = () => ok(q.result); t.onerror = () => fail(t.error);
      });
    } finally { db.close(); }
  }
  const idbGet = k => idbDo("readonly", s => s.get(k)).catch(() => null);
  const idbSet = (k, v) => idbDo("readwrite", s => s.put(v, k));

  /** Для проверок: писать в эту папку (например, OPFS), минуя выбор. */
  function useDirectory(handle) { dirOverride = handle; }

  /** Забыть папку; прежнюю выбранную оставить как «last» — следующее окно выбора откроется сразу в ней. */
  async function forgetDir() {
    dirOverride = null;
    const saved = await idbGet("dir");
    const rootH = saved && (saved.kind ? saved : saved.root);
    if (rootH) await idbSet("last", rootH).catch(() => null);
    await idbDo("readwrite", s => s.delete("dir")).catch(() => null);
  }

  /** Папка уже выбрана (тогда Chrome максимум переспросит доступ), иначе нужен шаг «Где сохранять». */
  async function hasDir() { return !!dirOverride || !!appDir() || !!(await idbGet("dir")); }

  /** В приложении SEL папка фото известна заранее (data/photos пользователя) — выбор не нужен. */
  function appDir() { return root.PhotosFs ? root.PhotosFs.root() : null; }

  /** Спуститься от выбранной папки по пути (data → photos), создавая недостающие папки. */
  async function descend(h, path) {
    for (const part of path) h = await h.getDirectoryHandle(part, {create: true});
    return h;
  }

  /** Куда писать от выбранной папки: путь по PhotosCore.resolveFolder (папка проекта → data/photos) или null. */
  async function targetPath(h) {
    const kids = [];
    for await (const [n] of h.entries()) kids.push(n);
    return C.resolveFolder(h.name, kids);
  }

  /**
   * Папка для записи фото. interactive — можно спросить доступ / открыть выбор (только из обработчика клика).
   * Выбрать можно папку проекта (sleep-eat-lift), data или саму photos — фото всё равно лягут в data/photos (PhotosCore.resolveFolder).
   * В IndexedDB — выбранная папка; куда писать от неё, считается каждый раз заново (в т.ч. для выбора в прежнем формате).
   * Другую папку не принимаем: сохранённое туда страница не увидит.
   */
  async function getDir({interactive}) {
    if (dirOverride) return dirOverride;
    if (appDir()) return appDir();
    const saved = await idbGet("dir");
    const rootH = saved && (saved.kind ? saved : saved.root);           // прежний формат — сама папка
    if (rootH) {
      let perm = await rootH.queryPermission({mode: "readwrite"});
      if (perm !== "granted") {
        if (!interactive) return null;
        perm = await rootH.requestPermission({mode: "readwrite"});
      }
      if (perm !== "granted") return null;
      const r = await targetPath(rootH);
      if (r.path) return descend(rootH, r.path);
      await forgetDir();                                                  // запомнена не та папка — спросить заново
      if (!interactive) return null;
    }
    if (!interactive) return null;
    if (!root.showDirectoryPicker) throw new Error("Этот браузер не умеет сохранять в папку — откройте страницу в Chrome или Edge.");
    // окно выбора — сразу в прежней папке проекта, если она была (иначе — «Документы»; путь к проекту страница подсказывает)
    const last = await idbGet("last");
    let picked;
    for (const startIn of last ? [last, "documents"] : ["documents"]) {
      try { picked = await root.showDirectoryPicker({id: "health-project", mode: "readwrite", startIn}); break; }
      catch (e) { if (e.name === "AbortError") return null; if (startIn === "documents") throw e; }   // прежней папки нет — с «Документов»
    }
    const r = await targetPath(picked);
    if (!r.path) { alert(r.warn); return null; }
    await idbSet("dir", {root: picked});
    await idbSet("last", picked).catch(() => null);
    return descend(picked, r.path);
  }

  async function fileIn(dir, path, create) {
    const parts = path.split("/");
    let d = dir;
    for (const p of parts.slice(0, -1)) d = await d.getDirectoryHandle(p, {create});
    return d.getFileHandle(parts[parts.length - 1], {create});
  }
  async function writeFile(dir, path, data) {
    const w = await (await fileIn(dir, path, true)).createWritable();
    await w.write(data); await w.close();
  }
  async function removeFile(dir, path) {
    const parts = path.split("/");
    try {
      let d = dir;
      for (const p of parts.slice(0, -1)) d = await d.getDirectoryHandle(p);
      await d.removeEntry(parts[parts.length - 1]);
    } catch (e) { /* нет файла — и не надо */ }
  }

  const INDEX_HEAD = "// Собрано страницей portal/photos.html — не править руками\nwindow.PHOTOS_INDEX = ";
  /** Индекс из папки (photos.js); нет — пустой. */
  async function readIndex(dir) {
    try {
      const text = await (await (await fileIn(dir, "photos.js", false)).getFile()).text();
      const m = /PHOTOS_INDEX\s*=\s*([\s\S]*?);\s*$/.exec(text);
      if (m) return JSON.parse(m[1]);
    } catch (e) { /* нет индекса */ }
    return {version: 1, photos: {}};
  }
  async function writeIndex(dir, index) {
    index.folder_id = index.folder_id || (crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random());
    try { await fileIn(dir, ".gitignore", false); }                  // фото — только на этом компьютере, в git не попадают
    catch (e) { await writeFile(dir, ".gitignore", "# фото формы — только на этом компьютере, в git не попадают (пишет страница portal/photos.html)\n*\n"); }
    await writeFile(dir, "photos.js", INDEX_HEAD + JSON.stringify(index) + ";\n");
    return index;
  }

  const extOf = file => {
    const m = /\.([A-Za-z0-9]+)$/.exec(file.name || "");
    if (m) return m[1].toLowerCase().replace("jpeg", "jpg");
    return /hei[cf]/i.test(file.type) ? "heic" : /png/.test(file.type) ? "png" : "jpg";
  };

  /**
   * Обработать снимки и записать в папку: оригинал (если upload), view/, aligned/ (если найдена фигура), thumbs/.
   * entries: [{name, date, pose, file, upload}]; index меняется на месте. Сначала точки фигуры по всем снимкам, потом
   * общая подгонка позы (PhotosCore.alignAll), потом отрисовка — каждый снимок читается дважды. Строго по одному: память.
   */
  async function processBatch(dir, entries, index, onProgress) {
    const v = Date.now(), failed = [], thumbScale = 240 / C.FRAME.H;
    const say = (i, what) => onProgress && onProgress(`${i + 1} из ${entries.length}: ${what}`, i, entries.length);
    // 1) оригинал, точки фигуры, view — по одному снимку
    for (let i = 0; i < entries.length; i++) {
      const e = entries[i];
      let d = null;
      try {
        const old = index.photos[e.name];
        if (e.upload) {
          say(i, "сохраняю оригинал");
          const original = `originals/${e.name}.${extOf(e.file)}`;
          await writeFile(dir, original, e.file);
          if (old && old.original && old.original !== original) await removeFile(dir, old.original);
          e.original = original;
        }
        say(i, "читаю снимок");
        const sha = await sha256(e.file), shot = await readExif(e.file);   // чтобы узнать те же снимки при повторной загрузке
        d = await decode(e.file);
        say(i, "ищу фигуру");
        const kp = await detect(d.img);
        await writeFile(dir, `view/${e.name}.jpg`, await renderScaled(d.img, 2400, 0.85));
        index.photos[e.name] = {date: e.date, pose: e.pose, original: e.original || (old && old.original), kp, by: null, feet_cut: false, v,
                                sha, shot: shot ? shot.getTime() : null};
        if (!kp) {
          await removeFile(dir, `aligned/${e.name}.jpg`);
          await writeFile(dir, `thumbs/${e.name}.jpg`, await renderScaled(d.img, 240, 0.8));
        } else e.ok = true;
      } catch (err) {
        failed.push({name: e.name, error: String(err && err.message || err)});
      } finally { if (d) release(d.img); }
    }
    // 2) общая подгонка позы — по всем снимкам в папке (новые подстраиваются под шаблон, старые не перерисовываются)
    const tfs = C.alignAll(Object.entries(index.photos).map(([name, p]) => ({name, pose: p.pose, kp: p.kp})));
    const todo = entries.filter(e => e.ok && tfs[e.name]);
    for (let i = 0; i < todo.length; i++) {
      const e = todo[i], tf = tfs[e.name], p = index.photos[e.name];
      onProgress && onProgress(`Выравниваю: ${i + 1} из ${todo.length}`, i, todo.length);
      let d = null;
      try {
        d = await decode(e.file);
        await writeFile(dir, `aligned/${e.name}.jpg`, await renderAligned(d.img, tf));
        await writeFile(dir, `thumbs/${e.name}.jpg`, await renderAligned(d.img, tf, thumbScale, 0.8));
        Object.assign(p, {by: tf.by, feet_cut: tf.feet_cut, s: Math.round(tf.s * 1e5) / 1e5, th: Math.round(tf.th * 1e5) / 1e5});
      } catch (err) {
        p.kp = null;     // без выровненной версии — страница покажет view
        failed.push({name: e.name, error: String(err && err.message || err)});
      } finally { if (d) release(d.img); }
    }
    return {failed, noFigure: entries.filter(e => index.photos[e.name] && !index.photos[e.name].kp && !failed.some(f => f.name === e.name)).map(e => e.name)};
  }

  /** Удалить снимок из папки: оригинал, view, aligned, thumbs и запись в индексе → новый индекс. */
  async function removePhoto(dir, name) {
    const index = await readIndex(dir), p = index.photos[name];
    if (p && p.original) await removeFile(dir, p.original);
    for (const sub of ["view", "aligned", "thumbs"]) await removeFile(dir, `${sub}/${name}.jpg`);
    delete index.photos[name];
    return writeIndex(dir, index);
  }

  /** Загрузка: rows [{file, date, pose}] (уже без «не сохранять» и без отказа заменять). */
  async function saveSeries(dir, rows, onProgress) {
    const index = await readIndex(dir);
    const entries = rows.map(r => ({name: `${r.date}_${r.pose}`, date: r.date, pose: r.pose, file: r.file, upload: true}));
    const res = await processBatch(dir, entries, index, onProgress);
    return Object.assign(res, {index: await writeIndex(dir, index), saved: entries.length - res.failed.length});
  }

  /** Пересобрать всё из originals/: точки, view, aligned, thumbs, индекс (folder_id сохраняется). */
  async function rebuildAll(dir, onProgress) {
    const old = await readIndex(dir), index = {version: 1, folder_id: old.folder_id, photos: {}}, entries = [], skipped = [];
    let orig;
    try { orig = await dir.getDirectoryHandle("originals"); } catch (e) { throw new Error("В папке нет originals/ — пересобирать нечего"); }
    for await (const [fname, h] of orig.entries()) {
      if (h.kind !== "file" || fname.startsWith(".")) continue;
      const n = C.parseName(fname);
      if (!n) { skipped.push(fname); continue; }
      const name = `${n.date}_${n.pose}`;
      if (entries.some(e => e.name === name)) { skipped.push(fname); continue; }
      entries.push({name, date: n.date, pose: n.pose, file: await h.getFile(), original: `originals/${fname}`, upload: false});
    }
    entries.sort((a, b) => a.name < b.name ? -1 : 1);
    const res = await processBatch(dir, entries, index, onProgress);
    return Object.assign(res, {index: await writeIndex(dir, index), saved: entries.length - res.failed.length, skipped});
  }

  /** Диагностика: сколько памяти занял декодер HEIC (байт wasm-кучи). */
  const memory = () => ({heif: heif ? heif.HEAPU8.length : 0});

  root.PhotosApp = Object.assign(root.PhotosApp || {}, {loadVendor, decode, release, detect, renderAligned, renderScaled, readExif,
    getDir, hasDir, forgetDir, useDirectory, readIndex, writeIndex, saveSeries, rebuildAll, removePhoto, sha256, memory});
})(window);
