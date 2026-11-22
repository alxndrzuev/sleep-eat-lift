// Сборка: каждый модуль, который подключает код приложения (require('./…')), входит в build.files package.json.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

test('every local require is packaged', () => {
  const pkg = require('../package.json');
  const files = new Set(pkg.build.files);
  const seen = new Set(), todo = [pkg.main];
  while (todo.length) {
    const f = todo.pop();
    if (seen.has(f)) continue;
    seen.add(f);
    assert.ok(files.has(f), `${f} нет в build.files`);
    const src = fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
    for (const m of src.matchAll(/require\('\.\/([^']+)'\)/g)) todo.push(m[1].endsWith('.json') ? m[1] : m[1] + '.js');
  }
  assert.ok(files.has('preload.js'), 'preload.js нет в build.files');
});
