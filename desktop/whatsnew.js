// «Что нового» на один запуск: какие версии показать в окне после обновления (до «Понятно» — и после перезагрузки
// страницы), что запомнить показанным (сразу при запуске — окно только в этот запуск), вся история для страницы.
// dev — запуск из папки проекта: сверху истории (и окна, если оно есть) — черновик «Не выпущено».
const cl = require('./changelog');

/** {md, version, lastSeen, isNew, dev, save(v)} → {show(), seen(), history()}; save: null — ничего не записывать. */
function create({md, version, lastSeen = null, isNew = false, dev = false, save = null}) {
  const {unreleased, releases} = cl.parse(md || '');
  const draft = dev && unreleased.length ? [{version: cl.UNRELEASED, date: null, sections: unreleased}] : [];
  let pending = cl.toShow({releases, current: version, lastSeen, isNew});
  if (pending.length) pending = draft.concat(pending);
  if (save) save(cl.seenAfter(lastSeen, version));
  const all = draft.concat(cl.history(releases, version));
  return {
    show: () => ({version, releases: pending}),
    seen: () => { pending = []; return {ok: true}; },
    history: () => ({version, releases: all}),
  };
}

module.exports = {create};
