# FatSecret по ссылке — план

> Выполняется в этой сессии (пользователь: «делай»).

**Goal:** ссылка для входа в FatSecret другого человека и ввод его кода — в «Настройках» открытого профиля.
**Architecture:** request_token с `oob` сохраняется в `secrets/fatsecret_link.json` профиля; код меняется на токены той же
`fatsecret.accessToken`; проводка — main.js/preload.js; карточка FatSecret на settings.html.
**Tech Stack:** Electron, Node 26, node:test.
**Spec:** `docs/superpowers/specs/2026-11-24-fatsecret-link-design.md`

## Global Constraints
- Файл ссылки — права 600, только в `secrets/` профиля; в git ничего личного (`node scripts/public_check.js`).
- Текст из сервисов в innerHTML — только через esc(); ссылку ставим в value поля.
- Пункт в «Не выпущено» CHANGELOG.md; `docs/07`/`data_readme.md` — про новый файл в secrets.

## Review Focus
- Код пришёл после переключения профиля — ключи ложатся в профиль, где сделана ссылка (папка берётся при открытом профиле; код вводится на его «Настройках»).
- Неверный код / устаревшая ссылка — понятная ошибка, файл ссылки остаётся.
- Пустой или битый `fatsecret_link.json` — как будто ссылки нет.
- Одновременно идёт вход «по коду» во встроенном окне — код идёт к нему, не к ссылке.
- «Отключить» после подключения по ссылке — обычное (ссылки уже нет).

### Task 1: хранение ссылки (`fatsecret.js`)
- `link.save(dir, {token, secret, url}, now)` → пишет `{token, secret, url, created}` в `dir/secrets/fatsecret_link.json` (600)
- `link.read(dir)` → объект или null (нет файла, битый JSON, нет token/secret)
- `link.clear(dir)` → удаляет файл, если есть
- `codeError(e)` → для `e.kind === 'api'` — FatSecretError с текстом `TEXTS.code` = «Код не подошёл или ссылка устарела — проверьте код или сделайте новую ссылку»; иначе e
- Тесты в `test/fatsecret.test.js`: сохранение/чтение/права 600/очистка; битый файл → null; codeError.

### Task 2: проводка (`main.js`, `preload.js`)
- `makeLink()`: appKey → requestToken(key,'oob') → link.save(DATA, …) → `{ok, url}`; `delete pending.fatsecret`.
- `finishFatSecret(verifier, token)`: источник — pending (если есть и это его вход) иначе link.read(DATA); ошибка FatSecret → codeError; удачно → link.clear(dir).
- status(): `fatsecretLink: {url, created}` | null.
- IPC `health:fsLink` (создать), `health:fsLinkCancel`; preload `fatsecretLink()`, `fatsecretLinkCancel()`.

### Task 3: «Настройки» (`portal/settings.html`) + тест источника
- Кнопка «Ссылка для другого человека» рядом с «Подключить» (видна, когда не подключено и есть ключ).
- Блок `.link`: поле с ссылкой (readonly), «Скопировать», «Отменить», пояснение; поле кода видно при `s.oob || s.fatsecretLink`.
- Тест в `portal_pages.test.js`: settings.html вызывает `fatsecretLink(` и `fatsecretLinkCancel(`; preload их отдаёт.

### Task 4: заметки, документы, коммит, сборка
- CHANGELOG «Не выпущено» → Новое; data_readme.md + docs/07 — `fatsecret_link.json`.
- `npm test`, `RENDER=1 npm test`, public_check, коммит, `npm run app:mac`.
