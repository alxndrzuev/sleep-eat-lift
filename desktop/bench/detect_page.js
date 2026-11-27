// Проверочный набор фото: страница поиска фигуры (окно без показа, desktop/bench/photos_detect.js).
// Снимок декодируется один раз (PhotosApp.decode — HEIC и поворот как в приложении), дальше — варианты кадра.
(function (root) {
  "use strict";
  let img = null;

  /** Снимок (base64) → в память страницы; {w, h} уже повёрнутой картинки. */
  async function load(b64, name) {
    free();
    const bin = atob(b64), u = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
    const d = await PhotosApp.decode(new File([u], name));
    img = d.img;
    return {w: d.w, h: d.h};
  }

  function free() { if (img) PhotosApp.release(img); img = null; }

  /** Варианты кадра [{variant, x, y, w, h, mirror}] → [{variant, w, h, lm, mask: {w, h, b64} | null, ms}]; маска — 0/1 байтами. */
  async function run(crops, params) {
    const out = [];
    for (const cr of crops) {
      const c = document.createElement("canvas");
      c.width = cr.w; c.height = cr.h;
      const ctx = c.getContext("2d");
      if (cr.mirror) ctx.setTransform(-1, 0, 0, 1, cr.w, 0);
      ctx.drawImage(img, -cr.x, -cr.y);
      const r = await PhotosApp.detectRaw(c, {side: params.side, minDetect: params.minDetect});
      c.width = 0; c.height = 0;
      let mask = null;
      if (r.mask) {
        const bytes = new Uint8Array(r.mask.data.length);
        for (let i = 0; i < bytes.length; i++) bytes[i] = r.mask.data[i] > 0.5 ? 1 : 0;
        let s = "";
        for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
        mask = {w: r.mask.w, h: r.mask.h, b64: btoa(s)};
      }
      out.push({variant: cr.variant, w: cr.w, h: cr.h, lm: r.lm && r.lm.map(p => ({x: p.x, y: p.y, z: p.z, visibility: p.visibility})), mask, ms: r.ms});
    }
    return out;
  }

  root.Bench = {load, free, run};
})(window);
