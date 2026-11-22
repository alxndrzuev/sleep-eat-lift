# Ручные данные: чистка, план и БАДы в «Настройках» — план реализации

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** убрать данные, которые вводились только из чата; план (свободный текст), БАДы и цели сна/тренировок — ввод в «Настройках» с историей; тренировки — силовые и кардио; описание папки данных для LLM.

**Architecture:** схема CSV — `desktop/schema.json`; запись — `store.js`; логика ввода и проверки — `settings.js` (IPC в `main.js`, мост `preload.js`); расчёт для страниц — `portal/dataset.js`; страницы — `portal/*.html`. Кода переноса старых данных нет: только совместимость чтения старого `body.csv`.

**Tech Stack:** Electron, Node без зависимостей, `node:test`; страницы — обычный JS, тесты страниц в Node (`test/_portal.js`) и в Chrome (`RENDER=1`).

**Spec:** `docs/superpowers/specs/2026-11-22-manual-data-design.md`

## Global Constraints
- Репозиторий публичный: в коде, тестах, документах — никаких данных пользователя (названий БАДов, текста плана, весов).
- CSV — только через `store.js`; новые колонки — только в конец.
- Текст из CSV в `innerHTML` — только через `esc()`.
- После правок: `cd desktop && npm test`; страницы — `RENDER=1 npm test`; перед коммитом — `node scripts/public_check.js`.
- Каждое заметное изменение — пункт в `desktop/CHANGELOG.md` «Не выпущено», в том же коммите.
- Коммиты заканчиваются строкой `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus
1. Старый `body.csv` с заголовком `date,weight_kg,waist_cm,bodyfat_pct,note` (есть у всех нынешних пользователей) читается, FatSecret дописывает вес, колонки талии исчезают при записи — тест в задаче 1.
2. Текст плана с запятыми, кавычками, переносами строк и `<b>` сохраняется байт в байт и на сводке виден как текст — тесты в задачах 1 и 4.
3. Два БАДа с одной датой начала: «прекратить» и «удалить» трогают только выбранный — тест в задаче 2.
4. Сохранение одной цели сна не стирает КБЖУ, вес и тренировки действующей цели — тест в задаче 2.
5. Целей тренировок и сна нет (новый пользователь) — сводка, «Тренировки», «Восстановление» рисуются без «/ N», сон — линия 7,5 — тест в задаче 4.

---

### Task 1: Схема и store

**Files:**
- Modify: `desktop/schema.json`, `desktop/store.js`, `scripts/csv.js` (только если нужно для сообщения об ошибке)
- Test: `desktop/test/store.test.js`, `desktop/test/csv_cli.test.js`, `desktop/test/datadir.test.js`, `desktop/test/real_data.test.js`

**Interfaces:**
- Produces: таблицы `plans.csv` [`start`, `text`] (ключ `start`); `targets.csv` += `sleep_h`, `strength_wk`, `cardio_wk`; `body.csv` = [`date`, `weight_kg`, `note`]; нет `checkins.csv`, `labs.csv`, `photo_notes.csv`; `SCHEMA.dropped = {"body.csv": ["waist_cm", "bodyfat_pct"]}`; `SCHEMA.no_upsert = ["supplements.csv"]`; `META_EMPTY = {}`.

- [ ] **Step 1: тесты.** В `store.test.js`:
  - `old body.csv with waist columns is read; write drops them`: файл `date,weight_kg,waist_cm,bodyfat_pct,note\n2026-01-01,70,80,,x\n` → `read` даёт `[{date:'2026-01-01', weight_kg:'70', note:'x'}]`; после `upsert(…{'2026-01-02': {weight_kg: 71}})` файл начинается с `date,weight_kg,note\n`.
  - `plans.csv keeps multiline text with quotes and commas`: `upsert(dir,'plans.csv',{'2026-11-16':{text:'a, "b"\nстрока 2\n<b>x</b>'}})` → `read(...)[0].text` равен исходному.
  - `upsert into supplements.csv is refused`: `assert.throws(() => store.upsert(dir,'supplements.csv',{…}), /supplements\.csv/)`.
  - `init` создаёт `plans.csv`, не создаёт `checkins.csv`/`labs.csv`/`photo_notes.csv`.
  - Поправить существующие ожидания заголовка `body.csv` (`store.test.js:24,38`, `datadir.test.js:24`, `csv_cli.test.js:25-31` — талию в примере заменить на `note`), тест `meta.json … missing → empty plan` → «нет файла — `{}`»; `real_data.test.js:41` — без `checkins.csv`.
- [ ] **Step 2:** `npm test` — новые тесты падают.
- [ ] **Step 3: реализация.** `schema.json` — как в Interfaces (`text` += `"text"`; `key` для `plans.csv` = `start`; `supplements.csv` в `key` остаётся `start`, сортировка по нему). `store.read`: перед сверкой заголовка убрать из него колонки `SCHEMA.dropped[name]`; значения берутся по позиции в исходном заголовке. `store.upsert`: имя из `no_upsert` → `throw new Error(name + ': запись только через приложение')`.
- [ ] **Step 4:** `npm test` — зелёное (страницы ещё могут читать `DATA.waist` и т. п. — если падают тесты страниц, это задача 3/4; здесь убрать только то, что ломает store).
- [ ] **Step 5: коммит** «Схема: план — plans.csv, цели сна и тренировок, без самочувствия, анализов, заметок к фото и талии».

### Task 2: Логика «Настроек» и IPC

**Files:**
- Modify: `desktop/settings.js`, `desktop/main.js:193-194`, `desktop/preload.js`
- Test: `desktop/test/settings.test.js`

**Interfaces:**
- Consumes: схема задачи 1.
- Produces (все → `{ok:true}` или `{ok:false, error:'<по-русски>'}`; `today` — `YYYY-MM-DD`):
  - `saveTargets(dir, {date?, protein, fat, carbs, goalWeight, sleep, strength, cardio}, today)` — новые поля → `sleep_h`, `strength_wk`, `cardio_wk`; пределы `sleep: [4, 12, 'Сон — от 4 до 12 ч']`, `strength: [0, 14, 'Силовые — от 0 до 14 в неделю']`, `cardio: [0, 14, 'Кардио — от 0 до 14 в неделю']`; пустое — из действовавшей строки (для всех 7 колонок).
  - `savePlan(dir, {date?, text}, today)` — `text` после `trim` обязателен (`'Пустой план'`), ≤ 20000 символов (`'План — не длиннее 20 000 символов'`); дата по `validDate`; строка с той же датой заменяется.
  - `removePlan(dir, date)` → `{ok, removed}`.
  - `addSupplement(dir, {start?, name, dose, timing, purpose, note}, today)` — `name` обязателен (`'Название БАДа — обязательно'`), все поля ≤ 200 символов; та же пара (`start`, `name`) уже есть → `'Этот БАД с этой даты уже есть'`.
  - `stopSupplement(dir, {start, name, end?}, today)` — `end` по умолчанию `today`, `end >= start` (`'Дата конца — не раньше начала'`), не найден → `'БАД не найден'`.
  - `removeSupplement(dir, {start, name})`.
  - IPC: `health:plan`, `health:removePlan`, `health:supplementAdd`, `health:supplementStop`, `health:supplementRemove` — как `health:targets` (после успеха `store.writeDataJs`). `preload`: `savePlan`, `removePlan`, `addSupplement`, `stopSupplement`, `removeSupplement`.

- [ ] **Step 1: тесты** в `settings.test.js`:
  - `sleep goal alone keeps nutrition and workout goals`: строка `2026-01-01` {protein 120, fat 60, carbs 270, strength_wk 2, cardio_wk 2}; `saveTargets(dir,{sleep:'7,5'},'2026-11-21')` → новая строка: `sleep_h '7.5'`, `protein '120'`, `strength_wk '2'`, `kcal '2100'`.
  - `workout goals out of range`: `{strength: 15}` → `'Силовые — от 0 до 14 в неделю'`; `{sleep: 3}` → `'Сон — от 4 до 12 ч'`.
  - `plan: new version by date, same date replaces, empty refused, remove`.
  - `supplements: two on the same day — stop and remove touch only the chosen one`: добавить `A` и `B` с `2026-11-19`; `stopSupplement({start:'2026-11-19', name:'A', end:'2026-11-20'})` → у `A` `end '2026-11-20'`, у `B` пусто; `removeSupplement({start:'2026-11-19', name:'B'})` → осталась только `A`.
  - `supplement validation`: без названия; повтор пары; конец раньше начала; будущая дата.
- [ ] **Step 2:** `npm test` — падают.
- [ ] **Step 3:** реализовать в `settings.js` (запись БАДов — `store.read` → изменить → `store.write`), IPC и `preload`.
- [ ] **Step 4:** `npm test` — зелёное.
- [ ] **Step 5: коммит** «Настройки: план, БАДы, цели сна и тренировок — логика и IPC».

### Task 3: dataset.js — силовые и кардио, цели, план

**Files:**
- Modify: `portal/dataset.js`
- Test: `desktop/test/portal_dataset.test.js`

**Interfaces:**
- Produces в `DATA`: `kind` тренировки ∈ `strength | cardio | walk` (`walk` = не тренировка); `DATA.goals` = действующая на `DATA.updated` строка `targets.csv` или `{}`; `DATA.plan_now` = `{start, text}` действующей строки `plans.csv` или `null`; `DATA.plans` (все, по дате); `DATA.supplements` как было. Нет: `DATA.k2`, `DATA.waist`, `DATA.photo_notes`, `DATA.checkins`, `DATA.labs`, `DATA.plan`, `DATA.priorities`, `DATA.photos_summary`.
- Классификация: вид из `STRENGTH` → `strength`; `walking` → `walk`; иначе `cardio`, но `cardio` короче 20 мин (`duration_min < 20`) → `walk`. Метки: `strength` → strength, `none` → walk, `squash`/`cardio`/`other` → cardio (правило 20 минут к меткам не применяется). `CARDIO`, `CARDIO_ZONES`, `sportKind`, режимы — удалить.

- [ ] **Step 1: тесты.** Заменить тесты режимов (`portal_dataset.test.js:34-43, 69-85`) на `strength and cardio for everyone`: weightlifting_msk → strength; squash 60 мин, running 30, activity 40, dance 118 → cardio; cycling 15 → walk; walking → walk; метка `squash` на cycling 15 → cardio; метка `none` на squash → walk. Тест `waist`/`photo_notes` — удалить. Новый: `goals and plan in effect`: targets `2026-01-01` {sleep_h 7}, `2026-12-01` {sleep_h 8}, plans `2026-11-16`, `updated 2026-11-21` → `goals.sleep_h === 7`, `plan_now.start === '2026-11-16'`; без строк → `{}` и `null`. `raw()` в тесте — `meta: {}`.
- [ ] **Step 2:** `npm test` — падают.
- [ ] **Step 3:** реализовать.
- [ ] **Step 4:** `npm test` — тесты dataset зелёные (страницы — задача 4).
- [ ] **Step 5:** коммит вместе с задачей 4 (страницы без неё не работают).

### Task 4: Страницы

**Files:**
- Modify: `portal/dashboard.html`, `portal/training.html`, `portal/recovery.html`, `portal/photos.html`, `portal/photos_core.js`, `portal/settings.html`
- Test: `desktop/test/portal_render.test.js`, `desktop/test/portal_photos.test.js:332`, `desktop/test/portal_pages.test.js` (если проверяет удалённое)

**Interfaces:**
- Consumes: `DATA.goals.{sleep_h, strength_wk, cardio_wk}`, `DATA.plan_now`, `DATA.plans`, `kind` из задачи 3; `window.health.savePlan/removePlan/addSupplement/stopSupplement/removeSupplement` из задачи 2.

- [ ] **Step 1: тесты (RENDER).** В `portal_render.test.js`:
  - пустые блоки скрыты: список `['supps','plan']`; блоков `events`, `labs`, `good`, плашек приоритетов нет в DOM.
  - `plan text escaped on the dashboard`: `plans.csv` с текстом `TAG` (`<img src=x onerror=…>` как в существующем тесте экранирования) и второй строкой → в DOM `&lt;img`, нет `<img src=x`, есть «с 16 нояб».
  - `no goals: pages render`: без `targets.csv` — сводка содержит «Силовые, 4 нед» без « / », «Кардио»; «Восстановление» рисуется.
  - тест «no squash in plan» (`:78`) → `«Кардио» on «Тренировки» for everyone`; тест экранирования событий → только БАДы.
  - тест на настоящих данных (`:160-171`): вместо `meta.priorities`/`meta.plan.workouts` — если в `targets.csv` есть `strength_wk` → `/ ${s*4}`; если есть `plans.csv` — `<h2>План`.
  - `portal_photos.test.js:332` — без `photo_notes`/`photos_summary`.
- [ ] **Step 2:** `RENDER=1 npm test` — падают.
- [ ] **Step 3: сводка.** `PW = {strength: goals.strength_wk, cardio: goals.cardio_wk}` (нет обоих — `null`); `K2` → всегда `cardio`/«Кардио»/«кардио»; стеки без `other`; цель сна — `goals.sleep_h`; карточка `#card-plan`: заголовок «План» + бейдж «с <дата>», текст — `esc(text)` в элементе с `white-space: pre-wrap`; удалить `#card-good`, `#prio`, `#card-events`, `#card-labs`, плитки «Самочувствие» и «Талия», график талии; подвал — «Данные: FatSecret (питание, вес), Whoop (сон, восстановление, тренировки, шаги); цели, план, БАДы, алкоголь — в приложении.»; пустые БАДы — «Добавьте в Настройках».
- [ ] **Step 4: «Тренировки».** Всё как на сводке: две группы, `PW` из `goals`, `KIND_LAB.walk` не нужен в легенде; «без вида» (`unl`) — `sport === 'activity'` среди тренировок.
- [ ] **Step 5: «Восстановление».** `SLEEP_T = DATA.goals.sleep_h || 7.5`.
- [ ] **Step 6: «Фото».** Убрать заметки к снимкам (`#notes`) и общий вывод; из `photos_core.js` — `summary`, `notes`.
- [ ] **Step 7: «Настройки».** В «Цели» — поля `sleep` («Сон, ч», `inputmode=decimal`), `strength` («Силовые в неделю»), `cardio` («Кардио в неделю»), подсказки из действующей цели; в истории целей — колонки «сон, ч», «силовые», «кардио». Новая карточка «План» после «Целей»: «Действует с» (сегодня, max сегодня), `textarea` (≈12 строк, заполнена текстом действующего плана), «Сохранить»; история: дата, первая строка, «показать» (раскрывает весь текст, через `esc`), «удалить» (confirm). Карточка «БАДы»: таблица «сейчас», затем «раньше» (серым): название, доза, когда, зачем, с, по; у текущих — «прекратить» (prompt даты, по умолчанию сегодня), у всех — «удалить» (confirm); форма добавления: название, доза, когда, зачем, заметка, с даты. После успеха — `location.reload()`, ошибка — текстом рядом с кнопкой. Все значения из данных — через `esc`.
- [ ] **Step 8:** `RENDER=1 npm test` — зелёное. Окно без клика: `HEALTH_DOCUMENTS=<временная папка> HEALTH_SMOKE=1 HEALTH_PAGE=settings.html npx electron .` — страница без ошибок.
- [ ] **Step 9:** CHANGELOG «Не выпущено»: Новое — план свободным текстом и БАДы в «Настройках» с историей; цели сна и тренировок в неделю. Изменено — тренировки делятся на силовые и кардио (сквош — кардио; кардио короче 20 минут не считается). Удалено — самочувствие, талия и % жира, анализы, события кроме алкоголя, заметки и вывод по фото. **Коммит** задач 3–4 «Силовые и кардио; план, БАДы и цели на страницах и в настройках; убраны самочувствие, талия, анализы, события, заметки к фото».

### Task 5: README папки данных и документы

**Files:**
- Create: `desktop/data_readme.md`
- Modify: `desktop/store.js` (`writeDataJs`), `desktop/package.json` (`build.files` += `data_readme.md`), `docs/07_формат_данных.md`, `CLAUDE.md`, `README.md`, `desktop/CHANGELOG.md`
- Test: `desktop/test/store.test.js`, `desktop/test/build_files.test.js`

**Interfaces:**
- Produces: `store.writeDataJs(dir, today, mods)` также пишет `<dir>/README.md` = содержимое `desktop/data_readme.md` (перезапись, только если отличается).

- [ ] **Step 1: тесты.** `store.test.js` — `writeDataJs writes README.md from the template`: после вызова `README.md` в папке равен файлу шаблона. `build_files.test.js` — `data_readme.md` в `build.files`.
- [ ] **Step 2:** `npm test` — падают.
- [ ] **Step 3:** шаблон — по-русски, для LLM: назначение папки; таблица файлов из `docs/07` в новой схеме (колонки, что в строке, источник: FatSecret / Whoop / «Настройки» / «Восстановление» / разметка алкоголя); особенности (день < 1200 ккал — незаполненный; день Whoop = день после сна; шаги — за цикл, сегодняшние неполные; `activity` = вид не указан; силовые / кардио / не тренировка — правило из задачи 3; цели и план действуют с даты до следующей строки; пустой `end` у БАДа = принимает сейчас); `archive/` — старое, не текущие данные; `photos/`; `secrets/` — не читать и не пересылать; `data.js` — копия CSV для страниц. Реализация в `writeDataJs`; `build.files`.
- [ ] **Step 4:** `docs/07` — правила записи для разработчика + «описание файлов — `desktop/data_readme.md`» (таблицу не дублировать). `CLAUDE.md` — структура (meta.json → только `alcohol_from`; plans.csv; README в папке данных), «Тренировки» → силовые и кардио; `README.md` проекта — если упоминает удалённое. CHANGELOG — пункт «в папке данных появился README.md с описанием файлов».
- [ ] **Step 5:** `npm test`, `RENDER=1 npm test`, `node scripts/public_check.js` — зелёное. **Коммит** «README в папке данных: описание файлов для LLM; документы».

### Task 6: Сборка и чистка папки данных (вручную, не код)

- [ ] **Step 1:** `cd desktop && npm run app:mac` — сборка, установка, запуск.
- [ ] **Step 2:** папка данных пользователя: `archive/2026-11-22/` ← копии `meta.json`, `events.csv`, `body.csv`, `checkins.csv`, `labs.csv`, `photo_notes.csv`; удалить `checkins.csv`, `labs.csv`, `photo_notes.csv`; `events.csv` — только алкоголь; `body.csv` — переписать через `store.write` (колонки талии уйдут); `meta.json` — оставить `alcohol_from`. Пересобрать `data.js` (`node scripts/csv.js` или кнопка «Обновить данные»).
- [ ] **Step 3:** `CLAUDE.local.md` — убрать «записывать … талия, анализы»; план — в «Настройках».
- [ ] **Step 4:** сказать пользователю, что проверить: «Настройки» — цели сна/тренировок, план, БАДы; сводка — «План», «Силовые / Кардио».
