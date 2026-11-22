// Мост для страниц портала в приложении: window.health — только эти функции (contextIsolation, sandbox).
const {contextBridge, ipcRenderer} = require('electron');

contextBridge.exposeInMainWorld('health', {
  status: () => ipcRenderer.invoke('health:status'),
  update: () => ipcRenderer.invoke('health:update'),
  connect: service => ipcRenderer.invoke('health:connect', service),
  codeEntered: verifier => ipcRenderer.invoke('health:code', verifier),
  disconnect: service => ipcRenderer.invoke('health:disconnect', service),
  saveTargets: vals => ipcRenderer.invoke('health:targets', vals),
  removeTarget: (kind, date) => ipcRenderer.invoke('health:removeTarget', kind, date),
  savePlan: vals => ipcRenderer.invoke('health:plan', vals),
  removePlan: date => ipcRenderer.invoke('health:removePlan', date),
  addSupplement: vals => ipcRenderer.invoke('health:supplementAdd', vals),
  stopSupplement: vals => ipcRenderer.invoke('health:supplementStop', vals),
  removeSupplement: vals => ipcRenderer.invoke('health:supplementRemove', vals),
  answerAlcohol: (morning, value) => ipcRenderer.invoke('health:alcohol', morning, value),
  addAlcohol: (evening, level, note) => ipcRenderer.invoke('health:alcoholAdd', evening, level, note),
  setAlcoholLevel: (evening, level) => ipcRenderer.invoke('health:alcoholLevel', evening, level),
  removeAlcohol: evening => ipcRenderer.invoke('health:alcoholRemove', evening),
  openDataFolder: () => ipcRenderer.invoke('health:folder'),
  changeDataFolder: () => ipcRenderer.invoke('health:changeFolder'),
  openExternal: url => ipcRenderer.invoke('health:external', url),
  // «Что нового»: что показать в окне после обновления, «Понятно», вся история
  whatsNew: () => ipcRenderer.invoke('health:whatsNew'),
  whatsNewSeen: () => ipcRenderer.invoke('health:whatsNewSeen'),
  changelog: () => ipcRenderer.invoke('health:changelog'),
  onStatus: cb => ipcRenderer.on('health:status', (e, s) => cb(s)),
  // файлы фото — только внутри data/photos (страница строит из них папку: portal/photos_fs.js)
  photos: {
    list: rel => ipcRenderer.invoke('health:photos', 'list', rel),
    read: rel => ipcRenderer.invoke('health:photos', 'read', rel),
    write: (rel, bytes) => ipcRenderer.invoke('health:photos', 'write', rel, bytes),
    mkdir: rel => ipcRenderer.invoke('health:photos', 'mkdir', rel),
    remove: rel => ipcRenderer.invoke('health:photos', 'remove', rel),
    exists: rel => ipcRenderer.invoke('health:photos', 'exists', rel),
  },
});
