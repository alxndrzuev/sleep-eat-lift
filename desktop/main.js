// Приложение SEL (sleep · eat · lift; раньше — «Здоровье»): одно окно с порталом. Страницы — из приложения (portal/), данные пользователя —
// «Документы/SEL/data» (CSV, ключи доступа, фото). Протокол app://h/ отдаёт только разрешённое (protocol.js);
// data.js для страниц собирается из CSV при каждом открытии страницы (store.dataJs), на диск не пишется.
// HEALTH_DOCUMENTS — другая папка «Документы» (проверки); HEALTH_SMOKE=1 — загрузить страницу, вывести меню и выйти;
// HEALTH_CONNECT=fatsecret|whoop — сразу открыть вход сервиса (проверка до появления «Настроек»);
// HEALTH_WHATSNEW=<версия> — показать окно «Что нового», как будто последней была эта версия (настройки не трогаются).
const {app, BrowserWindow, protocol, net, shell, ipcMain, dialog, Menu} = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const {pathToFileURL} = require('node:url');
const store = require('./store');
const {resolve, inside, isDataJs, CSP} = require('./protocol');
const oauthwin = require('./oauthwin');
const fatsecret = require('./fatsecret');
const whoop = require('./whoop');
const {appKey} = require('./keys');
const updaterLib = require('./updater');
const settings = require('./settings');
const photosfs = require('./photosfs');
const datadir = require('./datadir');
const profiles = require('./profiles');
const alcohol = require('./alcohol');
const secretsFile = require('./secrets');
const whatsnew = require('./whatsnew');
const menu = require('./menu');

protocol.registerSchemesAsPrivileged([{scheme: 'app', privileges: {standard: true, secure: true, supportFetchAPI: true}}]);

const PORTAL = app.isPackaged ? path.join(process.resourcesPath, 'portal') : path.join(__dirname, '..', 'portal');
// раньше приложение называлось «Здоровье» — перенести его настройки (проверочный запуск настройки не трогает)
if (!process.env.HEALTH_DOCUMENTS) datadir.migrate(path.join(app.getPath('appData'), datadir.OLD_NAME), app.getPath('userData'));
// папка данных (корень с profiles/): HEALTH_DOCUMENTS (проверки) или выбор пользователя, запомненный в userData/config.json;
// DATA — папка текущего профиля (profiles/<id>/): весь прежний код работает с ней, как раньше с корнем
const TEST = !!process.env.HEALTH_DOCUMENTS;                    // проверочный запуск — настройки приложения не трогаем
let ROOT = TEST ? store.dataDir(process.env.HEALTH_DOCUMENTS) : null;
let DATA = null, PROFILE = null;
let firstRun = null;                             // экран имени профиля: 'migrate' (данные 1.x), 'new', 'adopt' (старое в корне)
let signingIn = 0;                               // идёт вход в FatSecret или Whoop (окно и обмен кодом) — профиль не переключаем
let removing = false;                            // профиль уезжает в Корзину — не обновлять и не переключать
const secretsDir = () => path.join(DATA, 'secrets');
const START = 'app://h/portal/' + (process.env.HEALTH_PAGE || 'dashboard.html');
let win = null;
let news = null;                                 // «Что нового» на этот запуск (whatsnew.js)

function today() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// ---------- ключи доступа пользователя ----------
const userKey = name => store.readJson(path.join(secretsDir(), `${name}.json`));
/** Токены сервисов (остальные поля файла не трогаем — см. secrets.js). Сохранение берётся в начале входа или обновления
 *  (keys.saver): после «Отключить» (keys.clear) запоздавший ответ сервиса токены не вернёт. */
const keys = secretsFile.keeper(name => path.join(secretsDir(), `${name}.json`));

// ---------- сервисы ----------
const services = {
  fatsecret: {
    connected: () => !!userKey('fatsecret').access_token,
    update: (dir, first) => fatsecret.update({dir, app: appKey('fatsecret', {packaged: app.isPackaged}), user: userKey('fatsecret'),
      months: updaterLib.fatsecretRange(first ? null : updaterLib.since(dir, 'fatsecret'), new Date())}),   // пропуски догружаются
  },
  whoop: {
    connected: () => !!userKey('whoop').refresh_token,
    update: async (dir, first) => {
      const r = await whoop.update({dir, app: appKey('whoop', {packaged: app.isPackaged}), user: userKey('whoop'),
        days: updaterLib.whoopDays(first ? null : updaterLib.since(dir, 'whoop'), new Date()), saveUser: keys.saver('whoop')});
      if (r.ok) alcohol.mark(dir, {from: alcohol.fromDate(today())});   // ночи «похоже на алкоголь» за последние 30 дней
      return r;
    },
  },
};
let updater = updaterLib.create(services);

const login = opts => oauthwin.open(opts);
/** Пока идёт вход (окно, обмен кодом, первая загрузка), профиль не переключается: токены и данные легли бы в другой. */
async function signIn(fn) {
  signingIn++;
  try { return await fn(); } finally { signingIn--; }
}

/** Подключить сервис: окно входа → ключ доступа → загрузка за год. → {ok} | {ok: false, cancelled} | {ok: false, error}. */
const pending = {};
async function connect(name) {
  try {
    if (name === 'fatsecret') {
      const key = appKey('fatsecret', {packaged: app.isPackaged});
      if (!key) return {ok: false, error: 'В приложении нет ключа FatSecret'};
      let cb = fatsecret.CALLBACK, t;
      try { t = await fatsecret.requestToken(key, cb); }
      catch (e) { if (e.kind !== 'api') throw e; cb = 'oob'; t = await fatsecret.requestToken(key, 'oob'); }
      pending.fatsecret = Object.assign(t, {oob: cb === 'oob'});
      pushStatus();                                                   // «Настройки» сразу покажут поле кода (oob)
      const back = await login({url: fatsecret.authorizeUrl(t.token), callbackPrefix: fatsecret.CALLBACK,
                                partition: 'fatsecret-login', parent: win, title: 'Вход в FatSecret'});
      if (cb === 'oob') return {ok: false, oob: true};                 // код вводится на «Настройках»
      if (!back) { delete pending.fatsecret; return {ok: false, cancelled: true}; }
      return await finishFatSecret(back.searchParams.get('oauth_verifier'), back.searchParams.get('oauth_token'));
    }
    if (name === 'whoop') {
      const key = appKey('whoop', {packaged: app.isPackaged});
      if (!key) return {ok: false, error: 'В этой сборке нет ключа Whoop'};
      const state = whoop.newState(), save = keys.saver('whoop');
      const back = await login({url: whoop.authUrl(key, state), callbackPrefix: key.redirect_uri || whoop.CALLBACK,
                                partition: 'whoop-login', parent: win, title: 'Вход в Whoop'});
      if (!back) return {ok: false, cancelled: true};
      const user = await whoop.exchange(key, whoop.codeFrom(back, state), {fetch: globalThis.fetch});
      if (!save(user)) return {ok: false, cancelled: true};             // пока шёл вход, нажали «Отключить»
      const r = await updateAll('whoop');
      return {ok: true, update: r.whoop};
    }
    return {ok: false, error: `Неизвестный сервис: ${name}`};
  } catch (e) { return {ok: false, error: e.message}; }
}

async function finishFatSecret(verifier, token) {
  const t = pending.fatsecret, save = keys.saver('fatsecret');
  if (!t || (token && token !== t.token)) return {ok: false, error: 'Вход устарел — нажмите «Подключить» ещё раз'};
  const user = await fatsecret.accessToken(appKey('fatsecret', {packaged: app.isPackaged}), t.token, t.secret, verifier);
  delete pending.fatsecret;
  if (!save(user)) return {ok: false, cancelled: true};               // пока шёл вход, нажали «Отключить»
  const r = await updateAll('fatsecret');
  return {ok: true, update: r.fatsecret};
}

function reload() { if (win && !win.isDestroyed()) win.webContents.reload(); }

// ---------- где лежат данные ----------
/** Спросить, где хранить данные (первый запуск, папка пропала или «Сменить папку»). → путь папки data или null. */
async function askDataDir({missing = null, change = false} = {}) {
  const def = datadir.defaultDir(app.getPath('documents'));
  const defHas = datadir.hasCsv(def);
  for (;;) {
    const {response} = await dialog.showMessageBox(win && !win.isDestroyed() ? win : undefined, {
      type: 'question', title: 'SEL',
      message: missing ? 'Папка с данными SEL не найдена' : change ? 'Где брать данные SEL?' : 'Где хранить данные SEL?',
      detail: (missing ? `Раньше данные лежали здесь:\n${missing}\nЕё переместили или удалили. ` : '') +
        'В папке данных — питание, вес, сон, тренировки, фото и ключи доступа к FatSecret и Whoop. ' +
        'Они остаются только на этом компьютере. Если данные уже есть (например, после переустановки) — выберите их папку.',
      buttons: [defHas ? 'Документы/SEL (там уже есть данные)' : 'Новая папка: Документы/SEL', 'Выбрать папку…', change ? 'Отмена' : 'Выйти'],
      defaultId: 0, cancelId: 2});
    if (response === 2) return null;
    if (response === 0) return def;
    const r = await dialog.showOpenDialog({title: 'Папка с данными SEL', buttonLabel: 'Выбрать',
      message: 'Папка, где уже лежат данные SEL, или где создать новую', properties: ['openDirectory', 'createDirectory'],
      defaultPath: app.getPath('documents')});
    if (r.canceled || !r.filePaths.length) continue;
    const p = datadir.fromPicked(r.filePaths[0]);
    if (p.existing) return p.dir;
    const {response: ok} = await dialog.showMessageBox({type: 'question', title: 'SEL', message: 'Данных SEL в этой папке нет',
      detail: `Создать новые здесь?\n${p.dir}`, buttons: ['Создать', 'Выбрать другую'], defaultId: 0, cancelId: 1});
    if (ok === 0) return p.dir;
  }
}

/** Папка данных при запуске: сохранённая → она; нет или пропала → спросить. null — пользователь выбрал «Выйти». */
async function resolveDataDir() {
  if (ROOT) return ROOT;
  const cur = datadir.current(app.getPath('userData'));
  if (cur.dir) return cur.dir;
  const d = await askDataDir({missing: cur.missing});
  if (d) datadir.save(app.getPath('userData'), d);
  return d;
}

// ---------- статус и IPC для страниц ----------
function status() {
  if (!DATA) return {version: app.getVersion(), dataDir: ROOT, profile: null, modules: [], updating: false, services: {}, oob: false};
  const svc = {};
  for (const name of Object.keys(services))
    svc[name] = Object.assign({connected: services[name].connected(), hasKey: !!appKey(name, {packaged: app.isPackaged})},
                              updater.status[name], {lastUpdate: updater.status[name].lastUpdate || store.readSync(DATA)[name] || null});
  return {version: app.getVersion(), dataDir: DATA, profile: {id: PROFILE, name: (profiles.readMeta(ROOT, PROFILE) || {}).name || PROFILE}, modules: store.modules(DATA), updating: updater.busy, services: svc,
          oob: !!(pending.fatsecret && pending.fatsecret.oob)};
}
function pushStatus() { if (win && !win.isDestroyed()) win.webContents.send('health:status', status()); }

async function updateAll(first) {
  if (!DATA || removing) return {};
  const p = updater.runAll(DATA, first);
  pushStatus();
  const r = await p;
  pushStatus();
  if (!r.busy && Object.keys(r).length) reload();
  return r;
}

function ipc(channel, fn) {
  ipcMain.handle(channel, (e, ...args) => {
    if (!e.senderFrame || !e.senderFrame.url.startsWith('app://h/')) throw new Error('недоступно');
    return fn(...args);
  });
}

/** Папка текущего профиля; на экране имени профиля (профиль ещё не выбран) — ошибка. */
function need() { if (!DATA) throw new Error('Профиль не выбран'); return DATA; }
/** Выполнить и ответить странице {ok: true, …} или {ok: false, error}. */
async function answer(fn) {
  try { return Object.assign({ok: true}, await fn()); } catch (e) { return {ok: false, error: e.message}; }
}

// ---------- профили ----------
/** Почему сейчас нельзя переключить профиль (или null). */
function lockReason() {
  if (updater.busy) return 'Идёт обновление данных — подождите, пока закончится';
  if (signingIn) return 'Идёт вход в FatSecret или Whoop — закончите или закройте его';
  if (removing) return 'Профиль удаляется — секунду';
  return null;
}

/** Сделать профиль id текущим: DATA, свой updater, без чужого незаконченного входа; запомнить. */
function openProfile(id) {
  DATA = profiles.dir(ROOT, id); PROFILE = id;
  updater = updaterLib.create(services);
  delete pending.fatsecret;
  store.init(DATA);
  profiles.writeRootReadme(ROOT);
  if (!TEST) datadir.saveCfg(app.getPath('userData'), {profile: id});
}

/** Переключиться на профиль: окно — на ту же страницу (с экрана имени — на сводку), обновить его данные. */
function useProfile(id) {
  const why = lockReason();
  if (why) throw new Error(why);
  if (!profiles.readMeta(ROOT, id)) throw new Error('Нет такого профиля');
  const wasFirst = !DATA || firstRun;
  firstRun = null;
  openProfile(id);
  if (wasFirst || win.webContents.getURL().includes('/profile.html')) win.loadURL(START); else reload();
  updateAll();
  return {id};
}

/** «Создать»: на экране имени — перенос данных 1.x или старых из корня; иначе новый пустой профиль. */
function createProfile(name) {
  if (!firstRun && lockReason()) throw new Error(lockReason());
  const t = today();
  const r = firstRun === 'migrate' ? profiles.migrate(ROOT, name, t)
          : firstRun === 'adopt' ? profiles.adoptOld(ROOT, name, t) : profiles.create(ROOT, name, t);
  return useProfile(r.id);
}

async function removeProfile(id) {
  const why = lockReason();
  if (why) throw new Error(why);
  removing = true;
  try { await profiles.remove(ROOT, id, p => shell.trashItem(p)); }
  finally { removing = false; }
  if (id === PROFILE) useProfile(profiles.pick(ROOT, null));
  else pushStatus();
}

/** Старые данные в корне при профилях: «Оставить как есть» — не спрашивать, пока эти файлы не изменятся. */
function skipOld() {
  const old = profiles.oldRootData(ROOT);
  if (old && !TEST) datadir.saveCfg(app.getPath('userData'), {oldRootSig: old.sig});
}

/** Открыть профиль из настроек (или HEALTH_PROFILE, или первый) и сводку. */
function openStart() {
  firstRun = null;
  openProfile(profiles.pick(ROOT, process.env.HEALTH_PROFILE || datadir.readCfg(app.getPath('userData')).profile));
  win.loadURL(START);
  return {id: PROFILE};
}

function setupIpc() {
  ipc('health:status', status);
  ipc('health:update', () => updateAll());
  ipc('health:connect', async s => { const r = await signIn(() => connect(String(s))); pushStatus(); return r; });
  ipc('health:code', async v => {
    try { const r = await signIn(() => finishFatSecret(String(v || ''))); pushStatus(); return r; } catch (e) { return {ok: false, error: e.message}; }
  });
  ipc('health:disconnect', s => { if (s in services) keys.clear(s); pushStatus(); reload(); return {ok: true}; });
  ipc('health:targets', v => settings.saveTargets(need(), v || {}, today()));
  ipc('health:removeTarget', (kind, date) => settings.removeTarget(need(), String(kind), String(date)));
  // план, БАДы, алкоголь: пишем CSV — страница при следующей загрузке получит их из CSV (store.dataJs)
  ipc('health:plan', v => settings.savePlan(need(), v || {}, today()));
  ipc('health:removePlan', date => settings.removePlan(need(), String(date)));
  ipc('health:supplementAdd', v => settings.addSupplement(need(), v || {}, today()));
  ipc('health:supplementStop', v => settings.stopSupplement(need(), v || {}, today()));
  ipc('health:supplementRemove', v => settings.removeSupplement(need(), v || {}));
  ipc('health:alcohol', (morning, value) => alcohol.answer(need(), String(morning), typeof value === 'boolean' ? value : String(value)));
  ipc('health:alcoholAdd', (evening, lvl, note) => alcohol.add(need(), String(evening), String(lvl), String(note || '').slice(0, 80), today()));
  ipc('health:alcoholLevel', (evening, lvl) => alcohol.setLevel(need(), String(evening), String(lvl)));
  ipc('health:alcoholRemove', evening => alcohol.removeEvening(need(), String(evening)));
  ipc('health:folder', () => shell.openPath(need()));
  ipc('health:changeFolder', async () => {
    const d = await askDataDir({change: true});
    if (!d || d === ROOT) return {ok: false};
    datadir.save(app.getPath('userData'), d);
    app.relaunch(); app.exit(0);
    return {ok: true};
  });
  ipc('health:photos', (op, rel, bytes) => {
    if (!['list', 'read', 'write', 'mkdir', 'remove', 'exists'].includes(op)) throw new Error('недопустимая операция');
    try { return photosfs[op](path.join(need(), 'photos'), String(rel ?? ''), bytes); }
    catch (e) { throw new Error((e.code === 'NotFoundError' ? 'NotFoundError: ' : '') + e.message); }
  });
  // профили: список и текущий, переключить, создать (на экране имени — перенос данных), переименовать, удалить
  ipc('health:profiles', () => ({list: profiles.list(ROOT).map(p => ({id: p.id, name: p.name})), current: PROFILE, locked: lockReason()}));
  ipc('health:profileSwitch', id => answer(() => useProfile(String(id))));
  ipc('health:profileCreate', name => answer(() => createProfile(String(name ?? ''))));
  ipc('health:profileRename', (id, name) => answer(() => { profiles.rename(ROOT, String(id), String(name ?? '')); pushStatus(); }));
  ipc('health:profileRemove', id => answer(() => removeProfile(String(id))));
  ipc('health:profileInfo', id => { const d = profiles.dir(ROOT, String(id)), m = profiles.readMeta(ROOT, String(id));
    if (!m) throw new Error('Нет такого профиля'); return {name: m.name, photos: profiles.photoCount(d)}; });
  ipc('health:profileSkipAdopt', () => answer(() => { skipOld(); return openStart(); }));
  ipc('health:weight', (date, kg) => answer(() => settings.saveWeight(need(), String(date), kg, today())));
  ipc('health:whatsNew', () => news.show());
  ipc('health:whatsNewSeen', () => news.seen());
  ipc('health:changelog', () => news.history());
  ipc('health:external', u => (settings.externalAllowed(String(u)) ? shell.openExternal(String(u)).then(() => true) : false));
}

// ---------- окно ----------
function serve(req) {
  if (isDataJs(req.url)) {                             // данные страниц — из CSV прямо сейчас (store.dataJs)
    let js;
    try { js = DATA ? store.dataJs(DATA, today()) : 'const RAW = null;\n'; }
    catch (e) { return new Response('Данные не читаются: ' + e.message, {status: 500, headers: {'Content-Type': 'text/plain; charset=utf-8'}}); }
    return new Response(js, {headers: {'Content-Type': 'text/javascript; charset=utf-8', 'Cache-Control': 'no-store',
                                       'Content-Security-Policy': CSP}});
  }
  const p = resolve(req.url, PORTAL, DATA || ROOT);       // без профиля фото не отдаём: ниже разрешён только PORTAL
  if (!p || !fs.existsSync(p)) return new Response('Not found', {status: 404});
  const real = fs.realpathSync(p);                       // симлинк наружу разрешённой папки — не отдаём
  const bases = (DATA ? [PORTAL, path.join(DATA, 'photos')] : [PORTAL]).map(b => fs.existsSync(b) ? fs.realpathSync(b) : b);
  if (!bases.some(b => inside(b, real))) return new Response('Not found', {status: 404});
  return net.fetch(pathToFileURL(real).toString()).then(r => new Response(r.body, {
    status: r.status, headers: {'Content-Type': r.headers.get('Content-Type') || '', 'Cache-Control': 'no-store',
             'Content-Security-Policy': CSP}}));
}

/** «Что нового»: последняя показанная версия — в настройках приложения; новичку (не было папки данных) окна нет. */
function startNews(hadDataDir) {
  const userData = app.getPath('userData'), force = process.env.HEALTH_WHATSNEW;
  const test = !!process.env.HEALTH_DOCUMENTS;                  // проверочный запуск — настройки не трогаем
  let md = '';
  try { md = fs.readFileSync(path.join(__dirname, 'CHANGELOG.md'), 'utf8'); } catch (e) {}
  news = whatsnew.create({md, version: app.getVersion(), dev: !app.isPackaged,
    lastSeen: force || datadir.readCfg(userData).lastSeenVersion || null,
    isNew: force ? false : test || !hadDataDir,
    save: test || force ? null : v => datadir.saveCfg(userData, {lastSeenVersion: v})});
}

/** «Назад» / «Вперёд» по истории окна (goBack / goForward), если есть куда. */
function go(dir) {
  const h = win && !win.isDestroyed() && win.webContents.navigationHistory;
  if (h && (dir === 'goBack' ? h.canGoBack() : h.canGoForward())) h[dir]();
}

/** Меню по-русски (menu.js): Mac и Windows. */
function setMenu() {
  Menu.setApplicationMenu(Menu.buildFromTemplate(menu.template({platform: process.platform, packaged: app.isPackaged, go,
    whatsNew: () => { if (win && !win.isDestroyed() && DATA && !win.webContents.getURL().endsWith('/whatsnew.html'))
      win.loadURL('app://h/portal/whatsnew.html'); }})));
}

function createWindow() {
  win = new BrowserWindow({
    width: 1280, height: 900, title: 'SEL', show: !process.env.HEALTH_SMOKE,
    webPreferences: {contextIsolation: true, sandbox: true, nodeIntegration: false, preload: path.join(__dirname, 'preload.js')},
  });
  win.webContents.on('will-navigate', (e, url) => { if (!url.startsWith('app://h/')) e.preventDefault(); });
  win.webContents.setWindowOpenHandler(({url}) => {
    if (settings.externalAllowed(url)) shell.openExternal(url);
    return {action: 'deny'};
  });
}

// «О программе» (меню приложения): значок, имя, версия и весь текст — в нижней строке, её macOS ставит по центру (поле
// credits — слева и другим шрифтом, его нет); version: '' — без «(1.1.0)» после версии
const ABOUT = {applicationName: 'SEL', version: '', copyright: 'sleep · eat · lift\n' +
  'Питание, сон и тренировки из FatSecret и Whoop\ngithub.com/alxndrzuev/sleep-eat-lift\n© 2026 alxndrzuev · лицензия MIT'};

/** Проверка без клика (HEALTH_SMOKE): после первой загрузки страницы — текст, меню, статус в консоль; выход. */
function smoke() {
  win.webContents.once('did-finish-load', async () => {
    const r = await win.webContents.executeJavaScript(
      `new Promise(r => setTimeout(() => r({title: document.title, nav: [...document.querySelectorAll('#nav a')].map(a => a.textContent),
         empty: document.body.innerText.includes('Подключите FatSecret или Whoop'), modules: typeof DATA !== 'undefined' && DATA ? DATA.modules : null,
         text: document.body.innerText.replace(/\\s+/g, ' ').slice(0, 700),
         foot: (document.querySelector('.foot') || {}).innerText || '', upd: (document.getElementById('upd') || {}).innerText || ''}), ${+(process.env.HEALTH_SMOKE_WAIT || 500)}))`);
    if (process.env.HEALTH_SMOKE_JS) r.js = await win.webContents.executeJavaScript(process.env.HEALTH_SMOKE_JS).catch(e => 'ERR ' + e.message);
    if (process.env.HEALTH_SMOKE_SHOT) fs.writeFileSync(process.env.HEALTH_SMOKE_SHOT, (await win.webContents.capturePage()).toPNG());
    const menu = (Menu.getApplicationMenu() || {items: []}).items.map(i => [i.label, (i.submenu ? i.submenu.items : []).map(x => x.label)]);
    console.log('SMOKE ' + JSON.stringify(Object.assign(r, {status: status(), menu})));
    app.quit();
  });
}

app.whenReady().then(async () => {
  app.setAboutPanelOptions(Object.assign({applicationVersion: app.getVersion()}, ABOUT));
  setMenu();
  createWindow();                              // окно сразу — вопрос о папке данных показывается поверх него
  if (!process.env.HEALTH_SMOKE) app.focus({steal: true});
  const hadDataDir = !!datadir.readCfg(app.getPath('userData')).dataDir;   // до выбора папки: новичок или обновился
  ROOT = await resolveDataDir();
  if (!ROOT) { app.quit(); return; }
  startNews(hadDataDir);
  protocol.handle('app', serve);
  setupIpc();
  if (process.env.HEALTH_SMOKE) smoke();
  try {
    profiles.resume(ROOT);                                     // перенос, прерванный в прошлый раз, — довести
    if (profiles.needsMigration(ROOT)) firstRun = 'migrate';   // данные 1.x в корне: спросить имя и перенести
    else if (!profiles.list(ROOT).length) firstRun = 'new';   // новичок: спросить имя
    else {
      const old = profiles.oldRootData(ROOT);
      if (old && old.sig !== datadir.readCfg(app.getPath('userData')).oldRootSig && !process.env.HEALTH_SMOKE) {
        const {response} = await dialog.showMessageBox(win, {type: 'question', title: 'SEL',
          message: 'В папке данных, вне профилей, лежат старые данные',
          detail: `Записей: ${old.rows}. SEL их не показывает — так бывает после запуска старой версии или восстановления копии. ` +
            'Можно перенести их в новый профиль.', buttons: ['Перенести в новый профиль', 'Оставить как есть'], defaultId: 0, cancelId: 1});
        if (response === 0) firstRun = 'adopt'; else skipOld();
      }
    }
    if (firstRun) { win.loadURL(`app://h/portal/profile.html?first=${firstRun}`); return; }
    openStart();
    if (process.env.HEALTH_SMOKE) { if (process.env.HEALTH_SMOKE_UPDATE) await updater.runAll(DATA); return; }
  } catch (e) {                                              // перенос или чтение профилей не удались — не пустое окно, а причина
    const text = `Не получилось открыть данные: ${e.message}\n\nПапка: ${ROOT}\nЕсли её держит другая программа (Finder, OneDrive, ` +
      'антивирус) — закройте её и запустите SEL снова. Перенос продолжится с того места, где остановился; данные не пропадут.';
    if (process.env.HEALTH_SMOKE) { console.log('SMOKE-ERROR ' + text); app.quit(); return; }
    await dialog.showMessageBox(win, {type: 'error', title: 'SEL', message: 'SEL не может открыть данные', detail: text});
    app.quit(); return;
  }
  if (process.env.HEALTH_CONNECT) console.log('CONNECT ' + JSON.stringify(await connect(process.env.HEALTH_CONNECT)));
  else updateAll();
});

app.on('window-all-closed', () => app.quit());

module.exports = {connect, finishFatSecret, services, keys, userKey};
