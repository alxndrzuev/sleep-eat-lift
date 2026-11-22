#!/usr/bin/env python3
"""Библиотеки для страницы «Фото» → portal/vendor/ (всё внутри портала: без CDN и интернета во время работы).

    python3 scripts/vendor_fetch.py           # скачать фиксированные версии, проверить хэши, упаковать
    python3 scripts/vendor_fetch.py --check   # только сверить уже лежащие файлы с README (sha256)

Страница открывается с диска (file://): Chrome не даёт ей fetch/XHR и ES-модули, работает только <script src>.
Поэтому всё — classic-script .js; двоичные файлы (wasm, модель) — base64 в self.VENDOR_B64.<ключ>.
Что получается (глобальные имена — для portal/photos_app.js):
  mediapipe_vision.js       → Vision {FilesetResolver, PoseLandmarker, …}   @mediapipe/tasks-vision, Apache-2.0
  mediapipe_wasm_loader.js  → ModuleFactory (загрузчик wasm; подключается до создания PoseLandmarker)
  mediapipe_wasm.b64.js     → VENDOR_B64.vision_wasm
  pose_model.b64.js         → VENDOR_B64.pose_model (pose_landmarker_full.task, Google, Apache-2.0)
  libheif.js                → libheif (фабрика; wasm уже внутри)                libheif-js, LGPL-3.0
  exifr.js                  → exifr {parse}                                      exifr (lite), MIT
Тексты лицензий — portal/vendor/LICENSES/. Обновить версию: поменять PACKAGES/MODEL ниже (новый integrity/sha256).
"""
import sys, io, json, base64, hashlib, tarfile, urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "portal" / "vendor"
UA = {"User-Agent": "health-portal-vendor/1.0"}

PACKAGES = {  # пакет npm: (версия, integrity из registry.npmjs.org)
    "@mediapipe/tasks-vision": ("1.2.3", "sha512-sxJyfhbN+EamexhaaCmUlw7v8vWWMum7VDsORe6d4c8Dk/xlI4qiIgoSw9cE9hpvYhVRRVLIA8y605FbqWkNeQ=="),
    "libheif-js": ("1.23.5", "sha512-umXZPthnWZtF3iG/5mQG+AZ2V6i0UeYpo3z2CkggTEgL8dKmIIwJT6TDuAMuabXa1yTW8uJ1ZAgR+CxNTklYYw=="),
    "exifr": ("7.1.3", "sha512-g/aje2noHivrRSLbAUtBPWFbxKdKhgj/xr1vATDdUXPOFYJlQ62Ft0oy+72V6XLIpDJfHs6gXLbBLAolqOXYRw=="),
}
MODEL = ("https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_full/float16/latest/pose_landmarker_full.task",
         "4eaa5eb7a98365221087693fcc286334cf0858e2eb6e15b506aa4a7ecdcec4ad")

# (пакет, файл в тарболе, что сделать, имя в vendor/ или ключ VENDOR_B64)
FILES = [
    ("@mediapipe/tasks-vision", "vision_bundle.js", "js", "mediapipe_vision.js"),
    ("@mediapipe/tasks-vision", "wasm/vision_wasm_internal.js", "js", "mediapipe_wasm_loader.js"),
    ("@mediapipe/tasks-vision", "wasm/vision_wasm_internal.wasm", "b64", "vision_wasm"),
    ("libheif-js", "libheif-wasm/libheif-bundle.js", "js", "libheif.js"),
    ("exifr", "dist/lite.umd.js", "js", "exifr.js"),
]
LICENSES = [("libheif-js", "LICENSE", "libheif-js.txt"), ("libheif-js", "libheif-wasm/LICENSE", "libheif.txt"),
            ("exifr", "LICENSE", "exifr.txt")]
APACHE = ("{what}\nLicensed under the Apache License, Version 2.0 (the \"License\"); you may not use this file except in compliance\n"
          "with the License. You may obtain a copy of the License at http://www.apache.org/licenses/LICENSE-2.0\n"
          "Unless required by applicable law or agreed to in writing, software distributed under the License is distributed\n"
          "on an \"AS IS\" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.\n")


def get(url):
    with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=120) as r:
        return r.read()


def tarball(pkg):
    ver, integrity = PACKAGES[pkg]
    raw = get(f"https://registry.npmjs.org/{pkg}/-/{pkg.split('/')[-1]}-{ver}.tgz")
    algo, want = integrity.split("-", 1)
    got = base64.b64encode(hashlib.new(algo, raw).digest()).decode()
    if got != want:
        sys.exit(f"ОШИБКА: {pkg}@{ver}: integrity не совпал")
    tf = tarfile.open(fileobj=io.BytesIO(raw), mode="r:gz")
    return {m.name.split("/", 1)[1]: tf.extractfile(m).read() for m in tf.getmembers() if m.isfile()}


def strip_map(text):
    """Убрать ссылку на .map (файла карты нет — Chrome будет ругаться в консоли)."""
    return "\n".join(l for l in text.splitlines() if not l.startswith("//# sourceMappingURL=")) + "\n"


def b64_js(key, data):
    return f"(self.VENDOR_B64=self.VENDOR_B64||{{}}).{key}=\"{base64.b64encode(data).decode()}\";\n"


def sha(p):
    return hashlib.sha256(p.read_bytes()).hexdigest()


def fetch():
    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / "LICENSES").mkdir(exist_ok=True)
    tars = {p: tarball(p) for p in PACKAGES}
    written = []
    for pkg, src, kind, dst in FILES:
        data = tars[pkg][src]
        if kind == "js":
            out = OUT / dst
            out.write_text(strip_map(data.decode("utf-8")), encoding="utf-8")
        else:
            out = OUT / ("mediapipe_wasm.b64.js" if dst == "vision_wasm" else dst + ".b64.js")
            out.write_text(b64_js(dst, data), encoding="ascii")
        written.append((out, f"{pkg}@{PACKAGES[pkg][0]}/{src}"))
    model = get(MODEL[0])
    if hashlib.sha256(model).hexdigest() != MODEL[1]:
        sys.exit("ОШИБКА: модель pose_landmarker_full.task: sha256 не совпал (Google обновил latest?) — проверить и обновить MODEL")
    out = OUT / "pose_model.b64.js"
    out.write_text(b64_js("pose_model", model), encoding="ascii")
    written.append((out, "pose_landmarker_full.task (" + MODEL[0] + ")"))
    for pkg, src, dst in LICENSES:
        (OUT / "LICENSES" / dst).write_bytes(tars[pkg][src])
    (OUT / "LICENSES" / "mediapipe.txt").write_text(APACHE.format(
        what="@mediapipe/tasks-vision и модель pose_landmarker_full.task — Copyright Google LLC (MediaPipe)."), encoding="utf-8")
    lines = ["# portal/vendor — библиотеки страницы «Фото»", "",
             "Собрано `scripts/vendor_fetch.py` — не править руками. Проверка: `python3 scripts/vendor_fetch.py --check`.", "",
             "| файл | источник | sha256 |", "|---|---|---|"]
    lines += [f"| {o.name} | {s} | {sha(o)} |" for o, s in written]
    (OUT / "README.md").write_text("\n".join(lines) + "\n", encoding="utf-8")
    total = sum(o.stat().st_size for o, _ in written)
    print(f"OK -> portal/vendor ({len(written)} файлов, {total / 1e6:.1f} МБ)")


def check():
    bad = 0
    for line in (OUT / "README.md").read_text(encoding="utf-8").splitlines():
        parts = [p.strip() for p in line.strip("|").split("|")]
        if len(parts) == 3 and len(parts[2]) == 64:
            p = OUT / parts[0]
            if not p.exists() or sha(p) != parts[2]:
                print(f"⚠ {parts[0]}: нет или изменён")
                bad += 1
    print("OK" if not bad else f"Изменено/нет: {bad}")
    return bad


if __name__ == "__main__":
    if "--check" in sys.argv:
        sys.exit(1 if check() else 0)
    fetch()
