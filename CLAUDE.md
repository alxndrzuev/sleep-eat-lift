# SEL (sleep · eat · lift) — приложение «Здоровье»: питание, сон и тренировки (FatSecret + Whoop)

Приложение для Mac на Electron: данные FatSecret (питание, вес) и Whoop (сон, восстановление, тренировки, шаги) — в CSV
папки данных пользователя, страницы с графиками и целями. Обзор для человека — README.md.

**Личное — в `CLAUDE.local.md`** (не в git): чьи это данные, цели и приоритеты, как вести разборы, особенности данных.
Если его нет — работаем только с кодом. Репозиторий публичный: в git — только программа и общие документы.

## Структура
```
CLAUDE.md                ← этот файл · README.md — обзор проекта для человека (состав, запуск, безопасность, карта документов)
CLAUDE.local.md          ← личное (не в git)
docs/                    ← 06 фото: как снимать и разбирать · 07 формат данных (CSV) · privacy-policy.html (для экрана входа Whoop)
                           · superpowers/ — дизайн и планы приложения
                           · logo/ — логотип SEL (sleep · eat · lift): sel-mark.svg, sel-logo-light/dark.svg (плитки — README);
                             sel-icon.svg — значок приложения (три дуги) → desktop/build/icon.png, 1024×1024, прозрачные углы
~/Documents/Здоровье/data ← ВСЁ ЛИЧНОЕ (вне проекта, БЕЗ git) — путь берётся из настроек приложения
                           (~/Library/Application Support/Здоровье/config.json → dataDir; scripts/lib.py → find_data; HEALTH_DATA — подменить).
                           Ниже и в тексте «data/» = эта папка. Формат — docs/07_формат_данных.md
  *.csv                  ← вся история (только дописываем)
  meta.json              ← план, «хорошая неделя», журнал, приоритеты, вывод по фото, alcohol_from
  data.js                ← сырые таблицы для страниц (const RAW), пишет приложение; расчёт — portal/dataset.js
  photos/                ← фото формы: originals/ · aligned/ · view/ · thumbs/ · photos.js (индекс) — docs/06
  secrets/               ← ключи приложений и токены FatSecret, Whoop — не показывать в чате
  docs/                  ← личные документы (профиль, план, журнал, решения, анализ)
  inbox/                 ← черновики разборов и временные файлы
desktop/                 ← ПРИЛОЖЕНИЕ «Здоровье» (Electron) — основной интерфейс, см. «Приложение»
portal/                  ← страницы приложения: dashboard.html (сводка), nutrition.html, training.html, recovery.html, photos.html, settings.html,
                           whatsnew.html (вся история версий) + whatsnew.js (окно «Что нового» после обновления, на всех страницах)
                           common.css + common.js — тема, каркас, движок графиков; пустая страница (data-needs) → «Подключите…»
                           Календарь (.hm: SVG-ячейки <rect class="c" data-d>) — типовой элемент: подсказка только через
                           calTips(el, ds=>html) из common.js (живёт вне прокрутки, у нижних ячеек — над ячейкой); свою не писать (тест)
                           Ещё в common.js: периоды кнопок #range — periodDays/prevDays, плитки #tiles — tileCards.
                           **Текст из CSV и от сервисов (заметки, вид спорта, описания) — в innerHTML только через esc()** (тест RENDER=1);
                           meta.json пишем мы сами, в нём бывает разметка — его не экранируем
                           dataset.js — расчёт DATA из RAW; nav.js — меню по данным, «Обновить данные», статус, подвалы fatsecret/Whoop
                           photos_core.js (логика, тесты через jsc) + photos_app.js (загрузка, HEIC, поиск фигуры, выравнивание)
                           photos_fs.js — папка фото в приложении · vendor/ — библиотеки «Фото» (MediaPipe, libheif, exifr; в git, ~35 МБ)
scripts/                 ← только стандартная библиотека Python 3 — для разборов с Claude и служебного
  lib.py                 ← схема CSV (SCHEMA, KEY, SORT, TEXT — копия в desktop/schema.json), чтение/запись/upsert, папка данных
  weekly_review.py       ← черновик субботнего разбора (печатает markdown)
  alcohol_check.py       ← подсчёт вечеров с алкоголем для разбора (разметку ночей ведёт приложение)
  vendor_fetch.py        ← библиотеки страницы «Фото» → portal/vendor/ (фиксированные версии, хэши; `--check`)
  public_check.py        ← перед коммитом: в репозитории нет личного из папки данных, почта автора — noreply
tests/                   ← Python unittest: lib, формат данных, страницы (jsc), черновик разбора; RENDER=1 — отрисовка в Chrome
dist/                    ← собранные приложения (не в git)
```

## Приложение (desktop/, Electron, пока только Mac) — установлено в /Applications, данные смотрим в нём
- Дизайн и план — `docs/superpowers/specs/2026-11-21-electron-app-design.md`, `docs/superpowers/plans/2026-11-21-electron-app.md`
- Папку данных спрашивает при первом запуске (по умолчанию `Документы/Здоровье/data`); «Сменить папку…» — в «Настройках».
  FatSecret и Whoop — кнопками в «Настройках»; обновление — при запуске и кнопкой «Обновить данные» (Whoop → разметка ночей
  алкоголя за 30 дней, не раньше `meta.alcohol_from`). Цели КБЖУ и веса — в «Настройках», с любой даты, ккал = 4·Б + 9·Ж + 4·У.
  Алкоголь — на «Восстановлении»: ответы «Мало / Умеренно / Много / Не было», ручное добавление, удаление (events.csv → level)
- Тренировки: у кого в `meta.plan.workouts` есть сквош — «Сквош» (основной пользователь), иначе «Кардио» (вид спорта или пульс в зонах 2–5)
- Код: `main.js` (окно, протокол app://h/, IPC), `protocol.js` (что отдаёт app://h/ + CSP: страницы ничего не грузят и не шлют наружу), `store.js` (CSV как lib.py), `fatsecret.js`, `whoop.js`, `alcohol.js`, `updater.js`,
  `settings.js`, `photosfs.js`, `secrets.js` (токены дописываются, ключи приложений не трогаются), `keys.js`, `datadir.js`, `preload.js`,
  `changelog.js` (разбор CHANGELOG.md, версии, выпуск), `whatsnew.js` (что показать после обновления)
- Тесты: `cd desktop && npm test` (эталоны прежних Python-скриптов — `desktop/test/fixtures`); окно без клика —
  `HEALTH_DOCUMENTS=<папка> HEALTH_SMOKE=1 [HEALTH_PAGE=… HEALTH_SMOKE_JS=… HEALTH_SMOKE_SHOT=…] npx electron .`
- Сборка: `cd desktop && npm run dist:mac` → `dist/Здоровье-<версия>-mac-arm64.zip` и `…-x64.zip` (ad-hoc подпись; собирается в
  ~/Library/Caches/health-app-build — в «Документах» codesign падает). Ключи приложений берёт из `<папка данных>/secrets`:
  FatSecret — `fatsecret_app.json`, пока нет — consumer-поля из `fatsecret.json` (временно); Whoop — `whoop_app.json`.
  Проверка приватности после сборки встроена. Каждый модуль, который подключает main.js, — в `build.files` (тест)
- **Правило: функционал готов (тесты прошли, коммит) — сразу `cd desktop && npm run app:mac`**, не спрашивая: сборка →
  открытое «Здоровье» закрывается → новое ставится в /Applications (вместо старого) → открывается для проверки. Сказать
  пользователю, что именно проверить. Не собирать, если упала сборка/тесты или в рабочей папке чужие незакоммиченные правки
- **Версии и «Что нового»** (дизайн — `docs/superpowers/specs/2026-11-22-release-notes-design.md`): SemVer X.Y.Z —
  X: нужен шаг пользователя / нельзя откатиться (папка данных, переподключение, системные требования), Y: новые
  возможности, Z: исправления. Заметки — `desktop/CHANGELOG.md` (Keep a Changelog по-русски: Новое / Изменено /
  Исправлено / Удалено / Безопасность). **Каждое заметное для пользователя изменение приложения — пункт в «Не выпущено»**
  в том же коммите: для знакомых, «что изменилось для вас», без имён файлов. Выпуск — `cd desktop && npm run release X.Y.Z`
  (дата, версия в package.json и lock, коммит «Выпуск X.Y.Z», тег vX.Y.Z), потом `npm run dist:mac`; без заметок к версии
  сборка не идёт. Окно — один раз после обновления (`lastSeenVersion` в `~/Library/Application Support/Здоровье/config.json`;
  новичку — нет); проверка — `HEALTH_WHATSNEW=0.0.0` к запуску без клика (из папки проекта видно и «Не выпущено»)
- Electron пересобирать раз в полгода; при правке CSV-схемы — `desktop/schema.json` (тест сверяет с lib.py)

## Хранение данных
- **Всё личное — только в папке данных** (CSV, `meta.json`, фото, ключи, черновики). В проекте — только программа и документы
- Вся история — в `data/*.csv`, только дописываем; формат — `docs/07_формат_данных.md`, колонки — `SCHEMA` в `scripts/lib.py`
  (+ `desktop/schema.json`, тест). Новые колонки — только в конец (старые файлы читаются)
- Писать в CSV: в Python — только `lib.write` / `lib.upsert`; в приложении — `store.write` / `store.upsert` (порядок колонок, сортировка, LF)
- **После любых правок кода — тесты:** `python3 -m unittest discover -s tests` и `cd desktop && npm test`. Новая логика — новый тест
- **Цели (КБЖУ, целевой вес) задаёт только пользователь** — в «Настройках» приложения или в чате → новая строка в `targets.csv` /
  `goal_weight.csv` с даты вступления; старые не трогать; из FatSecret цели не берём
- **Перед каждым коммитом — `python3 scripts/public_check.py`**: в репозитории нет строк из CSV папки данных и значений из secrets/
  (тест делает то же, если папка данных есть). Почта автора — noreply GitHub (git config в репозитории)
- Git: после изменений кода — коммит; push в GitHub (`origin` — github.com/alxndrzuev/sleep-eat-lift, публичный;
  HTTPS через `gh auth git-credential`, настройка в репозитории) — только по просьбе пользователя. Данные вне git — резервные копии на совести Time Machine

## Важные особенности данных
- Дни в FatSecret < 1200 ккал — незаполненные, в средние не идут
- Whoop: день = день после ночного сна; шаги — за цикл (от сна до сна), сегодняшние неполные; токен обновляется сам, Cloudflare требует свой User-Agent
- Тип тренировки Whoop `activity` = вид не указан (считается «Другое», пока нет метки в `workout_labels.csv`)
