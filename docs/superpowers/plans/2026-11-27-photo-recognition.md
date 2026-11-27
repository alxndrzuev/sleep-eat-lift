# Фото: распознавание при обрезанном кадре и непривычных позах — план

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** проверочный набор фото с отчётом в цифрах и, по нему, распознавание позы и выравнивание, которые держатся на плечах, тазе и коленях — при обрезанной голове/стопах и непривычных позах (сбоку с руками вперёд → «Сбоку»).

**Architecture:** поиск фигуры (MediaPipe) в Electron без окна → кэш сырых точек и маски в `~/Documents/SEL/photo-bench/cache`; оценка в Node прогоняет кэш через текущий `portal/photos_core.js` и пишет отчёт. Перевод «сырой результат MediaPipe → опорные точки» переезжает в `PhotosCore.figureFromDetection`, чтобы приложение и проверка шли одним путём. Правки распознавания — в `photos_core.js` по цифрам отчёта.

**Tech Stack:** Node 26 (`node:test`, без зависимостей), Electron из `desktop/node_modules`, MediaPipe tasks-vision 1.2.3 из `portal/vendor/`, `unzip` macOS.

**Spec:** `docs/superpowers/specs/2026-11-27-photo-recognition-design.md`

## Global Constraints

- Фото, нарезка, точки тела пользователя и публичные фото — только в `~/Documents/SEL/photo-bench/` (переменная `PHOTO_BENCH`), никогда в git; `node scripts/public_check.js` перед каждым коммитом.
- Оригиналы пользователя — только чтение (`profiles/<id>/photos/originals`, индекс `photos.js` = `window.PHOTOS_INDEX = {...}`); нарезка — в памяти, на диск не пишется.
- `report.md` — только сводные цифры и имена публичных снимков, без координат точек пользователя.
- Скачивание COCO — только после «да» пользователя в чате (имя, источник, размер): `annotations_trainval2017.zip`, 241 МБ, `http://images.cocodataset.org/annotations/annotations_trainval2017.zip`; снимки — поштучно по `coco_url`.
- Планка «готово» (свои снимки): поза верна в 100 % найденных; фигура найдена `full` 100 %, `no_feet`/`no_head`/`core` ≥ 95 %, `tight` ≥ 90 %; сдвиг выравнивания медиана ≤ 25 px, p90 ≤ 50 px; 65 полных — поза та же, сдвиг против baseline ≤ 5 px. Публичные: поза ≥ 90 % среди не-`unclear`; сбоку с руками вперёд — «Сбоку» ≥ 95 %.
- Список поз (`POSES`) не меняется; новых поз не заводим.
- Комментарии и тексты — по-русски, в стиле файла; после правок — `cd desktop && npm test` (страницы — `RENDER=1 npm test`).
- `desktop/bench/` не подключается из `main.js` и не попадает в `build.files`.
- Заметное пользователю изменение — пункт в «Не выпущено» `desktop/CHANGELOG.md` в том же коммите.

## Review Focus

- **Снимок, где MediaPipe перепутал левое и правое (без лица):** ожидается не «Спереди» вместо «Сзади» молча — признаки z/маски должны переголосовать; тест в Task 7 (`lm` с переставленными сторонами и z, указывающим на «спиной»).
- **Поза, все снимки которой обрезаны (ни одного полного):** выравнивание всё равно по точкам, а не «корпус» с разбросом; тест в Task 8.
- **Сбоку с руками вперёд на высоте плеч:** центр корпуса по маске не уезжает к рукам; тест в Task 8 (маска с горизонтальной рукой).
- **HEIC с поворотом и JPEG без EXIF в проверке:** нарезка считается в координатах уже повёрнутой картинки; проверка в Task 3 (рамка `no_head` на HEIC-снимке не режет плечи — `kp.neck` найден).
- **Кэш от другой модели/параметров:** не подмешивается в отчёт; тест в Task 2 (`cacheKey` различается при разных `params`).

---

### Task 1: `PhotosCore.figureFromDetection` — один путь «MediaPipe → опорные точки»

**Files:**
- Modify: `portal/photos_core.js` (новая функция рядом с `silhouette`, экспорт)
- Modify: `portal/photos_app.js:74-97` (`detect` → `detectRaw` + `figureFromDetection`; экспорт `detectRaw`)
- Test: `desktop/test/portal_photos.test.js`

**Interfaces:**
- Produces: `PhotosCore.figureFromDetection(det, w, h) -> kp | null`, где `det = {lm: [{x, y, z, visibility}] ×33 (нормированные), mask: {w, h, data: ArrayLike 0…1} | null}`; результат тот же, что у нынешнего `PhotosApp.detect` (kp + `crown`, `sole`, `cx`).
- Produces: `PhotosApp.detectRaw(img, opts = {}) -> Promise<{lm, mask: {w, h, data: Float32Array} | null, ms}>`, `opts.side` (по умолчанию `DETECT_SIDE` = 1024), `opts.minDetect` (по умолчанию не задан = порог MediaPipe по умолчанию). `PhotosApp.detect(img)` = `figureFromDetection(await detectRaw(img), img.width, img.height)`.

- [ ] **Step 1: тест** `test('figure from detection: same as landmarks + silhouette, mask scaled to the photo', …)` — снимок 200×400, маска `mask(100, 200, BODY)` (половинный размер), `lm` из точек, соответствующих `MKP`×2/нормированных; ожидать: `kp.neck` = точка из lm в пикселях снимка; `kp.crown[1]` = 21 (верх головы в маске y = 10 → (10 + 0.5)·2; кулак на y = 2 не в счёт); `kp.sole[1]` = 361 ((180 + 0.5)·2); `mask: null` → kp без `crown`/`sole`/`cx` (как сейчас: `return kp`); `lm: null` → `null`.
- [ ] **Step 2:** `cd desktop && node --test test/portal_photos.test.js` → FAIL «figureFromDetection is not a function».
- [ ] **Step 3:** перенести тело `detect` (после `landmarker.detect`) в `figureFromDetection`; `detectRaw` копирует маску в `Float32Array` до `close()`, меряет `ms` (`performance.now()`); `minDetect` → пересоздание landmarker с `minPoseDetectionConfidence` только если отличается от текущего.
- [ ] **Step 4:** `node --test test/portal_photos.test.js` → PASS; `npm test` → PASS.
- [ ] **Step 5:** проверить приложение без клика: `HEALTH_SMOKE=1 HEALTH_PAGE=photos.html npx electron .` — страница открывается без ошибок в консоли.
- [ ] **Step 6:** commit «Фото: перевод результата MediaPipe в опорные точки — PhotosCore.figureFromDetection (одним путём для приложения и проверки)».

### Task 2: библиотека проверки — нарезка, кэш, своя разметка

**Files:**
- Create: `scripts/photos_bench_lib.js` (чистые функции, `require('../portal/photos_core.js')` ставит `globalThis.PhotosCore`)
- Test: `desktop/test/photos_bench.test.js`

**Interfaces:**
- Produces:
  - `VARIANTS = ['full', 'no_feet', 'no_head', 'core', 'tight']`; вариант с зеркалом — суффикс `_mirror`.
  - `cropBox(variant, lmPx, w, h, seed) -> {x, y, w, h} | null` — `lmPx`: 33 точки в пикселях `{x, y, visibility}`; null, если вариант невозможен (например, нет головы на целом). Границы: `no_head` — верх ниже всех точек лица 0–10 и выше плеч (середина между max y лица и min y плеч); `no_feet` — низ посередине «колени–щиколотки»; `core` — верх посередине «нос–плечи», низ как `no_feet`; `tight` — верх = плечи − 0.15·корпус, низ = колени + 0.15·корпус. Сдвиг каждой границы — ±3 % высоты по `seed` (детерминированный ГПСЧ, напр. mulberry32 от хэша строки).
  - `truthMirror(pose) -> pose` (`side` ↔ `side_left`, прочие как есть).
  - `rleEncode(data, thr = 0.5) -> number[]` / `rleDecode(rle, n) -> Uint8Array` (длины чередующихся серий, начиная с нулей).
  - `cacheKey({sha, variant, params}) -> string` — sha1 от `sha|variant|JSON(params)`; `params` включает версию модели и `side`/`minDetect`.
  - `ownJobs(index, originalsDir) -> [{id, file, pose, sha}]` — из `PHOTOS_INDEX.photos`: `id` = имя (`2025-12-19_front`), `pose`, `file` = путь к оригиналу, `sha`.
  - `readIndex(path) -> object` — разбор `window.PHOTOS_INDEX = {...};`.
  - `extraJobs(dir) -> [{id, file, pose, sha}]` — доснятые снимки из `photo-bench/own/`: правильная поза — начало имени файла
    (`side_left…` проверяется раньше `side…`), например `side_arms_1.jpg` → `side`; имя без позы — пропуск с предупреждением.

- [ ] **Step 1: тесты** `crop boxes: no_head cuts below the face and above shoulders`, `no_feet between knees and ankles`, `tight: shoulders and knees inside`, `jitter is deterministic per seed and within ±3 %`, `no face on the full photo → no_head null`, `mirror truth`, `rle roundtrip`, `cache key differs by params and variant`, `extra jobs: pose from file name, side_left before side`, `own jobs from index` (индекс-фикстура из 2 записей в тексте теста, без настоящих данных).
- [ ] **Step 2:** `node --test test/photos_bench.test.js` → FAIL (нет модуля).
- [ ] **Step 3:** реализовать функции.
- [ ] **Step 4:** → PASS; `npm test` → PASS.
- [ ] **Step 5:** commit «Проверка фото: нарезка вариантов кадра, кэш, разметка своих снимков».

### Task 3: поиск фигуры в Electron без окна → кэш

**Files:**
- Create: `desktop/bench/photos_detect.js` (главный процесс Electron), `desktop/bench/detect.html`, `desktop/bench/detect_page.js`
- Create: `scripts/photos_bench.js` (CLI: `detect`, позже `fetch`, `eval`)

**Interfaces:**
- Consumes: `PhotosApp.decode`, `PhotosApp.detectRaw` (Task 1); `cropBox`, `rleEncode`, `cacheKey`, `ownJobs`, `readIndex`, `truthMirror` (Task 2).
- Produces: файлы кэша `photo-bench/cache/<source>/<id>__<variant>.json` = `{key, source, id, variant, truth, crop: {x, y, w, h, mirror}, w, h, lm, mask: {w, h, rle} | null, ms, params}`; `w, h, lm` — в координатах нарезанной картинки. `source` = `own` | `coco` | `extra` (снимки из `photo-bench/own/`).
- Страница: `detect.html` подключает `../../portal/photos_core.js`, `../../portal/photos_app.js` (vendor находится сам по адресу скрипта) и `detect_page.js`; `window.Bench.run({b64, name, crops: [{variant, x, y, w, h, mirror}], params}) -> [{variant, w, h, lm, mask, ms}]` — декодирует один раз (`new File([bytes], name)` → `decode`), нарезает canvas, зеркалит `scale(-1, 1)`, вызывает `detectRaw`.
- Главный процесс: окно `show: false`, `loadFile(detect.html)`; на каждый снимок — сначала `full`, по его `lm` → `cropBox` для остальных вариантов, затем один вызов `Bench.run` с ними; уже лежащие в кэше ключи пропускает; прогресс в stdout строкой `N/M id`.
- CLI: `node scripts/photos_bench.js detect [--source own|coco|extra|all] [--profile aleksandr-zuev] [--limit N] [--min-detect X] [--side N]` → `spawnSync(electron, ['desktop/bench/photos_detect.js', JSON.stringify(opts)])`.

- [ ] **Step 1:** реализовать страницу и главный процесс; `PHOTO_BENCH` по умолчанию `~/Documents/SEL/photo-bench`.
- [ ] **Step 2:** `node scripts/photos_bench.js detect --source own --limit 2` → в `cache/own/` 20 файлов (2 снимка × 10 вариантов, минус невозможные), у `full` `lm` не пустой; для HEIC-снимка вариант `no_head` даёт `lm[11]`, `lm[12]` с `visibility ≥ 0.5` (плечи не срезаны).
- [ ] **Step 3:** повторный запуск ничего не пересчитывает (вывод «0 новых»).
- [ ] **Step 4:** `npm test` → PASS (`build_files.test.js` не требует `bench/`); `node scripts/public_check.js` → чисто.
- [ ] **Step 5:** commit «Проверка фото: поиск фигуры в Electron без окна, кэш точек и маски вне проекта».

### Task 4: публичные фото COCO — отбор и правильная поза

**Files:**
- Modify: `scripts/photos_bench_lib.js` (COCO), `scripts/photos_bench.js` (`fetch`)
- Test: `desktop/test/photos_bench.test.js`

**Interfaces:**
- Produces:
  - `cocoTruth(kps) -> {pose: string | null, facing: 'front'|'back'|'side'|'unclear', up: boolean | null}` — `kps`: 17×3 COCO (x, y, v). Корпус T = |середина плеч − середина таза|. `sw = (x5 − x6)/T`, `hw = (x11 − x12)/T` (левое минус правое — от человека). `front`: sw > 0.35 и hw > 0.15; `back`: sw < −0.35 и hw < −0.15; `side`: |sw| < 0.2 и |hw| < 0.15; иначе `unclear`. Боком — направление по носу относительно середины ушей или плеч (видимый нос), иначе `unclear`; `side` = смотрит вправо на снимке. Руки: обе видимые кисти выше плеч на > 0.3·T → up; ниже плеч → не up; иначе (для лицом/спиной) `unclear`. `pose` = `front`/`front_flex`/`back`/`back_flex`/`side`/`side_left` или null при `unclear`.
  - `cocoSelect(annotations, images) -> [{id, url, box, kps, truth}]` — один человек с рамкой ≥ 50 % высоты снимка, остальные люди на снимке < 30 % высоты; видны (v = 2) плечи, таз, колени; стоит: y таза < y колен, щиколотки ниже колен или не размечены. `id` = `coco_<image_id>`.
  - `lrSwapped(lmPx, kps) -> boolean | null` — пары (11/5, 12/6), (23/11, 24/12), (25/13, 26/14); null, если ширина плеч < 0.15·T (боком — бессмысленно); иначе сумма расстояний «накрест» < «прямо».
- `fetch` без `--yes` печатает, что и откуда скачает (имя, адрес, размер), и выходит; с `--yes` — архив в `photo-bench/public/`, `unzip -j … annotations/person_keypoints_val2017.json`, архив удаляется, снимки — поштучно в `public/coco/`, разметка — `public/coco.json`.

- [ ] **Step 1: тесты** `coco truth: front, back, side right/left, unclear 3/4, arms up`, `coco select: one large standing person only`, `lr swap: detected straight / swapped / side → null` — на рукописных 17×3 массивах.
- [ ] **Step 2:** → FAIL; **Step 3:** реализовать; **Step 4:** → PASS, `npm test` → PASS.
- [ ] **Step 5:** commit «Проверка фото: отбор COCO и правильная поза по ручной разметке».
- [ ] **Step 6: спросить пользователя в чате** про скачивание (архив 241 МБ с images.cocodataset.org + N снимков, суммарный размер из `fetch` без `--yes`). Только после «да»: `node scripts/photos_bench.js fetch --yes`, затем `detect --source coco` в фоне. Для 50 случайных (зерно фиксировано) — посмотреть снимки глазами и сверить `truth`; ошибки разметки правила — поправить пороги `cocoTruth` (тест-случай на каждый найденный класс ошибки).

### Task 5: оценка и отчёт

**Files:**
- Modify: `scripts/photos_bench_lib.js` (метрики, отчёт), `scripts/photos_bench.js` (`eval [--baseline]`)
- Test: `desktop/test/photos_bench.test.js`

**Interfaces:**
- Consumes: кэш (Task 3), `PhotosCore.figureFromDetection`, `guessPose`, `alignAll`.
- Produces:
  - `evaluate(entries, {baseline}) -> stats` — `entries`: прочитанные файлы кэша; `stats.rows`: по (source, variant без/с mirror, truth) — `n`, `found`, `correct`, `confusion: {truth: {guess: n}}`, `lrSwap` (coco), `ms`; `stats.align` (own, без mirror): по варианту — `median`, `p90` сдвига (px) и `dth`; `stats.base` — расхождения с baseline: `poseChanged: [id]`, `maxShift`.
  - Сдвиг выравнивания: для снимка `id` и варианта v — `alignAll` по всей позе, где вместо `full` этого снимка — вариант v (kp из `figureFromDetection`, координаты нарезки); точки плеч, таза, колен из `full` переносятся в координаты нарезки (− crop.x, − crop.y) и проецируются обеими матрицами; сдвиг = среднее расстояние в кадре.
  - `baseline.json` = `{id: {pose, pts: {neck, root, knees}}}` — поза и выровненные точки 65 полных по текущему коду.
  - `report(stats) -> string` (markdown): таблицы «фигура найдена / поза верна» по варианту, путаница, сдвиг, против baseline, планка — ✅/❌ на каждый пункт Global Constraints.
- [ ] **Step 1: тесты** `evaluate on a synthetic cache` — 3 искусственных записи из `lm()`-подобных наборов (полный «front», его `no_head`, «side» без лица): `found`, `correct`, `confusion`, сдвиг 0 для варианта, совпадающего с целым; `report contains the bar with ✅/❌`; `no user coordinates in the report` (в тексте нет чисел из `lm`).
- [ ] **Step 2:** → FAIL; **Step 3:** реализовать; **Step 4:** → PASS, `npm test` → PASS.
- [ ] **Step 5:** commit «Проверка фото: оценка по кэшу и отчёт с планкой».

### Task 6: первый прогон и исходная точка

- [ ] **Step 1:** `node scripts/photos_bench.js detect --source own` (в фоне, ~650 вариантов).
- [ ] **Step 2:** до любой правки алгоритма: `node scripts/photos_bench.js eval --baseline` → `photo-bench/baseline.json` (65 записей).
- [ ] **Step 3:** `node scripts/photos_bench.js eval` → `report.md`; пересказать пользователю главное (фигура найдена по вариантам, где путает позы, сдвиг, L/R у COCO, если уже скачан). Если доснятые «сбоку, руки вперёд» лежат в `photo-bench/own/` — `detect --source extra` и они в отчёте.
- [ ] **Step 4:** по отчёту решить, нужна ли Task 9 (поиск фигуры), и записать причины в описание следующего коммита.

### Task 7: поза по плечам, тазу и коленям

**Files:**
- Modify: `portal/photos_core.js` (`keypointsFromLandmarks` → `look`, `guessPose`)
- Test: `desktop/test/portal_photos.test.js`

**Interfaces:**
- Produces: `kp.look` дополняется: `hw` — (левое бедро − правое) по x / корпус; `zs` — z левого плеча − z правого (MediaPipe: меньше = ближе к камере); `dir` — голосование: нос−уши, носки−пятки (как сейчас) + колени относительно линии «таз–щиколотки» (если щиколотки есть) + кисти/локти относительно плеч по x, когда руки вынесены вперёд (|Δx| > 0.4·корпус) + знак `zs` (ближнее к камере плечо = сторона, которой стоит); каждая составляющая — знак ±1, итог — сумма, 0 → «справа». `guessPose`: боком, если |sw| < SW и |hw| < HW (пороги — по отчёту, стартовые 0.35 и 0.25); боком руки не смотрятся. Сохранить существующие поля и их значения для полных снимков (baseline).
- [ ] **Step 1: тесты** на `lm()`: `side with arms forward → side (right) / side_left (mirrored)`, `side, no head and no feet → side by knees/arms/z`, `front without head → front`, `back without head and feet → back`, `side_left without nose and toes → side_left by z`, `swapped left/right labels without face, z says back → back` (Review Focus), существующий `guess pose (thresholds from 65 photos)` — без изменений.
- [ ] **Step 2:** → FAIL; **Step 3:** реализовать.
- [ ] **Step 4:** `npm test` → PASS; `node scripts/photos_bench.js eval` — поза: планка ✅ на своих, `poseChanged` пуст; на COCO ≥ 90 %. Пороги подбирать по отчёту; итоговые числа — в комментарий у `guessPose` (как нынешний «по 65 снимкам»).
- [ ] **Step 5:** commit с цифрами отчёта (поза по вариантам, своих и COCO) + пункт «Не выпущено»: «Поза на фото определяется и когда голова или стопы не попали в кадр; снимок сбоку с поднятыми руками — «Сбоку»».

### Task 8: выравнивание без головы и стоп

**Files:**
- Modify: `portal/photos_core.js` (`bodyAngle`, `poseMedians`, `alignTransform`, `fitPose`, `silhouette` при необходимости)
- Test: `desktop/test/portal_photos.test.js`

**Interfaces:**
- Produces: `DEFAULT_MED.rK` — силуэт / (колени − плечи) по высоте (стартовое значение — медиана по своим полным, вписать числом); `poseMedians` считает `rK`; `alignTransform`: порядок «силуэт» → «рост» → **«колени»** (`by: "колени"`, S = (V.knees − V.neck)·rK, пол — `V.knees + offK·S`, `offK` — медиана (подошвы − колени)/силуэт, добавить в `DEFAULT_MED`) → «корпус». `bodyAngle`: без щиколоток и пяток — по коленям (`kp.pts.knees`). `fitPose`: стартовая подгонка для снимка без макушки или подошв — через `alignTransform` по медианам (а не null), чтобы поза без единого полного снимка тоже шла «по точкам».
- [ ] **Step 1: тесты** `align fallback: shoulders–knees`, `tilt by knees when no ankles`, `pose with only cut photos: fitted by points, consistent scale` (5 `synth` без crown/sole/ankle/heels/eyes/ears — масштабы равны k с допуском 1 %), `arms forward at shoulder height do not move torso centre` (маска с горизонтальной полосой руки на уровне плеч — `cx` в пределах 2 px от центра корпуса), существующие `align*` тесты — без изменений.
- [ ] **Step 2:** → FAIL; **Step 3:** реализовать.
- [ ] **Step 4:** `npm test` → PASS; `eval` — сдвиг: медиана ≤ 25, p90 ≤ 50 на каждом варианте; против baseline ≤ 5 px.
- [ ] **Step 5:** commit с цифрами сдвига по вариантам.

### Task 9 (если в Task 6 «фигура найдена» ниже планки): поиск фигуры

**Files:**
- Modify: `portal/photos_app.js` (`detect`: повторная попытка), `scripts/photos_bench.js` (параметры в `params`)

**Interfaces:**
- Consumes: `detectRaw(img, {side, minDetect})`.
- Produces: `detect(img)`: первая попытка как сейчас; нет фигуры → повтор с параметрами, выбранными по отчёту (кандидаты по порядку: `minDetect` 0.3; `side` 1536; поле сверху высотой 25 % снимка с пересчётом координат). Модель `heavy` — только если без неё планка не берётся, с замером: загрузка серии из 5 снимков дольше не более чем на 30 %.
- [ ] **Step 1:** `detect --source own --min-detect 0.3` (и/или `--side 1536`) — новые ключи кэша; `eval` по каждому набору параметров; выбрать наименьший, берущий планку.
- [ ] **Step 2:** реализовать повтор в `detect`; тест не нужен сверх Task 1 (повтор — в браузерной части); проверка — `eval` на кэше с выбранными параметрами.
- [ ] **Step 3:** замер: время загрузки серии в приложении до/после (`ms` из отчёта × число попыток).
- [ ] **Step 4:** commit с цифрами «найдена» до/после и временем.

### Task 10: документы, итоговый прогон, сборка

**Files:**
- Modify: `docs/06_фото_инструкция.md`, `desktop/CHANGELOG.md`, `CLAUDE.md` (строки про `scripts/`: `photos_bench.js`)

- [ ] **Step 1:** `docs/06`: «как снимать» — голова/стопы могут не попасть в кадр, плечи и колени обязательны; «Если что-то не так» → «Как выравнивается» (опора «плечи–колени», `by: колени`); новый раздел «Проверочный набор» (где лежит, `detect`/`fetch`/`eval`, планка, baseline).
- [ ] **Step 2:** «Пересобрать всё» на своих снимках не нужен (старые выровненные снимки не меняются по baseline ≤ 5 px) — сказать это в отчёте пользователю.
- [ ] **Step 3:** `node scripts/photos_bench.js eval` — все пункты планки ✅ (или список ❌ для пользователя); `cd desktop && RENDER=1 npm test` → PASS; `node scripts/public_check.js` → чисто.
- [ ] **Step 4:** commit «Фото: документы — обрезанный кадр, проверочный набор».
- [ ] **Step 5:** `cd desktop && npm run app:mac`; сказать пользователю, что проверить: загрузить снимок с обрезанной головой и снимок сбоку с руками вперёд — поза определяется верно, выровненный кадр ровный.
