// Приложение «Здоровье»: одно окно с порталом. Страницы — из приложения (portal/), данные пользователя —
// «Документы/Здоровье/data» (CSV, ключи доступа, фото, data.js). Протокол app://h/ отдаёт только разрешённое (protocol.js).
// HEALTH_DOCUMENTS — другая папка «Документы» (проверки); HEALTH_SMOKE=1 — загрузить страницу, вывести меню и выйти;
// HEALTH_CONNECT=fatsecret|whoop — сразу открыть вход сервиса (проверка до появления «Настроек»);
// HEALTH_WHATSNEW=<версия> — показать окно «Что нового», как будто последней была эта версия (настройки не трогаются).
const {app, BrowserWindow, protocol, net, shell, ipcMain, dialog, Menu} = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const {pathToFileURL} = require('node:url');
const store = require('./store');
const {resolve, inside, CSP} = require('./protocol');
const oauthwin = require('./oauthwin');
const fatsecret = require('./fatsecret');
const whoop = require('./whoop');
const {appKey} = require('./keys');
const updaterLib = require('./updater');
const settings = require('./settings');
const photosfs = require('./photosfs');
const datadir = require('./datadir');
const alcohol = require('./alcohol');
const secretsFile = require('./secrets');
const whatsnew = require('./whatsnew');

protocol.registerSchemesAsPrivileged([{scheme: 'app', privileges: {standard: true, secure: true, supportFetchAPI: true}}]);

const PORTAL = app.isPackaged ? path.join(process.resourcesPath, 'portal') : path.join(__dirname, '..', 'portal');
// папка данных: HEALTH_DOCUMENTS (проверки) или выбор пользователя, запомненный в userData/config.json
let DATA = process.env.HEALTH_DOCUMENTS ? store.dataDir(process.env.HEALTH_DOCUMENTS) : null;
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
/** Сохранить токены сервиса (остальные поля файла не трогаем — см. secrets.js); null — «Отключить». */
function saveUserKey(name, obj) {
  const f = path.join(secretsDir(), `${name}.json`);
  if (obj) secretsFile.save(f, Object.fromEntries(Object.entries(obj).filter(([k]) => secretsFile.TOKENS.includes(k))));
  else secretsFile.clear(f);
}

// ---------- сервисы ----------
const services = {
  fatsecret: {
    connected: () => !!userKey('fatsecret').access_token,
    update: (dir, first) => fatsecret.update({dir, app: appKey('fatsecret', {packaged: app.isPackaged}), user: userKey('fatsecret'),
      months: (first ? updaterLib.firstRange : updaterLib.recentRange)(new Date())}),
  },
  whoop: {
    connected: () => !!userKey('whoop').refresh_token,
    update: async (dir, first) => {
      const r = await whoop.update({dir, app: appKey('whoop', {packaged: app.isPackaged}), user: userKey('whoop'),
        days: first ? 365 : 14, saveUser: u => saveUserKey('whoop', u)});
      if (r.ok) {   // ночи «похоже на алкоголь» за последние 30 дней, но не раньше meta.alcohol_from
        const floor = store.readJson(path.join(dir, 'meta.json')).alcohol_from || '';
        const from = alcohol.fromDate(today());
        alcohol.mark(dir, {from: floor > from ? floor : from});
      }
      return r;
    },
  },
};
const updater = updaterLib.create(services, today);

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
      const back = await oauthwin.open({url: fatsecret.authorizeUrl(t.token), callbackPrefix: fatsecret.CALLBACK,
                                        partition: 'fatsecret-login', parent: win, title: 'Вход в FatSecret'});
      if (cb === 'oob') return {ok: false, oob: true};                 // код вводится на «Настройках»
      if (!back) { delete pending.fatsecret; return {ok: false, cancelled: true}; }
      return await finishFatSecret(back.searchParams.get('oauth_verifier'), back.searchParams.get('oauth_token'));
    }
    if (name === 'whoop') {
      const key = appKey('whoop', {packaged: app.isPackaged});
      if (!key) return {ok: false, error: 'В этой сборке нет ключа Whoop'};
      const state = whoop.newState();
      const back = await oauthwin.open({url: whoop.authUrl(key, state), callbackPrefix: key.redirect_uri || whoop.CALLBACK,
                                        partition: 'whoop-login', parent: win, title: 'Вход в Whoop'});
      if (!back) return {ok: false, cancelled: true};
      const user = await whoop.exchange(key, whoop.codeFrom(back, state), {fetch: globalThis.fetch});
      saveUserKey('whoop', user);
      const r = await updateAll('whoop');
      return {ok: true, update: r.whoop};
    }
    return {ok: false, error: `Неизвестный сервис: ${name}`};
  } catch (e) { return {ok: false, error: e.message}; }
}

async function finishFatSecret(verifier, token) {
  const t = pending.fatsecret;
  if (!t || (token && token !== t.token)) return {ok: false, error: 'Вход устарел — нажмите «Подключить» ещё раз'};
  const user = await fatsecret.accessToken(appKey('fatsecret', {packaged: app.isPackaged}), t.token, t.secret, verifier);
  delete pending.fatsecret;
  saveUserKey('fatsecret', user);
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
      type: 'question', title: 'Здоровье',
      message: missing ? 'Папка с данными «Здоровья» не найдена' : change ? 'Где брать данные «Здоровья»?' : 'Где хранить данные «Здоровья»?',
      detail: (missing ? `Раньше данные лежали здесь:\n${missing}\nЕё переместили или удалили. ` : '') +
        'В папке данных — питание, вес, сон, тренировки, фото и ключи доступа к FatSecret и Whoop. ' +
        'Они остаются только на этом компьютере. Если данные уже есть (например, после переустановки) — выберите их папку.',
      buttons: [defHas ? 'Документы/Здоровье (там уже есть данные)' : 'Новая папка: Документы/Здоровье', 'Выбрать папку…', change ? 'Отмена' : 'Выйти'],
      defaultId: 0, cancelId: 2});
    if (response === 2) return null;
    if (response === 0) return def;
    const r = await dialog.showOpenDialog({title: 'Папка с данными «Здоровья»', buttonLabel: 'Выбрать',
      message: 'Папка, где уже лежат данные «Здоровья», или где создать новую', properties: ['openDirectory', 'createDirectory'],
      defaultPath: app.getPath('documents')});
    if (r.canceled || !r.filePaths.length) continue;
    const p = datadir.fromPicked(r.filePaths[0]);
    if (p.existing) return p.dir;
    const {response: ok} = await dialog.showMessageBox({type: 'question', title: 'Здоровье', message: 'Данных «Здоровья» в этой папке нет',
      detail: `Создать новые здесь?\n${p.dir}`, buttons: ['Создать', 'Выбрать другую'], defaultId: 0, cancelId: 1});
    if (ok === 0) return p.dir;
  }
}

/** Папка данных при запуске: сохранённая → она; нет или пропала → спросить. null — пользователь выбрал «Выйти». */
async function resolveDataDir() {
  if (DATA) return DATA;
  const cur = datadir.current(app.getPath('userData'));
  if (cur.dir) return cur.dir;
  const d = await askDataDir({missing: cur.missing});
  if (d) datadir.save(app.getPath('userData'), d);
  return d;
}

// ---------- статус и IPC для страниц ----------
function status() {
  const svc = {};
  for (const name of Object.keys(services))
    svc[name] = Object.assign({connected: services[name].connected(), hasKey: !!appKey(name, {packaged: app.isPackaged})},
                              updater.status[name]);
  return {version: app.getVersion(), dataDir: DATA, modules: store.modules(DATA), updating: updater.busy, services: svc,
          oob: !!(pending.fatsecret && pending.fatsecret.oob)};
}
function pushStatus() { if (win && !win.isDestroyed()) win.webContents.send('health:status', status()); }

async function updateAll(first) {
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

function setupIpc() {
  ipc('health:status', status);
  ipc('health:update', () => updateAll());
  ipc('health:connect', async s => { const r = await connect(String(s)); pushStatus(); return r; });
  ipc('health:code', async v => {
    try { const r = await finishFatSecret(String(v || '')); pushStatus(); return r; } catch (e) { return {ok: false, error: e.message}; }
  });
  ipc('health:disconnect', s => { if (s in services) saveUserKey(s, null); store.writeDataJs(DATA, today()); pushStatus(); reload(); return {ok: true}; });
  ipc('health:targets', v => { const r = settings.saveTargets(DATA, v || {}, today()); if (r.ok) { store.writeDataJs(DATA, today()); } return r; });
  ipc('health:removeTarget', (kind, date) => { const r = settings.removeTarget(DATA, String(kind), String(date)); if (r.ok) store.writeDataJs(DATA, today()); return r; });
  const alcoholDone = r => { if (r.ok) store.writeDataJs(DATA, today()); return r; };
  ipc('health:alcohol', (morning, value) => alcoholDone(alcohol.answer(DATA, String(morning), typeof value === 'boolean' ? value : String(value))));
  ipc('health:alcoholAdd', (evening, lvl, note) => alcoholDone(alcohol.add(DATA, String(evening), String(lvl), String(note || '').slice(0, 80), today())));
  ipc('health:alcoholLevel', (evening, lvl) => alcoholDone(alcohol.setLevel(DATA, String(evening), String(lvl))));
  ipc('health:alcoholRemove', evening => alcoholDone(alcohol.removeEvening(DATA, String(evening))));
  ipc('health:folder', () => shell.openPath(DATA));
  ipc('health:changeFolder', async () => {
    const d = await askDataDir({change: true});
    if (!d || d === DATA) return {ok: false};
    datadir.save(app.getPath('userData'), d);
    app.relaunch(); app.exit(0);
    return {ok: true};
  });
  ipc('health:photos', (op, rel, bytes) => {
    if (!['list', 'read', 'write', 'mkdir', 'remove', 'exists'].includes(op)) throw new Error('недопустимая операция');
    try { return photosfs[op](path.join(DATA, 'photos'), String(rel ?? ''), bytes); }
    catch (e) { throw new Error((e.code === 'NotFoundError' ? 'NotFoundError: ' : '') + e.message); }
  });
  ipc('health:whatsNew', () => news.show());
  ipc('health:whatsNewSeen', () => news.seen());
  ipc('health:changelog', () => news.history());
  ipc('health:external', u => (settings.externalAllowed(String(u)) ? shell.openExternal(String(u)).then(() => true) : false));
}

// ---------- окно ----------
function serve(req) {
  const p = resolve(req.url, PORTAL, DATA);
  if (!p || !fs.existsSync(p)) return new Response('Not found', {status: 404});
  const real = fs.realpathSync(p);                       // симлинк наружу разрешённой папки — не отдаём
  const bases = [PORTAL, path.join(DATA, 'photos'), DATA].map(b => fs.existsSync(b) ? fs.realpathSync(b) : b);
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

/** Меню Mac по-русски; «Справка» — «Что нового» вместо ссылок Electron; инструменты разработчика — только не в сборке. */
function setMenu() {
  if (process.platform !== 'darwin') return;
  const sep = {type: 'separator'}, name = '«Здоровье»';
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    {label: app.name, submenu: [{role: 'about', label: `О программе ${name}`}, sep, {role: 'services', label: 'Службы'}, sep,
      {role: 'hide', label: `Скрыть ${name}`}, {role: 'hideOthers', label: 'Скрыть остальные'}, {role: 'unhide', label: 'Показать все'}, sep,
      {role: 'quit', label: `Завершить ${name}`}]},
    {label: 'Файл', submenu: [{role: 'close', label: 'Закрыть окно'}]},
    {label: 'Правка', submenu: [{role: 'undo', label: 'Отменить'}, {role: 'redo', label: 'Повторить'}, sep,
      {role: 'cut', label: 'Вырезать'}, {role: 'copy', label: 'Скопировать'}, {role: 'paste', label: 'Вставить'},
      {role: 'pasteAndMatchStyle', label: 'Вставить и сохранить стиль'}, {role: 'delete', label: 'Удалить'},
      {role: 'selectAll', label: 'Выбрать все'}]},
    {label: 'Вид', submenu: [{role: 'reload', label: 'Обновить страницу'},
      ...(app.isPackaged ? [] : [{role: 'toggleDevTools', label: 'Инструменты разработчика'}]), sep,
      {role: 'resetZoom', label: 'Фактический размер'}, {role: 'zoomIn', label: 'Увеличить'}, {role: 'zoomOut', label: 'Уменьшить'}, sep,
      {role: 'togglefullscreen', label: 'Во весь экран'}]},
    {label: 'Окно', role: 'window', submenu: [{role: 'minimize', label: 'Свернуть'}, {role: 'zoom', label: 'Масштаб'}, sep,
      {role: 'front', label: 'Все окна — на передний план'}]},
    {label: 'Справка', role: 'help', submenu: [{label: `Что нового в ${name}`,
      click: () => { if (win && !win.isDestroyed() && DATA) win.loadURL('app://h/portal/whatsnew.html'); }}]},
  ]));
}

function createWindow() {
  win = new BrowserWindow({
    width: 1280, height: 900, title: 'Здоровье', show: !process.env.HEALTH_SMOKE,
    webPreferences: {contextIsolation: true, sandbox: true, nodeIntegration: false, preload: path.join(__dirname, 'preload.js')},
  });
  win.webContents.on('will-navigate', (e, url) => { if (!url.startsWith('app://h/')) e.preventDefault(); });
  win.webContents.setWindowOpenHandler(({url}) => {
    if (settings.externalAllowed(url)) shell.openExternal(url);
    return {action: 'deny'};
  });
}

app.whenReady().then(async () => {
  setMenu();
  createWindow();                              // окно сразу — вопрос о папке данных показывается поверх него
  if (!process.env.HEALTH_SMOKE) app.focus({steal: true});
  const hadDataDir = !!datadir.readCfg(app.getPath('userData')).dataDir;   // до выбора папки: новичок или обновился
  DATA = await resolveDataDir();
  if (!DATA) { app.quit(); return; }
  startNews(hadDataDir);
  protocol.handle('app', serve);
  setupIpc();
  store.init(DATA);
  store.writeDataJs(DATA, today());
  if (process.env.HEALTH_SMOKE && process.env.HEALTH_SMOKE_UPDATE) await updater.runAll(DATA);   // проверка: обновить до окна
  win.loadURL(START);
  if (process.env.HEALTH_SMOKE) {
    win.webContents.once('did-finish-load', async () => {
      const r = await win.webContents.executeJavaScript(
        `new Promise(r => setTimeout(() => r({title: document.title, nav: [...document.querySelectorAll('#nav a')].map(a => a.textContent),
           empty: document.body.innerText.includes('Подключите FatSecret или Whoop'), modules: DATA.modules,
           text: document.body.innerText.replace(/\\s+/g, ' ').slice(0, 700),
           foot: (document.querySelector('.foot') || {}).innerText || '', upd: (document.getElementById('upd') || {}).innerText || ''}), ${+(process.env.HEALTH_SMOKE_WAIT || 500)}))`);
      if (process.env.HEALTH_SMOKE_JS) r.js = await win.webContents.executeJavaScript(process.env.HEALTH_SMOKE_JS).catch(e => 'ERR ' + e.message);
      if (process.env.HEALTH_SMOKE_SHOT) fs.writeFileSync(process.env.HEALTH_SMOKE_SHOT, (await win.webContents.capturePage()).toPNG());
      const menu = (Menu.getApplicationMenu() || {items: []}).items.map(i => [i.label, (i.submenu ? i.submenu.items : []).map(x => x.label)]);
      console.log('SMOKE ' + JSON.stringify(Object.assign(r, {status: status(), menu})));
      app.quit();
    });
    return;
  }
  if (process.env.HEALTH_CONNECT) console.log('CONNECT ' + JSON.stringify(await connect(process.env.HEALTH_CONNECT)));
  else updateAll();
});

app.on('window-all-closed', () => app.quit());

module.exports = {connect, finishFatSecret, services, updater, saveUserKey, userKey};
