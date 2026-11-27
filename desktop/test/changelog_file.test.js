// CHANGELOG.md приложения: разбирается, у текущей версии (package.json) есть датированная запись, разделы — только
// разрешённые, файл входит в сборку.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const cl = require('../changelog');

const pkg = require('../package.json');
const md = fs.readFileSync(path.join(__dirname, '..', 'CHANGELOG.md'), 'utf8');
const SECTIONS = ['Новое', 'Изменено', 'Исправлено', 'Удалено', 'Безопасность'];

test('current version has a dated entry', () => {
  const r = cl.parse(md).releases.find(x => x.version === pkg.version);
  assert.ok(r, `нет записи ## [${pkg.version}] в CHANGELOG.md`);
  assert.match(r.date || '', /^\d{4}-\d{2}-\d{2}$/);
  assert.ok(r.sections.length, `у ${pkg.version} нет ни одного пункта`);
});

test('versions valid, unique, newest first; sections allowed and in order', () => {
  const {unreleased, releases} = cl.parse(md);
  const vs = releases.map(r => r.version);
  for (const v of vs) assert.ok(cl.valid(v), v);
  assert.strictEqual(new Set(vs).size, vs.length);
  assert.deepStrictEqual(vs, vs.slice().sort((a, b) => cl.cmp(b, a)));
  for (const secs of [unreleased, ...releases.map(r => r.sections)]) {
    const t = secs.map(s => s.title);
    for (const x of t) assert.ok(SECTIONS.includes(x), `раздел «${x}»`);
    assert.strictEqual(new Set(t).size, t.length, `раздел повторяется: ${t}`);   // два «Новое» подряд — так и покажет «Что нового»
    assert.deepStrictEqual(t, t.slice().sort((a, b) => SECTIONS.indexOf(a) - SECTIONS.indexOf(b)));
  }
});

test('changelog is packaged', () => {
  for (const f of ['CHANGELOG.md', 'changelog.js']) assert.ok(pkg.build.files.includes(f), `${f} нет в build.files`);
});
