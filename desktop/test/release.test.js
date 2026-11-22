// Выпуск версии (scripts/release.js) во временном git: заметки — под номер с датой, версия в package.json и
// package-lock.json, коммит «Выпуск X.Y.Z» и тег vX.Y.Z; ошибка — ничего не меняется. Запись заметок — entry().
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {execFileSync, spawnSync} = require('node:child_process');
const cl = require('../changelog');

const SCRIPT = path.join(__dirname, '..', 'scripts', 'release.js');
const ENV = Object.assign({}, process.env, {GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1',
  GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t'});
const MD = '# Что нового\n\n## [Не выпущено]\n\n### Новое\n- Окно «Что нового»\n\n## [0.1.0] — 2026-11-21\n\n### Новое\n- Проверка\n';

function repo() {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'health-rel-'));
  fs.writeFileSync(path.join(d, 'package.json'), JSON.stringify({name: 'x', version: '0.1.0'}, null, 2) + '\n');
  fs.writeFileSync(path.join(d, 'package-lock.json'),
    JSON.stringify({name: 'x', version: '0.1.0', lockfileVersion: 3, packages: {'': {name: 'x', version: '0.1.0'}}}, null, 2) + '\n');
  fs.writeFileSync(path.join(d, 'CHANGELOG.md'), MD);
  const git = (...a) => execFileSync('git', a, {cwd: d, env: ENV, encoding: 'utf8'}).trim();
  git('init', '-q'); git('add', '.'); git('commit', '-qm', 'init');
  return {d, git, run: v => spawnSync(process.execPath, [SCRIPT, v], {cwd: d, encoding: 'utf8',
    env: Object.assign({HEALTH_RELEASE_DIR: d, HEALTH_TODAY: '2026-11-25'}, ENV)})};
}

test('release 1.0.0: notes dated, versions bumped, commit and tag', () => {
  const {d, git, run} = repo();
  const r = run('1.0.0');
  assert.strictEqual(r.status, 0, r.stderr);
  const md = fs.readFileSync(path.join(d, 'CHANGELOG.md'), 'utf8');
  assert.deepStrictEqual(cl.entry(md, '1.0.0'), {version: '1.0.0', date: '2026-11-25', sections: [{title: 'Новое', items: ['Окно «Что нового»']}]});
  assert.strictEqual(JSON.parse(fs.readFileSync(path.join(d, 'package.json'), 'utf8')).version, '1.0.0');
  const lock = JSON.parse(fs.readFileSync(path.join(d, 'package-lock.json'), 'utf8'));
  assert.deepStrictEqual([lock.version, lock.packages[''].version], ['1.0.0', '1.0.0']);
  assert.strictEqual(git('log', '-1', '--format=%s'), 'Выпуск 1.0.0');
  assert.strictEqual(git('status', '--porcelain'), '');
  assert.strictEqual(git('tag'), 'v1.0.0');
  assert.match(git('tag', '-n20', 'v1.0.0'), /Окно «Что нового»/);
});

test('release refused: not newer, bad number, empty notes — files untouched', () => {
  const {d, git, run} = repo();
  for (const [v, msg] of [['0.1.0', /больше текущей 0\.1\.0/], ['1.0', /X\.Y\.Z/]]) {
    const r = run(v);
    assert.strictEqual(r.status, 1, v);
    assert.match(r.stderr, msg);
  }
  assert.strictEqual(git('status', '--porcelain'), '');
  assert.strictEqual(run('1.0.0').status, 0);
  const r = run('1.0.1');
  assert.strictEqual(r.status, 1);
  assert.match(r.stderr, /«Не выпущено» пуст/);
  assert.strictEqual(git('log', '-1', '--format=%s'), 'Выпуск 1.0.0');
});

test('entry: dated release with notes, or null', () => {
  assert.strictEqual(cl.entry(MD, '0.1.0').date, '2026-11-21');
  assert.strictEqual(cl.entry(MD, '1.0.0'), null);
  assert.strictEqual(cl.entry('## [2.0.0]\n\n### Новое\n- А\n', '2.0.0'), null);          // без даты — не выпущена
  assert.strictEqual(cl.entry('## [2.0.0] — 2026-01-01\n', '2.0.0'), null);               // без пунктов
});
