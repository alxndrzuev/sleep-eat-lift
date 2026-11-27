# Продукты из дневника FatSecret и окно «Питание по неделям» — план

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** SEL скачивает записи дневника FatSecret в `food_entries.csv` и показывает их в окне «неделя таблицей» на «Питании» с кнопкой «Скопировать картинкой».

**Architecture:** `fatsecret.update` после месячных итогов и веса скачивает `food_entries.get.v2` за 7 дней (14 — если прошлая неделя ещё пуста) и пишет записи по `id` с удалением пропавших. Страница «Питание» получает строки из RAW, группирует их по дням и приёмам (`portal/foodweek.js`, чистые функции) и рисует обе недели в скрытый `<dialog>` сразу при отрисовке. Картинка — снимки видимой части через новый IPC, склейка на canvas в странице, PNG в буфер через main.

**Tech Stack:** Electron, Node 26 (`node:test`), обычный JS страниц портала без сборки.

**Spec:** `docs/superpowers/specs/2026-11-27-nutrition-entries-design.md`

## Global Constraints

- Писать CSV — только `store.upsert` / `store.remove`; колонки — только в `desktop/schema.json`.
- Текст из CSV (`name`, `amount`) — в разметку только через `esc()` из `common.js`.
- Данные тестов — **придуманные**, той же формы, что у FatSecret (`:custom:`, `80s`, `ininini`); настоящих записей дневника в репозитории нет. Перед каждым коммитом — `node scripts/public_check.js`.
- Ошибка любого запроса FatSecret — `{ok:false}`, файлы не пишутся (байт в байт как были).
- Каждое заметное изменение — пункт в `desktop/CHANGELOG.md` → «Не выпущено» в том же коммите.
- После кода — `cd desktop && npm test`; страницы — ещё `RENDER=1 npm test`.
- Картинка — в текущей теме SEL; ничего не пишется на диск и не уходит в сеть.

## Review Focus

1. Записи дня удалили в FatSecret полностью (в ответе нет `food_entry`) → записи этого дня исчезают из `food_entries.csv`. Тест — задача 1.
2. Название продукта с запятой, кавычками или `<img …>` → CSV читается обратно, в окне текст, а не разметка. Тесты — задачи 1 и 3.
3. Неделя выше окна SEL (маленький экран, 20 продуктов в день) → картинка всё равно целая неделя, без повторов и пропусков полос. Тест нарезки — задача 4.
4. Обновление сразу после установки (продуктов ещё нет) → скачиваются 14 дней, обе недели окна заполнены. Тест — задача 1.
5. День, где итог есть, а продуктов нет (старше 7 дней до функции) → итог дня и серое «продукты не загружены», не «не записывал». Тест — задача 3.

---

### Task 1: Записи дневника → `food_entries.csv`

**Files:**
- Modify: `desktop/schema.json`, `desktop/fatsecret.js`, `desktop/main.js:61-62`
- Modify: `docs/07_формат_данных.md`, `desktop/data_readme.md` (строка таблицы после `whoop_workouts.csv`)
- Test: `desktop/test/fatsecret.test.js`

**Interfaces:**
- Produces: файл `food_entries.csv` с колонками `id,date,meal,name,amount,kcal,protein,fat,carbs,fiber,sugar,food_id,serving_id,units`; ключ `id`, сортировка `date`; `meal` ∈ `breakfast|lunch|dinner|other`.
- Produces: `fatsecret.amount(description: string, name: string) → string`; `fatsecret.entries(app, user, ds: 'YYYY-MM-DD', deps) → Promise<Array<row>>` (row — объект с колонками выше, числа — числами); `fatsecret.entryDays(dir, today: Date) → string[]` (даты, по возрастанию); `fatsecret.update({…, today})` → `{ok, days, weights, entries}`.

- [ ] **Step 1: Тест чистки порции**

```js
test('amount: portion text for the window', () => {
  const a = (d, n = 'Чай с лимоном') => fs_.amount(`${d} ${n}`, n);
  assert.strictEqual(a('40 g'), '40 г');
  assert.strictEqual(a('2 medium'), '2 шт');
  assert.strictEqual(a('1 coffee cup'), '1 чашка');
  assert.strictEqual(a('1 cup'), '1 чашка');
  assert.strictEqual(a('2'), '2 шт');
  assert.strictEqual(a('0.2 :custom:20 г'), '20 г');
  assert.strictEqual(a('1/2 :custom:50 г'), '50 г');
  assert.strictEqual(a('80 :custom:80s  г'), '80 г');
  assert.strictEqual(a('1 :custom:1 порцияininini (250 г)'), '1 порция (250 г)');
  assert.strictEqual(a('1 serving'), '1 порция');
  assert.strictEqual(a('3 slices'), '3 slices');          // неизвестное — как есть
});
```

- [ ] **Step 2: Тест разбора дня** — `entries()` на заглушке `food_entries.get.v2`: (а) одна запись объектом, `meal: 'Breakfast'`, числа строками, `fiber` нет → одна строка `{id, date:'2026-11-23', meal:'breakfast', kcal:30, …, fiber:null}`; (б) массив из двух; (в) ответ `{food_entries: null}` → `[]`; (г) `{error:{code:9}}` → отказ с `kind === 'token'`. Дату в запрос — как `di()` в тесте.

- [ ] **Step 3: Тест выбора дней** — `entryDays(dir, new Date(2026, 10, 27))`: пустой файл → 14 дат `2026-11-14 … 2026-11-27`; есть строка за `2026-11-17` (прошлая неделя относительно 27.11) → 7 дат `2026-11-21 … 2026-11-27`.

- [ ] **Step 4: Тест обновления** — расширить `fakeApi` ответом на `food_entries.get.v2` по дате (`entries: {'2026-11-27': [...]}`). Случаи: (а) записи пишутся, название `Сыр "Лёгкий", 20%` читается обратно как есть; (б) в файле запись `id 5` за день из окна, которой нет в ответе, и запись `id 6` за день вне окна → `5` удалена, `6` осталась; (в) ошибка на запросе дня → `ok:false`, `nutrition_daily.csv`, `body.csv`, `food_entries.csv` байт в байт. Обновить ожидание `'update writes nutrition and weight'` на `{ok:true, days:1, weights:2, entries:0}`.

- [ ] **Step 5: Запустить — падают**

Run: `cd desktop && node --test test/fatsecret.test.js`
Expected: FAIL (`fs_.amount is not a function` и т. п.)

- [ ] **Step 6: Реализация**
  - `schema.json`: `schema["food_entries.csv"]` (колонки выше), `key["food_entries.csv"]: "id"`, `sort["food_entries.csv"]: "date"`; в `text` добавить `meal`, `amount` (`name`, `id`, `date` уже есть). Колонки `food_id`, `serving_id` — тоже в `text` (длинные id, не числа для расчёта).
  - `amount()`: убрать имя из описания; если есть `:custom:` — взять часть после него; убрать `ininini`, `(\d)s\b` → `$1`, лишние пробелы; `g`→`г`, `N medium|large|small` / голое число → `N шт`, `coffee cup|cup` → `чашка`, `serving` → `порция`.
  - `entries()`: тот же `call(...)`, что в `monthDays`, `method: 'food_entries.get.v2'`, `date` = номер дня; ошибки — как в `monthDays`; `food_entry` объект → массив; числа до 0,1 (`round1`); пустое → `null`.
  - `entryDays()`: 14 дней, если в `food_entries.csv` нет строк с датой в прошлой неделе (пн–вс перед неделей `today`), иначе 7; `today` — локальная дата.
  - `update()`: принять `today` (по умолчанию `new Date()`); после месяцев — `entries` по дням `entryDays` по очереди (одна ошибка — `{ok:false}` как сейчас); после всех запросов: `store.upsert` записей по `id`, `store.remove` id из этих дней, которых нет в ответах.
  - `main.js`: в `fatsecret.update({...})` передать `today: new Date()`.
  - Документы: строка `food_entries.csv` — «продукт из дневника | id, date, meal (breakfast/lunch/dinner/other), name, amount (порция для показа), kcal, protein, fat, carbs, fiber, sugar, food_id, serving_id, units | FatSecret; при каждом обновлении — последние 7 дней заново».

- [ ] **Step 7: Тесты проходят**

Run: `cd desktop && npm test`
Expected: все PASS

- [ ] **Step 8: Коммит**

```bash
node scripts/public_check.js
git add desktop/schema.json desktop/fatsecret.js desktop/main.js desktop/test/fatsecret.test.js docs/07_формат_данных.md desktop/data_readme.md
git commit -m "FatSecret: продукты из дневника за последние 7 дней → food_entries.csv"
```

---

### Task 2: Проверка приватности ловит продукты

**Files:**
- Modify: `scripts/public_check.js` (`needles`)
- Test: `desktop/test/public_check.test.js`

**Interfaces:**
- Consumes: `food_entries.csv` из задачи 1 (читать `store.read`, т. к. названия бывают в кавычках с запятыми).

- [ ] **Step 1: Тест** — в `fixture()` записать `food_entries.csv` (заголовок по схеме) со строкой `id 10000000001`, `name 'Творог Деревенский 5%'`. В `'finds each kind of personal data'`: `check('id 10000000001')` → `['id записи дневника']`; `check('съел Творог Деревенский 5% утром')` → `['продукт из дневника']`. В `'dates and clean text pass'` добавить `'Банан'` (короче 12 знаков) — проходит.
- [ ] **Step 2: Запустить — падает.** Run: `cd desktop && node --test test/public_check.test.js` — Expected: FAIL.
- [ ] **Step 3: Реализация** — в `needles()` для `food_entries.csv`: `id` длиной ≥ 10 → `'id записи дневника'`; `name` длиной ≥ 12 → `'продукт из дневника'`. Обновить шапку-комментарий файла.
- [ ] **Step 4: Тесты проходят** — `cd desktop && npm test`, все PASS; `node scripts/public_check.js` → «Чисто».
- [ ] **Step 5: Коммит** — `scripts/public_check.js`, `desktop/test/public_check.test.js`: «Проверка приватности: id и названия продуктов из дневника».

---

### Task 3: Окно «Питание по неделям»

**Files:**
- Create: `portal/foodweek.js`
- Modify: `portal/dataset.js` (`build`), `portal/nutrition.html` (подключение скрипта, `last2()`, новое окно), `portal/common.css` (стили окна), `desktop/CHANGELOG.md`
- Test: `desktop/test/portal_foodweek.test.js` (Node), `desktop/test/portal_render.test.js` (RENDER=1), `desktop/test/portal_pages.test.js` (порядок скриптов)

**Interfaces:**
- Consumes: строки `food_entries.csv` из RAW (`store.raw` берёт все файлы схемы сам).
- Produces: `DATA.food_entries` — строки как в CSV (числа — числами); `FoodWeek.MEALS = [['breakfast','Завтрак'],['lunch','Обед'],['dinner','Ужин'],['other','Перекус']]`; `FoodWeek.byDay(rows) → {date: [[mealKey, label, [{name, amount}]]]}` — приёмы в порядке `MEALS`, пустые приёмы пропущены, порядок продуктов — как в файле; неизвестный `meal` → в «Перекус».
- `portal/foodweek.js` — без DOM и без `common.js` (грузится в Node-тестах через `_portal.load('foodweek.js')`); на странице — после `common.js`.

- [ ] **Step 1: Node-тест `byDay`** — строки двух дней вперемешку, `meal` `dinner` перед `breakfast`, один `meal: 'brunch'` → порядок `Завтрак, Ужин, Перекус`, `brunch` в «Перекус»; день без строк в результате отсутствует.
- [ ] **Step 2: RENDER-тесты** (в `portal_render.test.js`, данные на `updated = '2026-11-27'`):
  - `'food week: both weeks in the dialog, meals in order, escaped'` — `nutrition_daily` за 16–27.11 и `food_entries`: 26.11 продукт `name = TAG` (`<img … id="injected">`), 25.11 `Сыр "Лёгкий", 20%` с `amount '20 г'` → в DOM есть `id="foodweek"`, `эта неделя`, `прошлая неделя`, `Завтрак`, `Сыр &quot;Лёгкий&quot;, 20%`, нет `id="injected"`.
  - `'food week: day with total but no products, empty and future days'` — 17.11 только итог → «продукты не загружены»; 18.11 ничего → «не записывал»; 28.11 → без содержимого (класс будущего дня).
  - `'food week: «Подробно» on the two-week block'` — кнопка с текстом «Подробно» в блоке `#last2`, у карточек дней `data-d`.
- [ ] **Step 3: Запустить — падают.** Run: `cd desktop && node --test test/portal_foodweek.test.js && RENDER=1 node --test test/portal_render.test.js` — Expected: FAIL.
- [ ] **Step 4: Реализация**
  - `dataset.js`: `d.food_entries = T("food_entries")`.
  - `foodweek.js`: `const FoodWeek = {MEALS, byDay}` (глобально, как `Dataset`).
  - `nutrition.html`: `<script src="foodweek.js">` после `common.js`; в разметке — `<dialog class="fw-dialog" id="foodweek">` с шапкой (заголовок «Питание · неделя с …», переключатель «прошлая / эта», кнопки «Скопировать картинкой» — только при `window.health` — и «Закрыть») и `.fw-sheet` (заголовок + 7 столбцов; кнопки вне `.fw-sheet`). Обе недели рисуются в `render()` (две `.fw-week`, видна одна). Столбец дня: полоска цвета `status()`/`ST` как в `last2()`, день недели и дата, ккал, Б/Ж/У, затем приёмы из `FoodWeek.byDay`: подпись, строки «`esc(name)` <span серым>`esc(amount)`</span>». Пустые/сегодня/будущее — как в спецификации («не записывал», «сегодня — пока пусто», бледный, «продукты не загружены»).
  - `last2()`: кнопка «Подробно» в `<h3>` → открывает эту неделю; карточки дней получают `data-d` и по щелчку открывают неделю этого дня. `showModal()`; Esc и «Закрыть» закрывают.
  - `common.css`: `.fw-dialog` — на основе `.wn-dialog`, ширина `min(1400px, 96vw)`, `max-height: 92vh`; `.fw-body` — прокрутка по вертикали; `.fw-grid` — `grid-template-columns: repeat(7, minmax(0,1fr))`, перенос длинных названий; цвета — только переменные темы.
  - `CHANGELOG.md` → «Не выпущено» → «Новое»: «„Питание“: продукты из дневника FatSecret — кнопка „Подробно“ у „Последних 2 недель“ открывает неделю таблицей: дни рядом, что и сколько съедено по приёмам пищи; удобно отправить тренеру. Продукты обновляются за последние 7 дней — дописанное задним числом подтянется».
- [ ] **Step 5: Тесты проходят** — `cd desktop && npm test && RENDER=1 npm test`, все PASS.
- [ ] **Step 6: Коммит** — `portal/foodweek.js portal/dataset.js portal/nutrition.html portal/common.css desktop/CHANGELOG.md desktop/test/portal_foodweek.test.js desktop/test/portal_render.test.js desktop/test/portal_pages.test.js` (после `public_check`): «„Питание“: окно недели с продуктами».

---

### Task 4: «Скопировать картинкой»

**Files:**
- Modify: `desktop/preload.js`, `desktop/main.js` (рядом с `ipc('health:weight', …)`), `portal/foodweek.js`, `portal/nutrition.html`, `desktop/CHANGELOG.md` (дописать к пункту задачи 3)
- Test: `desktop/test/portal_foodweek.test.js`

**Interfaces:**
- Produces: `window.health.capture(rect: {x,y,width,height}) → Promise<string>` (PNG data URL видимой области, CSS-пиксели окна); `window.health.copyImage(dataUrl: string) → Promise<{ok}>` (в буфер обмена).
- Produces: `FoodWeek.slices(total: number, view: number) → Array<{y:number, h:number}>` — полосы подряд от 0 до `total`, каждая ≤ `view`, без нахлёста; `total ≤ view` → одна полоса.

- [ ] **Step 1: Node-тест `slices`** — `slices(900, 1000)` → `[{y:0,h:900}]`; `slices(2000, 740)` → `[{y:0,h:740},{y:740,h:740},{y:1480,h:520}]`; сумма `h` = `total`; `slices(0, 740)` → `[]`.
- [ ] **Step 2: Запустить — падает.** Run: `cd desktop && node --test test/portal_foodweek.test.js` — Expected: FAIL.
- [ ] **Step 3: Реализация**
  - `main.js`: `ipc('health:capture', async rect => (await win.webContents.capturePage(rect)).toDataURL())`; `ipc('health:copyImage', url => { clipboard.writeImage(nativeImage.createFromDataURL(url)); return {ok:true}; })` — `rect` проверить (четыре конечных неотрицательных числа), `url` — только `data:image/png;base64,`.
  - `preload.js`: `capture`, `copyImage` (по образцу соседних).
  - `foodweek.js`: `slices`.
  - `nutrition.html` → `copyWeek()`: кнопка — «Копирую…» и неактивна; для видимой `.fw-sheet` внутри `.fw-body`: по `FoodWeek.slices(sheet.scrollHeight, видимая высота .fw-body)` прокрутить `.fw-body` к `y`, дождаться двух кадров, снять прямоугольник листа в видимой части `health.capture`, нарисовать на `<canvas>` (ширина листа × `devicePixelRatio`, высота `total × devicePixelRatio`) со сдвигом `y × devicePixelRatio`; вернуть прокрутку; `health.copyImage(canvas.toDataURL('image/png'))`; кнопка — «Скопировано» на 2 с. Ошибка — текст ошибки на кнопке на 3 с.
- [ ] **Step 4: Тесты проходят** — `cd desktop && npm test && RENDER=1 npm test`, все PASS.
- [ ] **Step 5: Проверка в приложении без клика** — `HEALTH_DOCUMENTS=<временная папка с данными из теста> HEALTH_SMOKE=1 HEALTH_PAGE=nutrition.html HEALTH_SMOKE_JS="document.querySelector('#last2 button').click(); copyWeek()" npx electron .` в `desktop/` — без ошибок в выводе (содержимое буфера смотрим вручную на шаге задачи 5).
- [ ] **Step 6: Коммит** — `desktop/preload.js desktop/main.js portal/foodweek.js portal/nutrition.html desktop/CHANGELOG.md desktop/test/portal_foodweek.test.js` (после `public_check`): «„Питание“: неделя картинкой в буфер обмена».

---

### Task 5: Сборка и проверка в приложении

- [ ] **Step 1:** `cd desktop && npm test && RENDER=1 npm test` — все PASS; `node scripts/public_check.js` — «Чисто»; `git status` — нет чужих незакоммиченных правок.
- [ ] **Step 2:** `cd desktop && npm run app:mac` — SEL собран, установлен в /Applications и открыт.
- [ ] **Step 3:** Сказать пользователю, что проверить: «Обновить данные» → «Питание» → «Подробно»: обе недели с продуктами, переключатель, щелчок по дню открывает его неделю; «Скопировать картинкой» → вставить в Telegram: вся неделя целиком, в текущей теме; в папке профиля появился `food_entries.csv`.
