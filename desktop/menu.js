// Меню приложения по-русски — для Mac и Windows (шаблон для Menu.buildFromTemplate; тест — test/menu.test.js).
// Mac: меню программы (О программе, Службы, Скрыть…), «Окно», назад/вперёд — ⌘[ / ⌘].
// Windows: «Файл → Выход», назад/вперёд — Alt+← / Alt+→, «О программе» — в «Справке».
// «Справка» — «Что нового» и «Журнал работы» (папка logs) вместо ссылок Electron; инструменты разработчика — только не в сборке.

/** {platform, packaged, go(dir), whatsNew(), logs()} → шаблон меню. */
function template({platform, packaged, go, whatsNew, logs}) {
  const mac = platform === 'darwin', sep = {type: 'separator'}, name = 'SEL';
  const about = {role: 'about', label: `О программе ${name}`};
  return [
    ...(mac ? [{label: 'SEL', submenu: [about, sep, {role: 'services', label: 'Службы'}, sep,
      {role: 'hide', label: `Скрыть ${name}`}, {role: 'hideOthers', label: 'Скрыть остальные'}, {role: 'unhide', label: 'Показать все'}, sep,
      {role: 'quit', label: `Завершить ${name}`}]}] : []),
    {label: 'Файл', submenu: mac ? [{role: 'close', label: 'Закрыть окно'}] : [{role: 'quit', label: 'Выход'}]},
    {label: 'Правка', submenu: [{role: 'undo', label: 'Отменить'}, {role: 'redo', label: 'Повторить'}, sep,
      {role: 'cut', label: 'Вырезать'}, {role: 'copy', label: mac ? 'Скопировать' : 'Копировать'}, {role: 'paste', label: 'Вставить'},
      ...(mac ? [{role: 'pasteAndMatchStyle', label: 'Вставить и сохранить стиль'}] : []), {role: 'delete', label: 'Удалить'},
      {role: 'selectAll', label: 'Выбрать все'}]},
    {label: 'Вид', submenu: [{label: 'Назад', accelerator: mac ? 'Cmd+[' : 'Alt+Left', click: () => go('goBack')},
      {label: 'Вперёд', accelerator: mac ? 'Cmd+]' : 'Alt+Right', click: () => go('goForward')}, sep,
      {role: 'reload', label: 'Обновить страницу'},
      ...(packaged ? [] : [{role: 'toggleDevTools', label: 'Инструменты разработчика'}]), sep,
      {role: 'resetZoom', label: 'Фактический размер'}, {role: 'zoomIn', label: 'Увеличить'}, {role: 'zoomOut', label: 'Уменьшить'}, sep,
      {role: 'togglefullscreen', label: 'Во весь экран'}]},
    ...(mac ? [{label: 'Окно', role: 'window', submenu: [{role: 'minimize', label: 'Свернуть'}, {role: 'zoom', label: 'Масштаб'}, sep,
      {role: 'front', label: 'Все окна — на передний план'}]}] : []),
    {label: 'Справка', role: 'help', submenu: [{label: `Что нового в ${name}`, click: whatsNew},
      {label: 'Журнал работы', click: logs}, ...(mac ? [] : [sep, about])]},
  ];
}

module.exports = {template};
