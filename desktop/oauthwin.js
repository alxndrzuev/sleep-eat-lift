// Окно входа сервиса (FatSecret, Whoop): открыть страницу авторизации в отдельной сессии без моста preload,
// дождаться перехода на обратный адрес (он не существует — переход перехватываем), вернуть его и закрыть окно.
// Закрыли окно без «Allow» → null. Перед каждым входом сессия окна очищается: в SEL несколько профилей, и без этого
// второй человек вошёл бы автоматически под аккаунтом первого (куки остались с прошлого входа).
const {BrowserWindow, session} = require('electron');

async function open({url, callbackPrefix, partition, parent, title}) {
  await session.fromPartition(partition).clearStorageData();
  return new Promise(resolve => {
    let done = false;
    const win = new BrowserWindow({width: 560, height: 760, parent, title,
      webPreferences: {partition, contextIsolation: true, sandbox: true, nodeIntegration: false}});
    const finish = (val) => {
      if (done) return; done = true;
      resolve(val);
      if (!win.isDestroyed()) win.close();
    };
    const catchUrl = (e, u) => { if (u.startsWith(callbackPrefix)) { e.preventDefault(); finish(new URL(u)); } };
    win.webContents.on('will-redirect', catchUrl);
    win.webContents.on('will-navigate', catchUrl);
    session.fromPartition(partition).webRequest.onBeforeRequest({urls: [callbackPrefix + '*']}, (d, cb) => {
      cb({cancel: true}); finish(new URL(d.url));
    });
    win.webContents.setWindowOpenHandler(() => ({action: 'deny'}));
    win.on('closed', () => finish(null));
    win.loadURL(url);
  });
}

module.exports = {open};
