# «Что нового» и версии — план работ

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** заметки к версиям в `desktop/CHANGELOG.md`, окно «Что нового» после обновления, страница всей истории, выпуск
одной командой и сборка, которая не пропускает версию без заметок.

**Architecture:** разбор и логика версий — `desktop/changelog.js` (Node, без Electron); main.js отдаёт страницам данные по IPC
и хранит `lastSeenVersion` в `userData/config.json` (через datadir.js); показ — `portal/whatsnew.js` (окно и вёрстка) и
`portal/whatsnew.html` (вся история).

**Tech Stack:** Electron 45, Node `node:test`, Python unittest + jsc для кода страниц, без новых зависимостей.

**Spec:** `docs/superpowers/specs/2026-11-22-release-notes-design.md`

## Global Constraints
- Всё на русском; тексты заметок — для пользователя, без имён файлов и внутреннего устройства.
- Версия — `X.Y.Z` (только цифры); заголовок версии — `## [X.Y.Z] — YYYY-MM-DD` (длинное тире), сверху `## [Не выпущено]`.
- Разделы: `Новое`, `Изменено`, `Исправлено`, `Удалено`, `Безопасность` — в этом порядке.
- Нет `lastSeenVersion`, но есть `dataDir` → считать `0.1.0`; нет `dataDir` (новичок) → окна нет.
- `HEALTH_DOCUMENTS` — `config.json` не трогать; `HEALTH_WHATSNEW=<версия>` — показать как после неё.
- Тесты после правок: `python3 -m unittest discover -s tests` и `cd desktop && npm test`. Коммит — только своих файлов.

## Review Focus
- Страница перезагружается после обновления данных при запуске → окно должно появиться снова, пока не нажали «Понятно»
  (тест: `pending` в памяти main не сбрасывается от повторного `health:whatsNew`).
- Пропущены версии (1.0.0 → 1.2.0) → в окне 1.2.0 и 1.1.0, новые сверху (тест `toShow`).
- Откат на старую версию (lastSeen 1.2.0, текущая 1.0.0) → окна нет, `lastSeenVersion` не понижается (тест `toShow`/`seenAfter`).
- В заметке `<`, `&` → показываются как текст, не HTML (тест рендера через jsc).
- «Не выпущено» пустое / номер не больше текущего / неверный формат → выпуск отказывает, файлы не меняются (тест `release`).

---

### Task 1: `desktop/changelog.js` — разбор, версии, что показать, выпуск

**Files:** Create `desktop/changelog.js`, `desktop/test/changelog.test.js`

**Interfaces — Produces:**
- `parse(md: string) → {unreleased: Section[] , releases: Release[]}`; `Release = {version, date, sections}`,
  `Section = {title, items: string[]}`; релизы — в порядке файла (новые сверху); строки-продолжения пункта
  (начинаются с пробелов) склеиваются с пунктом через пробел; текст до первого `##` игнорируется; пустые разделы отбрасываются.
- `cmp(a, b) → -1|0|1` для `X.Y.Z`; `valid(v) → boolean`.
- `history(releases, current) → Release[]` — версии ≤ current, новые сверху.
- `toShow({releases, current, lastSeen, isNew}) → Release[]` — `isNew` → `[]`; иначе версии > lastSeen (null → `'0.1.0'`) и ≤ current.
- `seenAfter(lastSeen, current) → string` — большая из двух (не понижаем).
- `release(md, version, date) → string` (новый текст) или бросает `Error` с русским сообщением:
  `'Номер версии — X.Y.Z, например 1.0.0'`, `'Версия … уже есть в CHANGELOG'`, `'Раздел «Не выпущено» пуст — нечего выпускать'`.
  Результат: пустой `## [Не выпущено]`, под ним `## [version] — date` с прежним содержимым «Не выпущено».

- [ ] Тесты: `parse` (две версии + unreleased, продолжение пункта, пустой раздел выброшен, шапка игнорируется);
  `cmp('1.10.0','1.9.9') === 1`; `toShow` — новичок `[]`, lastSeen null → только > 0.1.0, пропуск двух версий → обе новыми
  сверху, откат → `[]`; `seenAfter('1.2.0','1.0.0') === '1.2.0'`; `release` — перенос, три ошибки, повторный `parse` даёт версию.
- [ ] `npm test` — падает (нет модуля) → реализовать → проходит.

### Task 2: `desktop/CHANGELOG.md` — 0.1.0 и черновик 1.0.0, в сборке

**Files:** Create `desktop/CHANGELOG.md`; Modify `desktop/package.json` (`build.files` += `changelog.js`, `CHANGELOG.md`);
Test `desktop/test/changelog_file.test.js`

- [ ] Шапка: что это, правило номеров (X/Y/Z как в дизайне), правила текста. `## [Не выпущено]` — все основные
  возможности 1.0.0 по страницам («Новое»); `## [0.1.0] — 2026-11-21` — «Первая проверочная сборка».
- [ ] Тест: файл разбирается; версия из package.json есть среди releases с датой; в «Не выпущено»/релизах только
  разрешённые разделы; `CHANGELOG.md` в `build.files`.

### Task 3: приложение — состояние, IPC, меню, окно, страница

**Files:** Modify `desktop/datadir.js` (export `readCfg`, `saveCfg(userData, patch)`), `desktop/main.js`, `desktop/preload.js`,
`portal/settings.html`, все страницы портала (+ `<script src="whatsnew.js">` после nav.js); Create `portal/whatsnew.js`,
`portal/whatsnew.html`; Test `desktop/test/datadir.test.js`, `tests/test_whatsnew_js.py`, `tests/test_portal_review.py`

**Interfaces:**
- preload: `health.whatsNew() → {version, releases}` (что показать в окне), `health.whatsNewSeen()`, `health.changelog() → {version, releases}`.
- main: при старте (после выбора папки): `isNew` = в config.json не было `dataDir` до этого запуска; `pending = toShow(...)`;
  `saveCfg({lastSeenVersion: seenAfter(...)})` (не при `HEALTH_DOCUMENTS`); `HEALTH_WHATSNEW` — lastSeen подменяется,
  isNew=false. Непакетный запуск (`!app.isPackaged`) — «Не выпущено» показывается в истории и окне как версия «Не выпущено»
  (проверка черновика). `whatsNewSeen` обнуляет pending.
- Меню Mac: роли appMenu, fileMenu, editMenu, viewMenu, windowMenu + `{role: 'help', label: 'Справка', submenu: [«Что нового в «Здоровье»» → whatsnew.html]}`.
- `portal/whatsnew.js`: `WhatsNew.html(releases) → string` (экранирует HTML, `**x**` → `<b>`; дата «22 ноября 2026»);
  при `window.health` и непустом `whatsNew()` — `<dialog class="whatsnew">` с «Вся история» и «Понятно» (Esc — то же).
  На `whatsnew.html` окно не показывается.
- [ ] Тесты: `saveCfg` сохраняет `dataDir` и добавляет поле; jsc — `WhatsNew.html` экранирует `<&`, жирный, порядок; все
  страницы (включая settings и whatsnew) подключают `whatsnew.js` после `nav.js`.
- [ ] «Настройки»: «Версия X · Что нового» (ссылка на whatsnew.html).

### Task 4: выпуск и защита сборки, документация

**Files:** Create `desktop/scripts/release.js`; Modify `desktop/package.json` (`"release": "node scripts/release.js"`),
`desktop/scripts/prepare.js`, `CLAUDE.md`, дизайн (статус)

- [ ] `release.js <X.Y.Z>`: номер > текущего (`cmp`), `changelog.release(md, v, today)`, версия в package.json и
  package-lock.json (оба поля `version` корня), `git commit -m "Выпуск X.Y.Z" -- <3 файла>`, `git tag -a vX.Y.Z -m <заметки>`.
- [ ] prepare.js: версия без датированной записи в CHANGELOG → `exit 1` с «Нет заметок к версии … — `npm run release`».
- [ ] CLAUDE.md: раздел «Версии и выпуск» (правило номеров, «Не выпущено» дописывать при каждом заметном изменении, команды).

### Task 5: проверка

- [ ] Оба набора тестов зелёные.
- [ ] Окно: `HEALTH_DOCUMENTS=<копия> HEALTH_SMOKE=1 HEALTH_WHATSNEW=0.0.0 HEALTH_SMOKE_SHOT=…` → `dialog.whatsnew` открыт,
  снимок; страница `HEALTH_PAGE=whatsnew.html` — снимок; config.json в userData не изменился.
