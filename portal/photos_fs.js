/* Папка фото в приложении SEL (desktop/): то же подмножество FileSystemDirectoryHandle, которым пользуется
   photos_app.js, но поверх window.health.photos (файлы только внутри data/photos). В Chrome не используется. */
var PhotosFs = (function () {
  const notFound = p => (typeof DOMException !== "undefined" ? new DOMException("Нет: " + p, "NotFoundError")
                                                              : Object.assign(new Error("Нет: " + p), {name: "NotFoundError"}));
  const join = (a, b) => (a ? a + "/" + b : b);
  const isNF = e => e && (e.code === "NotFoundError" || /NotFoundError/.test(e.message || ""));

  async function bytes(data) {
    if (typeof data === "string") return new TextEncoder().encode(data);
    if (data instanceof ArrayBuffer) return new Uint8Array(data);
    if (ArrayBuffer.isView(data)) return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
    if (data && typeof data.arrayBuffer === "function") return new Uint8Array(await data.arrayBuffer());
    if (data && data.type === "write") return bytes(data.data);
    throw new Error("Неизвестные данные для записи");
  }

  function fileHandle(api, p, name) {
    return {
      kind: "file", name,
      async getFile() {
        try { const b = await api.read(p); return new File([b], name); }
        catch (e) { if (isNF(e)) throw notFound(p); throw e; }
      },
      async createWritable() {
        const chunks = [];
        return {write: async d => { chunks.push(await bytes(d)); },
                close: async () => {
                  const n = chunks.reduce((s, c) => s + c.length, 0), out = new Uint8Array(n);
                  let o = 0; for (const c of chunks) { out.set(c, o); o += c.length; }
                  await api.write(p, out);
                }};
      },
    };
  }

  function dirHandle(api, p, name) {
    return {
      kind: "directory", name,
      queryPermission: async () => "granted",
      requestPermission: async () => "granted",
      async getDirectoryHandle(n, opt = {}) {
        const q = join(p, n), k = await api.exists(q);
        if (k === "file") throw new TypeError("Это файл: " + q);
        if (!k) { if (!opt.create) throw notFound(q); await api.mkdir(q); }
        return dirHandle(api, q, n);
      },
      async getFileHandle(n, opt = {}) {
        const q = join(p, n), k = await api.exists(q);
        if (k === "directory") throw new TypeError("Это папка: " + q);
        if (!k) { if (!opt.create) throw notFound(q); await api.write(q, new Uint8Array(0)); }
        return fileHandle(api, q, n);
      },
      async removeEntry(n) {
        try { await api.remove(join(p, n)); }
        catch (e) { if (isNF(e)) throw notFound(join(p, n)); throw e; }
      },
      async *entries() {
        for (const e of await api.list(p))
          yield [e.name, e.kind === "directory" ? dirHandle(api, join(p, e.name), e.name) : fileHandle(api, join(p, e.name), e.name)];
      },
    };
  }

  /** Корень — data/photos пользователя; null вне приложения. */
  function root() {
    const api = typeof window !== "undefined" && window.health && window.health.photos;
    return api ? dirHandle(api, "", "photos") : null;
  }

  return {root};
})();
if (typeof window !== "undefined") window.PhotosFs = PhotosFs;
