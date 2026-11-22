# Приложение «Здоровье» на Electron — план реализации

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** приложение «Здоровье» для macOS: окно с порталом, кнопки «Подключить FatSecret» и «Подключить Whoop» (каждый по желанию), цели, фото — без терминала и установки чего-либо. Windows — позже.

**Architecture:** страницы `portal/` общие для портала автора и приложения; расчёт `DATA` переезжает из `build_portal.py` в `portal/dataset.js`, а `data.js` становится сырыми таблицами (`RAW`), которые пишут и Python, и Electron. Приложение `desktop/` (Electron): окно, протокол `app://` (страницы из приложения, данные из `Документы/Здоровье/data`), CSV-хранилище, окно входа сервисов, FatSecret (OAuth 1.0), Whoop (OAuth 2.0), «Настройки», адаптер папки фото, сборка с проверкой приватности.

**Tech Stack:** Electron (последняя стабильная), electron-builder 27+, Node.js (Homebrew), `node --test`; Python 3.9 stdlib + `unittest`; jsc (JavaScriptCore macOS) для чистого JS; headless Chrome для отрисовки.

**Spec:** `docs/superpowers/specs/2026-11-21-electron-app-design.md`

## Global Constraints

- У автора всё работает как сейчас: портал из файла в Chrome, Python-скрипты, `auto_update.sh`, задачи Claude, Telegram. Python — совместим с 3.9 (`Optional[X]`, без `match`).
- Данные пользователя приложения — `Документы/Здоровье/data/` (`app.getPath('documents')`), раскладка как у автора; колонки CSV — `lib.SCHEMA` (копия `desktop/schema.json`, сверяется тестом). CSV: колонки по схеме, сортировка по ключу, LF.
- Цели из «Настроек» — новая строка в `targets.csv` / `goal_weight.csv` с сегодняшней даты, старые не трогаем.
- В приложении нет ничего личного автора; ключи внутри — только **отдельные** ключи приложений: `consumer_key` / `consumer_secret` из `data/secrets/fatsecret_app.json`, `client_id` / `client_secret` из `data/secrets/whoop_app.json`.
- Окно: `contextIsolation: true`, `sandbox: true`, без `nodeIntegration`; навигация только по `app://`; внешние ссылки — `shell.openExternal`; окна входа FatSecret и Whoop — отдельные `partition`, без `preload`.
- Протокол `app://h/`: `portal/**` (из приложения), `data/data.js`, `data/photos/**` (из папки данных); остальное — 404.
- FatSecret: OAuth 1.0, HMAC-SHA1; первое подключение — 12 месяцев, обновление — текущий и прошлый месяц, обратный адрес `https://health.local/fatsecret`.
- Whoop: API v2, OAuth 2.0, `scope = offline read:recovery read:cycles read:workout read:sleep read:profile read:body_measurement`, `state` 8 символов, свой User-Agent (`health-dashboard/1.0`), обратный адрес `https://health.local/whoop`; новый `refresh_token` сохранять после каждого обновления; первое подключение — 365 дней, обновление — 14 дней.
- Тексты ошибок (дословно, `<сервис>` = FatSecret / Whoop): «Нет связи с <сервис>, данные со вчера. Попробуйте позже» · «Доступ к <сервис> пропал — подключите заново» · «<сервис> ответил ошибкой: …». Сервисы обновляются независимо: ошибка одного не мешает другому.
- На экранах с данными FatSecret в приложении: «Powered by fatsecret» (ссылка https://www.fatsecret.com), «Условия fatsecret Platform API» (https://platform.fatsecret.com/terms) с фразой «Пользуясь приложением, вы принимаете условия fatsecret Platform API», «Не медицинская консультация».
- Тексты интерфейса — по-русски. Сборка: `dist/Здоровье-<версия>-mac.zip` (arm64 + x64). Код — без привязки к Mac (`path`, `app.getPath`), но Windows не собираем и не проверяем.
- После каждой задачи: `python3 -m unittest discover -s tests` и (с Task 3) `cd desktop && npm test`. Отрисовка — `RENDER=1 python3 -m unittest discover -s tests -p "test_pages_render.py"`.
- Коммит после каждой задачи — только свои файлы (`git commit -- <пути>`), никуда не пушить. `desktop/node_modules/`, `dist/` — в `.gitignore`.
- Ставить Node.js (`brew install node`) — с разрешения пользователя (получено при согласовании плана).

## Review Focus

1. **Перенос расчётов изменил портал автора** (округления, сортировка, пропуски) → `Dataset.build` на его данных совпадает с прежним `collect` поле в поле. Тест — Task 1 (сверка с эталоном до удаления `collect`).
2. **Путь с кириллицей и пробелами** (`~/Documents тест/Здоровье`) → протокол отдаёт файлы, CSV пишутся. Тест — Task 3 (папка данных «Документы тест/Здоровье»).
3. **Обход белого списка протокола** (`app://h/data/../data/secrets/fatsecret.json`, `%2e%2e`, `app://h/data/body.csv`) → 404. Тест — Task 3.
4. **Пользователь закрыл окно входа FatSecret или Whoop, не нажав «Allow»**, и жмёт «Подключить» снова → новое окно, старый `request_token` забыт, статус «не подключено», без ошибки. Тест — Task 4.
5. **Обновление упало посередине** (нет сети, Whoop отозвал токен) → CSV этого сервиса прежние, другой сервис обновился, статус с текстом ошибки, флаг «обновляю» снят, следующее обновление идёт. Тест — Task 4 и Task 5.

---

### Task 1: Расчёт портала — в `portal/dataset.js`, `data.js` — сырые таблицы

**Files:**
- Create: `portal/dataset.js`
- Modify: `scripts/build_portal.py` (`collect` → `raw`; `data_js` пишет `const RAW = …`)
- Modify: все страницы `portal/*.html` — после `<script src="../data/data.js">` подключить `<script src="dataset.js">`
- Modify: `portal/common.js` и `portal/photos.html` — если `typeof RAW !== 'undefined'`, то `const DATA = Dataset.build(RAW)` в `dataset.js` (страницы дальше работают с `DATA`, как сейчас)
- Test: `tests/test_dataset_js.py` (jsc), правки `tests/test_briefs_portal.py`

**Interfaces:**
- Produces:
  - `build_portal.raw(today: str) -> dict` — `{"tables": {"<имя>.csv": [строки с числами, как build_portal.load]}, "meta": lib.meta(), "modules": lib.modules(), "updated": today}`; таблицы — все из `lib.SCHEMA`.
  - `lib.modules(secrets: Optional[Path] = None) -> List[str]` — `fatsecret` (в `fatsecret.json` непустой `access_token`), `photos` (всегда), `whoop` (`whoop.json`: `refresh_token`), `telegram` (`telegram.json`: `token` и `chat_id`); `None` → `lib.SECRETS` на момент вызова.
  - `Dataset.build(raw) -> DATA` — те же поля и значения, что прежний `collect`: `weight`, `waist`, `kcal`, `nutrition`, `macros_month` (средние Б/Ж/У за дни ≥ 1200 ккал, округление до 0,1), `sleep`, `rhr`, `steps`, `workouts` (`[start, kind, duration_min, kcal]`, без `walk`, по возрастанию), `whoop_daily`, `whoop_workouts` (с `kind`), `supplements`, `checkins`, `labs`, `events`, `targets`, `goal_weight`, `alcohol_check`, `photo_notes` (`{date: note}`), `updated`, поля `meta` (`plan`, `journal`, `photos_summary`, `priorities`), плюс `modules`.
  - `Dataset.workoutKind(w, labels)` — порт `lib.workout_kind` / `lib.sport_kind` (метка главнее вида; `STRENGTH`, `squash`, `walking`).

- [ ] **Step 1: Эталон до изменений** (вне git): `python3 -c "…build_portal.collect('2026-11-21')…"` → `<scratchpad>/collect_before.json`.
- [ ] **Step 2: Тесты `tests/test_dataset_js.py`** (jsc; синтетические таблицы):

```python
def test_macros_month_full_days_only(self):     # 2 дня ноября: 2000 ккал Б100 и 900 ккал Б10 → macros_month["2026-11"] == [100.0, f, c]
def test_workouts_label_overrides_and_walk_dropped(self):   # activity + метка strength → "strength"; метка none → нет в workouts
def test_series_skip_empty(self):                # вес None в строке body → нет в weight; талия есть → в waist
def test_photo_notes_map(self):                  # [{"date": "2026-07-12", "note": "x"}] → {"2026-07-12": "x"}
def test_matches_python_collect_on_real_data(self):
    # skip, если нет <scratchpad>/collect_before.json; Dataset.build(build_portal.raw("2026-11-21")) == эталон
    # (сравнение после json-круга; поле modules — только в новом)
```
- [ ] **Step 3: Падают:** `python3 -m unittest discover -s tests -p "test_dataset_js.py"`.
- [ ] **Step 4: Реализовать** `dataset.js`, `raw`, `modules`, страницы; `collect` удалить после зелёной сверки; тесты `test_briefs_portal.py`, которые звали `collect`, — на `Dataset.build` через jsc или на `raw`.
- [ ] **Step 5: Зелёные** + `python3 scripts/build_portal.py` и headless Chrome по `portal/dashboard.html` из файла — графики на месте (`<svg` ≥ 8, план «v4»).
- [ ] **Step 6: Commit** — `Портал: расчёты в dataset.js (общие с приложением), data.js — сырые таблицы`.

---

### Task 2: Меню `nav.js` и ничего пустого

**Files:**
- Create: `portal/nav.js`
- Modify: `portal/*.html` — `<nav class="nav" id="nav"></nav>`, `<script src="nav.js">` после `dataset.js`; `portal/dashboard.html`, `nutrition.html` — по данным
- Modify: `data/meta.json` — `"priorities"` и `plan.workouts`; `scripts/lib.py` — `META_EMPTY["priorities"] = []`
- Test: `tests/test_nav_js.py` (jsc), `tests/test_pages_render.py` (`RENDER=1`), правки `tests/test_briefs_portal.py`

**Interfaces:**
- Consumes: `DATA.modules`, `DATA.priorities`, `DATA.plan.workouts`, `DATA.targets`, `DATA.goal_weight` (Task 1).
- Produces: `Nav.items(data, inApp: boolean) -> [href, title][]` — Сводка; Питание (есть `nutrition` или `weight`); Тренировки, Восстановление (есть `whoop_daily`); Фото; Настройки (`inApp`). `Nav.render()` — заполняет `#nav`, отмечает текущую; `inApp = !!window.health` (Task 5 добавит «Обновить»).

- [ ] **Step 1: Тесты** `tests/test_nav_js.py`:

```python
def test_all_services_in_browser(self):  self.assertEqual(hrefs({"nutrition": [1], "weight": [], "whoop_daily": [1]}, False),
                                            ["dashboard.html", "nutrition.html", "training.html", "recovery.html", "photos.html"])
def test_fatsecret_only_in_app(self): self.assertEqual(hrefs({"nutrition": [], "weight": [1], "whoop_daily": []}, True),
                                            ["dashboard.html", "nutrition.html", "photos.html", "settings.html"])
def test_empty_in_app(self): self.assertEqual(hrefs({"nutrition": [], "weight": [], "whoop_daily": []}, True),
                                            ["dashboard.html", "photos.html", "settings.html"])
```
  `tests/test_pages_render.py` (headless Chrome, `file://`, временная папка: `portal` — симлинк, `data/data.js` из `raw` на синтетике):
```python
def test_fatsecret_only_dashboard(self):   # питание + вес + goal_weight 80, без whoop и meta.json
    # нет 'href="training.html"', "Recovery", "82", "/ 8"; нет <h2>БАДы/События/Анализы/Журнал недель/Текущий план/Хорошая неделя; есть "цель 80"
def test_empty_dashboard(self):           # есть "Подключите FatSecret или Whoop"
def test_whoop_only_dashboard(self):      # только whoop_daily и тренировки: есть 'href="training.html"', нет 'href="nutrition.html"', нет "Калории"
def test_owner_unchanged(self):        # настоящие data/: "<целевой вес>", "/ 8", 'href="training.html"'
```
- [ ] **Step 2: Падают.**
- [ ] **Step 3: Реализовать.** Сводка: приоритеты из `DATA.priorities` (пусто — блок скрыт); цели ккал/белка в плитках — `targets.csv` на сегодня, сон — `plan.targets.sleep`; плитки и карточки Whoop — при `whoop_daily.length`; «/ N» и линия цели тренировок — из `plan.workouts`; «Вес» — при данных, «цель X кг» — последняя строка `goal_weight` не позже сегодня; «Талия», «Самочувствие» — при данных; блоки «Хорошая неделя», «Текущий план», «БАДы», «События», «Анализы», «Журнал недель» — только непустые; ни питания, ни веса, ни Whoop → «Данных пока нет. Подключите FatSecret или Whoop» (в приложении — ссылка на «Настройки»). «Питание» без данных — тот же текст. В `data/meta.json`: `"priorities": [["Самочувствие", "главное"], ["Спортивность", "сила растёт"], ["<целевой вес>", "без срока, медленно и чисто"]]`, `"plan": {…, "workouts": {"strength": 2, "squash": 2}}`.
- [ ] **Step 4: Зелёные** (обычные + `RENDER=1`).
- [ ] **Step 5: Commit** — `Портал: меню nav.js, пустое не показываем, приоритеты и цели — из data/`.

---

### Task 3: `desktop/` — каркас Electron, окно, протокол, хранилище

**Files:**
- Create: `desktop/package.json`, `desktop/main.js`, `desktop/store.js`, `desktop/protocol.js`, `desktop/schema.json`, `desktop/test/store.test.js`, `desktop/test/protocol.test.js`
- Modify: `.gitignore` — `/desktop/node_modules/`, `/dist/`
- Test: + `tests/test_desktop_schema.py` (`desktop/schema.json` == `lib.SCHEMA`, `KEY`, `SORT`)

**Interfaces:**
- Produces:
  - `store.dataDir(documents: string) -> string` — `<documents>/Здоровье/data`.
  - `store.init(dir) -> string[]` — `secrets/`, `photos/`; недостающие CSV из схемы с заголовком; → созданные имена.
  - `store.read(dir, name) -> object[]`, `store.upsert(dir, name, {ключ: {колонка: значение}}) -> {added, updated, total}` — поведение как `lib.upsert` (null не затирает, числа без лишних нулей: `72.0 → "72"`, `72.50 → "72.5"`), запись как `lib.write`.
  - `store.writeDataJs(dir, today: string, modules: string[], meta?: object)` — `data.js` того же формата, что `build_portal.raw` (`const RAW = …`); числовые колонки — числа.
  - `protocol.resolve(url: string, portalDir: string, dataDir: string) -> string | null` — путь файла или `null` (→ 404); белый список из Global Constraints; путь после `path.resolve` обязан лежать внутри разрешённой папки.
  - `main.js`: одно окно `app://h/portal/dashboard.html`, `protocol.handle("app", …)` поверх `resolve`, `will-navigate` — только `app:`; при старте `store.init` и `writeDataJs`.
  - `package.json` scripts: `start`, `test` (`node --test`), `dist:mac`, `dist:win`.

- [ ] **Step 0: Node** — `brew install node`; `cd desktop && npm init -y && npm i -D electron electron-builder`.
- [ ] **Step 1: Тесты** `desktop/test/*.test.js` (`node:test`, временная папка `…/Документы тест/Здоровье/data`):

```js
test('init creates headers once', …)            // body.csv == "date,weight_kg,waist_cm,bodyfat_pct,note\n"; второй init → []
test('upsert like lib.upsert', …)               // {"2026-01-01": {weight_kg: 70.5, waist_cm: null}} не затирает waist; 71.0 → "71"; LF
test('data.js is RAW with numbers', …)          // tables["body.csv"][0].weight_kg === 70.5; modules === ["photos"]
test('protocol whitelist', …)                   // portal/dashboard.html, data/data.js, data/photos/a/b.jpg → пути;
                                                // data/body.csv, data/secrets/fatsecret.json, data/../data/secrets/x,
                                                // data/photos/%2e%2e/secrets/x, portal/../../etc → null
```
- [ ] **Step 2: Падают:** `cd desktop && npm test`.
- [ ] **Step 3: Реализовать**; `schema.json` сгенерировать из `lib.SCHEMA`/`KEY`/`SORT` (одноразовый скрипт в шаге, тест следит за расхождением).
- [ ] **Step 4: Зелёные** + `npm start`: окно с пустым порталом («Подключите FatSecret»), меню без «Тренировок»; папка `~/Documents/Здоровье/data` создана (после проверки удалить её).
- [ ] **Step 5: Commit** — `desktop: Electron — окно, протокол app://, хранилище CSV в Документы/Здоровье`.

---

### Task 4: Окно входа и FatSecret — подпись, подключение, обновление

**Files:**
- Create: `desktop/oauthwin.js`, `desktop/fatsecret.js`, `desktop/updater.js`, `desktop/test/fatsecret.test.js`, `desktop/test/updater.test.js`
- Test: + `tests/test_fatsecret_sign.py` (подпись совпадает с Python)

**Interfaces:**
- Consumes: `store.*` (Task 3).
- Produces:
  - `oauthwin.open({url, callbackPrefix, partition}) -> Promise<URL | null>` — окно входа; `null`, если закрыли без перехода на `callbackPrefix`; переход перехватывается (`will-redirect`/`will-navigate`, `event.preventDefault()`), окно закрывается.
  - `updater.services` — реестр `{fatsecret: {connected(dir), run(dir, range)}, whoop: …}`; Task 5 добавляет `whoop`.
  - `fatsecret.signedUrl(method, url, params, consumerSecret, tokenSecret = "", nonce, timestamp) -> string` — чистая функция (без Node API), байт в байт как `fatsecret_api.signed_url` при тех же `nonce`/`timestamp`.
  - `fatsecret.requestToken(app, callback) -> {token, secret}`, `fatsecret.authorizeUrl(token) -> string`, `fatsecret.accessToken(app, token, secret, verifier) -> {token, secret}`, `fatsecret.month(app, user, ym) -> {date: {kcal, protein, fat, carbs}}`, `fatsecret.weights(app, user, ym) -> {date: kg}`. Ошибки — `FatSecretError {kind: 'network'|'token'|'api', message}`; ответ `{"error": {"code": 9|13}}` → `token`; сеть/таймаут → `network`.
  - `updater.runAll(dir, first = false) -> {fatsecret?: {ok, error?}, whoop?: {ok, error?}}` — по подключённым сервисам по очереди, независимо, затем `writeDataJs`; одно обновление за раз (`updater.busy`).
  - `fatsecret.update({dir, app, user, months: [a, b]}) -> {ok: true} | {ok: false, error}` — питание → `nutrition_daily.csv`, вес → `body.csv` (новая строка — `note: "FatSecret"`, талию не трогать), ошибка — файлы не тронуты (всё пишется после всех запросов).
  - `updater.firstRange(today: Date) -> [a, b]` — `firstRange(2026-11-21) == ["2025-12", "2026-11"]`; `updater.recentRange(today)` — `["2026-10", "2026-11"]`.
  - `main.js`: `connect("fatsecret")` — `requestToken(app, "https://health.local/fatsecret")` → `oauthwin.open({…, partition: "fatsecret-login"})` → `accessToken` → `secrets/fatsecret.json` (`access_token`, `access_secret`) → `updater.runAll(dir, true)`; закрыли окно без «Allow» — `{ok: false, cancelled: true}`, pending забыт. Ошибка `requestToken` с callback (`api`) → `oob`: окно входа остаётся, «Настройки» показывают поле кода → `codeEntered(verifier)`.
  - Ключ приложения — `fatsecret_app.json` рядом с `main.js` (при разработке — из `../data/secrets/fatsecret_app.json`).

- [ ] **Step 1: Тесты:** `tests/test_fatsecret_sign.py` — `signedUrl` через jsc и `fatsecret_api.signed_url` (с подменой `time.time` и `secrets.token_hex`) дают одну строку для `GET`, `POST`, параметров с кириллицей и `+`; `desktop/test/*`:
```js
test('error kinds', …)                       // fetch-заглушка: {"error":{"code":9}} → kind 'token', message «Доступ к FatSecret пропал — подключите заново»; reject → 'network', «Нет связи с FatSecret, данные со вчера. Попробуйте позже»
test('update writes nutrition and weight', …) // 2 месяца → nutrition_daily.csv и body.csv (note FatSecret), data.js обновлён
test('failed update leaves files', …)         // второй запрос падает → CSV и data.js байт в байт прежние; busy === false; следующий run идёт
test('one update at a time', …)
test('ranges', …)
```
- [ ] **Step 2: Падают.**
- [ ] **Step 3: Реализовать.**
- [ ] **Step 4: Зелёные** + `npm start` с ключом приложения: подключение учёткой автора (делает пользователь, «Allow») → данные за год; записать в дизайн, сработал `callback` или `oob`; удалить `~/Documents/Здоровье` (в ней токен).
- [ ] **Step 5: Commit** — `desktop: окно входа, FatSecret — OAuth 1.0, обновление`.

---

### Task 5: Whoop в приложении — вход, выгрузка, обновление

**Files:**
- Create: `desktop/whoop.js`, `desktop/test/whoop.test.js`
- Modify: `desktop/updater.js` (сервис `whoop`), `desktop/main.js` (`connect("whoop")`)
- Test: + `tests/test_whoop_parse.py` (разбор JSON Whoop в строки CSV совпадает с `scripts/whoop_api.py`)

**Interfaces:**
- Consumes: `oauthwin.open`, `updater.services`, `store.*` (Task 3–4).
- Produces:
  - `whoop.authUrl(app, state) -> string`; `whoop.exchange(app, code) -> tokens`; `whoop.refresh(app, user) -> user` (новый `refresh_token` и `expires_at` сохраняются сразу в `secrets/whoop.json`); `whoop.collect(user, path, start, end) -> object[]` (постранично по `next_token`).
  - `whoop.toRows(cycles, recoveries, sleeps, workouts, tzOffset) -> {daily: {date: {…}}, workouts: {id: {…}}}` — чистая функция, колонки `whoop_daily.csv` / `whoop_workouts.csv`, правила — как `whoop_api.fetch` (день = день после сна, `bed`/`wake` местное ЧЧ:ММ, зоны в минутах, округления как `r1`/`h`).
  - `whoop.update({dir, app, user, days}) -> {ok} | {ok: false, error}` — upsert дней и тренировок; тренировки периода, которых больше нет в Whoop, удаляются (как `prune_workouts`); файлы пишутся после всех запросов.
  - `main.js`: `connect("whoop")` — `state` (8 символов) → `oauthwin.open({url: authUrl, callbackPrefix: "https://health.local/whoop", partition: "whoop-login"})` → `state` совпал → `exchange` → `secrets/whoop.json` → `updater.runAll(dir, true)` (Whoop — 365 дней).
  - Ошибки: HTTP 401 / `invalid_grant` → `token` («Доступ к Whoop пропал — подключите заново»); сеть → `network`; Cloudflare 403/1010 — тоже `api` с текстом ответа.

- [ ] **Step 1: Тесты:** `tests/test_whoop_parse.py` — один набор JSON (цикл, recovery, сон, 2 тренировки, одна без зон) → `whoop.toRows` через jsc и разбор `whoop_api` (вынести разбор в чистую функцию `whoop_api.to_rows(...)`, CLI не меняется) дают одинаковые строки; `desktop/test/whoop.test.js`:
```js
test('state mismatch rejected', …)          // обратный адрес с чужим state → не подключено, токены не записаны
test('refresh token saved every time', …)   // заглушка отдаёт новый refresh_token → в secrets/whoop.json новый
test('pagination', …)                       // две страницы next_token → все записи
test('pruned workouts', …)                  // тренировка периода исчезла в Whoop → удалена из whoop_workouts.csv
test('whoop fails, fatsecret still updates', …)  // runAll: whoop 401 → ошибка whoop, fatsecret ok, его CSV обновлены
```
- [ ] **Step 2: Падают.**
- [ ] **Step 3: Реализовать** (`whoop_api.to_rows` — выделить из `fetch`, поведение CLI прежнее; тесты Python зелёные).
- [ ] **Step 4: Зелёные** + `npm start` с ключом приложения Whoop: подключение учёткой автора (пользователь, «Allow») → «Восстановление» и «Тренировки» появились; удалить `~/Documents/Здоровье`.
- [ ] **Step 5: Commit** — `desktop: Whoop — OAuth 2.0, выгрузка, обновление`.

---

### Task 6: «Настройки», «Обновить», подвалы

**Files:**
- Create: `desktop/preload.js`, `portal/settings.html`
- Modify: `desktop/main.js` (IPC), `portal/nav.js` («Обновить» + статус), `portal/common.css` (подвал), страницы с данными FatSecret (подвал в приложении)
- Test: `desktop/test/settings.test.js`, `tests/test_briefs_portal.py` (`settings.html`: порядок скриптов, синтаксис)

**Interfaces:**
- Consumes: Task 2–5.
- Produces — `window.health` (через `contextBridge`): `status() -> {version, modules, updating, services: {fatsecret: {connected, lastUpdate, lastError}, whoop: {…}}}`; `update()`; `connect(service)`; `codeEntered(verifier)` (FatSecret `oob`); `disconnect(service)`; `saveTargets({kcal, protein, fat, carbs, goalWeight}) -> {ok} | {ok: false, error}`; `openDataFolder()`; `openExternal(url)` (только `https://www.fatsecret.com`, `https://platform.fatsecret.com/terms`); `onStatus(cb)`.
  - `saveTargets`: пределы ккал 1000–6000, Б/Ж/У 0–600, вес 30–250; пустое — не меняем; `upsert("targets.csv", {сегодня: {…, note: "из настроек"}})`, `upsert("goal_weight.csv", {сегодня: {goal_weight_kg, note: "из настроек"}})` → `writeDataJs`; ошибка — «Калории — от 1000 до 6000» и т. п.
  - `settings.html`: блоки FatSecret и Whoop (статус, «Подключить …»/«Отключить», последнее обновление, ошибка; у FatSecret — поле кода при `oob`), Цели (из последних строк `DATA.targets`/`DATA.goal_weight`), версия, «Открыть папку с данными». Вне приложения — «Настройки есть только в приложении».
  - `nav.js` в приложении: справа «Обновить» и «обновлено …» / «обновляю…» / ошибка; по окончании — перезагрузка.
  - Подвал (только в приложении): на страницах с данными FatSecret — тексты и ссылки из Global Constraints; с данными Whoop — «Данные Whoop» и «Не медицинская консультация».

- [ ] **Step 1: Тесты** (`settings.test.js` — `saveTargets` на временной папке):
```js
test('new row from today, old untouched', …)  // targets.csv 2026-01-01 → после {kcal: 2300, protein: 140}: 2026-01-01 прежняя, сегодня kcal 2300
test('out of range rejected', …)               // kcal 200 → {ok: false, error: "Калории — от 1000 до 6000"}, файлы не тронуты
test('openExternal allows only fatsecret links', …)
```
- [ ] **Step 2: Падают.**
- [ ] **Step 3: Реализовать.**
- [ ] **Step 4: Зелёные** + `npm start`: цели сохраняются и видны на «Сводке», «Обновить» обновляет оба сервиса, «Отключить» Whoop — ключи удалены, данные и страницы Whoop остаются, обновляется только FatSecret; подвалы есть, ссылки открываются в системном браузере.
- [ ] **Step 5: Commit** — `desktop: «Настройки», «Обновить», подвалы`.

---

### Task 7: Фото в приложении — папка без выбора

**Files:**
- Modify: `desktop/preload.js` — `health.photosRoot()`; `desktop/main.js` — IPC файловых операций только внутри `data/photos`
- Create: `desktop/photosfs.js`, `desktop/test/photosfs.test.js`
- Modify: `portal/photos_app.js` — если `window.health`, корень = `health.photosRoot()`, без `showDirectoryPicker`/разрешений/IndexedDB

**Interfaces:**
- Produces: `health.photosRoot()` — объект с подмножеством `FileSystemDirectoryHandle`, которое использует `photos_app.js`: `name`, `kind`, `getDirectoryHandle(name, {create})`, `getFileHandle(name, {create})`, `entries()` (async-итератор), `removeEntry(name)`, `queryPermission()`/`requestPermission()` → `"granted"`; у файла — `getFile()` (→ `File`), `createWritable()` → `{write(Blob|ArrayBuffer|string), close()}`. Все пути через IPC в `photosfs.js`, который отказывает вне `data/photos` (`..`, абсолютные, симлинки).

- [ ] **Step 1: Тесты** `photosfs.test.js`: запись/чтение/перечисление/удаление в `data/photos`; имена `..`, `../secrets/x`, `/etc/x` → ошибка.
- [ ] **Step 2: Падают.**
- [ ] **Step 3: Реализовать.**
- [ ] **Step 4: Зелёные** + `npm start`: «Фото» → «Загрузить фото» (JPEG и HEIC с iPhone) → снимок в `~/Documents/Здоровье/data/photos/`, выравнивание, сравнение; у автора в Chrome «Фото» работает как раньше (тесты `test_photos_js.py` зелёные).
- [ ] **Step 5: Commit** — `desktop: фото — папка data/photos без выбора`.

---

### Task 8: Сборка Mac, проверка приватности, значок

**Files:**
- Modify: `desktop/package.json` — `build` (electron-builder): `appId: "local.health.app"`, `productName: "Здоровье"`, `files`: `main.js`, `preload.js`, `*.js` desktop, `schema.json`, `fatsecret_app.json`, `whoop_app.json`; `extraResources`/`files` для `../portal/**` (без `data.js`); `mac: {target: zip, arch: [arm64, x64], identity: "-"}` (ad-hoc подпись)
- Create: `desktop/build/icon.png` (1024×1024; простой значок), `desktop/scripts/prepare.js` (кладёт `fatsecret_app.json` только с `consumer_key`/`consumer_secret`), `desktop/scripts/privacy.js`
- Test: `desktop/test/privacy.test.js`

**Interfaces:**
- Produces:
  - `prepare.js` — перед сборкой: `../data/secrets/fatsecret_app.json` → `desktop/fatsecret_app.json` (`consumer_key`, `consumer_secret`), `../data/secrets/whoop_app.json` → `desktop/whoop_app.json` (`client_id`, `client_secret`, `redirect_uri`); оба — в `.gitignore`; нет файла — сборка падает с «Нет ключа приложения <сервис>: data/secrets/<файл>».
  - `privacy.secretValues(secretsDir) -> string[]` — строки длиной ≥ 8 из `data/secrets/*.json`, кроме полей ключей приложений из `fatsecret_app.json` и `whoop_app.json`.
  - `privacy.check(appDir, values)` — бросает, если есть пути `data/`, `docs/`, `tests/`, `CLAUDE.md`, `.git`, `data.js`, или любой файл содержит любое из `values`. Запускается после сборки (`afterPack`) по распакованному `app.asar`.

- [ ] **Step 1: Тесты** `privacy.test.js`: подложенный токен в файле → бросает; ключи приложений FatSecret и Whoop — не бросает; путь `data/x.csv` → бросает.
- [ ] **Step 2: Падают.**
- [ ] **Step 3: Реализовать.**
- [ ] **Step 4: Зелёные** + `npm run dist:mac` → `dist/Здоровье-<версия>-mac.zip`, `privacy` прошла; размер записать.
- [ ] **Step 5: Commit** — `desktop: сборка Mac (zip), проверка приватности`.

---

### Task 9: Проверка как у пользователя, документация

**Files:**
- Modify: `CLAUDE.md` — «Структура»: `portal/dataset.js`, `nav.js`, `settings.html`, `desktop/` (что где), `dist/`; раздел «Приложение для знакомых»: сборка (`cd desktop && npm run dist:mac`), ключи приложений FatSecret и Whoop, что внутри и что нет, пересборка раз в полгода (Electron)
- Modify: `data/README.md` — `data.js` теперь `RAW`; `docs/superpowers/specs/2026-11-21-electron-app-design.md` — статус, какой путь FatSecret сработал, ограничения Whoop для неодобренного приложения (из кабинета разработчика)

- [ ] **Step 1: Mac как у пользователя:** распаковать `dist/Здоровье-*-mac.zip` в `<scratchpad>/тест`, `xattr -w com.apple.quarantine "0081;$(printf %x $(date +%s));Safari;" Здоровье.app` (как после скачивания) → открыть → «Всё равно открыть» (делает пользователь) → подключение FatSecret и Whoop (пользователь) → «Сводка», «Питание», «Восстановление», «Тренировки», цели, фото; отключить Whoop → его страницы остаются с прежними данными, обновление идёт только по FatSecret. Записать, что пришлось нажать — в «Настройки → О приложении» и в инструкцию для знакомых.
- [ ] **Step 2: Убрать следы:** `~/Documents/Здоровье` (токены), `<scratchpad>/тест`.
- [ ] **Step 3: У автора ничего не сломалось:** `python3 scripts/build_portal.py`, headless Chrome по `portal/dashboard.html` — «<целевой вес>», «/ 8», «Тренировки»; `bash -n scripts/auto_update.sh`; все тесты, включая `RENDER=1` и `npm test`.
- [ ] **Step 4: Документация**, commit — `Приложение «Здоровье»: проверка на Mac, документация`.
