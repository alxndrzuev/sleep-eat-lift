# SEL (sleep · eat · lift) — приложение (до 1.1.0 — «Здоровье»): питание, сон и тренировки (FatSecret + Whoop)

Приложение для Mac на Electron: данные FatSecret (питание, вес) и Whoop (сон, восстановление, тренировки, шаги) — в CSV
папки данных пользователя, страницы с графиками и целями. Обзор для человека — README.md.

**Личное — в `CLAUDE.local.md`** (не в git): чьи это данные, цели и приоритеты, особенности данных.
Если его нет — работаем только с кодом. Репозиторий публичный: в git — только программа и общие документы.

## Структура
```
CLAUDE.md                ← этот файл · README.md — обзор проекта для человека (состав, запуск, безопасность, карта документов)
CLAUDE.local.md          ← личное (не в git)
docs/                    ← 06 фото: как снимать и разбирать · 07 формат данных (CSV) · privacy-policy.html (для экрана входа Whoop)
                           · superpowers/ — дизайн и планы приложения
                           · logo/ — логотип SEL (sleep · eat · lift): sel-mark.svg, sel-logo-light/dark.svg (плитки — README);
                             sel-icon.svg — значок приложения (три дуги) → desktop/build/icon.png, 1024×1024, прозрачные углы
~/Documents/SEL/data      ← ВСЁ ЛИЧНОЕ (вне проекта, БЕЗ git) — путь берётся из настроек приложения
                           (~/Library/Application Support/SEL/config.json → dataDir; scripts/csv.js → dataDir; HEALTH_DATA — подменить).
                           Ниже и в тексте «data/» = эта папка. Формат — docs/07_формат_данных.md
  *.csv                  ← вся история (только дописываем)
  README.md              ← описание папки для LLM (пишет приложение из desktop/data_readme.md — править там)
  meta.json              ← только alcohol_from; план — plans.csv, цели — targets.csv / goal_weight.csv
  data.js                ← сырые таблицы для страниц (const RAW), пишет приложение; расчёт — portal/dataset.js
  photos/                ← фото формы: originals/ · aligned/ · view/ · thumbs/ · photos.js (индекс) — docs/06
  secrets/               ← ключи приложений и токены FatSecret, Whoop — не показывать в чате
  docs/                  ← личные документы (профиль, план, журнал, решения, анализ)
  inbox/                 ← временные файлы
desktop/                 ← ПРИЛОЖЕНИЕ SEL (Electron) — основной интерфейс, см. «Приложение»
portal/                  ← страницы приложения: dashboard.html (сводка), nutrition.html, training.html, recovery.html, photos.html, settings.html,
                           whatsnew.html (вся история версий) + whatsnew.js (окно «Что нового» после обновления, на всех страницах)
                           common.css + common.js — тема, каркас, движок графиков; пустая страница (data-needs) → «Подключите…»
                           Календарь (.hm: SVG-ячейки <rect class="c" data-d>) — типовой элемент: подсказка только через
                           calTips(el, ds=>html) из common.js (живёт вне прокрутки, у нижних ячеек — над ячейкой); свою не писать (тест)
                           Ещё в common.js: периоды кнопок #range — periodDays/prevDays, плитки #tiles — tileCards.
                           **Текст из CSV и от сервисов (заметки, вид спорта, описания) — в innerHTML только через esc()** (тест RENDER=1);
                           meta.json пишем мы сами, в нём бывает разметка — его не экранируем
                           dataset.js — расчёт DATA из RAW; nav.js — меню по данным, «Обновить данные», статус, подвалы fatsecret/Whoop
                           photos_core.js (логика, тесты в Node) + photos_app.js (загрузка, HEIC, поиск фигуры, выравнивание)
                           photos_fs.js — папка фото в приложении · vendor/ — библиотеки «Фото» (MediaPipe, libheif, exifr; в git, ~35 МБ)
scripts/                 ← Node без зависимостей (берёт модули из desktop/) — служебное
  csv.js                 ← данные из чата: `node scripts/csv.js upsert body.csv '{"2026-11-22": {"weight_kg": 75.4}}'`
                           (тот же store.js, что в приложении; пересобирает data.js) · read <файл> [N] · remove · dir
  vendor_fetch.js        ← библиотеки страницы «Фото» → portal/vendor/ (фиксированные версии, хэши; `--check`)
  public_check.js        ← перед коммитом: в репозитории нет личного из папки данных, почта автора — noreply
dist/                    ← собранные приложения (не в git)
```

## Приложение (desktop/, Electron, Mac и Windows) — на Mac установлено в /Applications, данные смотрим в нём
- Дизайн и план — `docs/superpowers/specs/2026-11-21-electron-app-design.md`, `docs/superpowers/plans/2026-11-21-electron-app.md`
- Папку данных спрашивает при первом запуске (по умолчанию `Документы/SEL/data`); «Сменить папку…» — в «Настройках».
  Прежнее имя «Здоровье»: настройки из `Application Support/Здоровье` SEL переносит сам при первом запуске (datadir.migrate),
  установщик удаляет `/Applications/Здоровье.app`
  FatSecret и Whoop — кнопками в «Настройках»; обновление — при запуске и кнопкой «Обновить данные» (Whoop → разметка ночей
  алкоголя за 30 дней, не раньше `meta.alcohol_from`). Цели (КБЖУ, вес, сон, силовые и кардио в неделю), план (свободный текст) и БАДы — в «Настройках»,
  с любой даты, с историей; ккал = 4·Б + 9·Ж + 4·У.
  Алкоголь — на «Восстановлении»: ответы «Мало / Умеренно / Много / Не было», ручное добавление, удаление (events.csv → level)
- Тренировки у всех: силовые (силовые виды Whoop) и кардио (всё остальное от 20 минут); прогулки и кардио короче 20 минут — не тренировки
- Код: `main.js` (окно, протокол app://h/, IPC), `protocol.js` (что отдаёт app://h/ + CSP: страницы ничего не грузят и не шлют наружу), `store.js` (чтение и запись CSV), `fatsecret.js`, `whoop.js`, `alcohol.js`, `updater.js`,
  `settings.js`, `photosfs.js`, `secrets.js` (токены дописываются, ключи приложений не трогаются), `keys.js`, `datadir.js`, `preload.js`,
  `changelog.js` (разбор CHANGELOG.md, версии, выпуск), `whatsnew.js` (что показать после обновления),
  `data_readme.md` (README папки данных — описание файлов для LLM; меняется схема — правим и его)
- Тесты: `cd desktop && npm test` — приложение, страницы portal/ (их скрипты выполняются в Node: test/_portal.js),
  настоящая папка данных (формат, если есть), scripts/; `RENDER=1 npm test` — ещё и отрисовка страниц в Chrome.
  Эталоны прежних Python-скриптов — `desktop/test/fixtures`; окно без клика —
  `HEALTH_DOCUMENTS=<папка> HEALTH_SMOKE=1 [HEALTH_PAGE=… HEALTH_SMOKE_JS=… HEALTH_SMOKE_SHOT=…] npx electron .`
- Сборка: `cd desktop && npm run dist:mac` → `dist/SEL-<версия>-mac-arm64.zip` и `…-x64.zip` (ad-hoc подпись; собирается в
  ~/Library/Caches/health-app-build — в «Документах» codesign падает). Ключи приложений берёт из `<папка данных>/secrets`:
  FatSecret — `fatsecret_app.json`, пока нет — consumer-поля из `fatsecret.json` (временно); Whoop — `whoop_app.json`.
  Windows — `npm run dist:win` (с этого Mac, без Wine) → `dist/SEL-<версия>-win-x64.exe` (portable, без подписи — SmartScreen
  предупредит; запуск exe здесь не проверить — нужна Windows). Меню обеих систем — `menu.js` (тест).
  Проверка приватности после сборки встроена. Каждый модуль, который подключает main.js, — в `build.files` (тест)
- **Правило: функционал готов (тесты прошли, коммит) — сразу `cd desktop && npm run app:mac`**, не спрашивая: сборка →
  открытое SEL закрывается → новое ставится в /Applications (вместо старого) → открывается для проверки. Сказать
  пользователю, что именно проверить. Не собирать, если упала сборка/тесты или в рабочей папке чужие незакоммиченные правки
- **Версии и «Что нового»** (дизайн — `docs/superpowers/specs/2026-11-22-release-notes-design.md`): SemVer X.Y.Z —
  X: нужен шаг пользователя / нельзя откатиться (папка данных, переподключение, системные требования), Y: новые
  возможности, Z: исправления. Заметки — `desktop/CHANGELOG.md` (Keep a Changelog по-русски: Новое / Изменено /
  Исправлено / Удалено / Безопасность). **Каждое заметное для пользователя изменение приложения — пункт в «Не выпущено»**
  в том же коммите: для знакомых, «что изменилось для вас», без имён файлов. Выпуск — `cd desktop && npm run release X.Y.Z`
  (дата, версия в package.json и lock, коммит «Выпуск X.Y.Z», тег vX.Y.Z), потом `npm run dist:mac`; без заметок к версии
  сборка не идёт. Окно — один раз после обновления (`lastSeenVersion` в `~/Library/Application Support/SEL/config.json`;
  новичку — нет); проверка — `HEALTH_WHATSNEW=0.0.0` к запуску без клика (из папки проекта видно и «Не выпущено»)
- Electron пересобирать раз в полгода; схема CSV — только `desktop/schema.json`

## Хранение данных
- **Всё личное — только в папке данных** (CSV, `meta.json`, фото, ключи, черновики). В проекте — только программа и документы
- Вся история — в `data/*.csv`, только дописываем; формат — `docs/07_формат_данных.md`, колонки — `desktop/schema.json`
  (единственное место). Новые колонки — только в конец (старые файлы читаются)
- Писать в CSV — только через `desktop/store.js` (`store.write` / `store.upsert`; из чата — `node scripts/csv.js`): порядок колонок, сортировка, LF
- **После любых правок кода — тесты:** `cd desktop && npm test` (страницы трогали — `RENDER=1 npm test`). Новая логика — новый тест
- **Цели (КБЖУ, целевой вес) задаёт только пользователь** — в «Настройках» приложения или в чате → новая строка в `targets.csv` /
  `goal_weight.csv` с даты вступления; старые не трогать; из FatSecret цели не берём
- **Перед каждым коммитом — `node scripts/public_check.js`**: в репозитории нет строк из CSV папки данных и значений из secrets/
  (тест делает то же, если папка данных есть). Почта автора — noreply GitHub (git config в репозитории)
- Git: после изменений кода — коммит; push в GitHub (`origin` — github.com/alxndrzuev/sleep-eat-lift, публичный;
  HTTPS через `gh auth git-credential`, настройка в репозитории) — только по просьбе пользователя. Данные вне git — резервные копии на совести Time Machine

## Важные особенности данных
- Дни в FatSecret < 1200 ккал — незаполненные, в средние не идут
- Whoop: день = день после ночного сна; шаги — за цикл (от сна до сна), сегодняшние неполные; токен обновляется сам, Cloudflare требует свой User-Agent
- Тип тренировки Whoop `activity` = вид не указан (считается «Другое», пока нет метки в `workout_labels.csv`)
