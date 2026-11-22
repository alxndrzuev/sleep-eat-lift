// Раскладка dist/: у выпущенной версии — своя папка dist/<версия>/ (release-notes.md + zip для Mac + exe для Windows);
// пока в «Не выпущено» есть пункты, сборка проверочная — dist/dev/ (заметки — то, что ещё не выпущено).
// Пользуются collect.js (кладёт сборку) и install.js (берёт сборку для /Applications).
const cl = require('../changelog');

const NOTES = 'release-notes.md';

/** CHANGELOG.md + версия из package.json → {folder, title, sections}: куда класть сборку и что писать в заметки. */
function target(md, version) {
  const p = cl.parse(md);
  if (p.unreleased.length) return {folder: 'dev', title: `SEL ${version} + ещё не выпущенное (проверочная сборка)`, sections: p.unreleased};
  const e = cl.entry(md, version);
  if (!e) throw new Error(`Нет заметок к версии ${version} в CHANGELOG.md`);
  return {folder: version, title: `SEL ${version} — ${e.date}`, sections: e.sections};
}

/** Заметки к сборке — markdown. */
const notes = t => `# ${t.title}\n\n` +
  t.sections.map(s => `### ${s.title}\n\n` + s.items.map(i => '- ' + i).join('\n')).join('\n\n') + '\n';

module.exports = {target, notes, NOTES};
