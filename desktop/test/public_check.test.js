// scripts/public_check.js: личное из папки данных находится в файлах; настоящий проект — чистый.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const pc = require('../../scripts/public_check');
const {rootDir, allDirs: csvAll} = require('../../scripts/csv');

function fixture() {
  const data = fs.mkdtempSync(path.join(os.tmpdir(), 'pc-data-')), repo = fs.mkdtempSync(path.join(os.tmpdir(), 'pc-repo-'));
  fs.mkdirSync(path.join(data, 'secrets'));
  fs.mkdirSync(path.join(data, 'docs'));
  fs.writeFileSync(path.join(data, 'body.csv'), 'date,weight_kg,waist_cm,bodyfat_pct,note\n2026-11-10,75.5,80.0,,FatSecret утро\n');
  fs.writeFileSync(path.join(data, 'whoop_workouts.csv'), 'id,date\n7a8e6852-0000-0000-0000-27513f5103cb,2025-05-01\n');
  fs.writeFileSync(path.join(data, 'secrets', 'whoop.json'), JSON.stringify({refresh_token: 'rt-SECRET-123456', expires_at: '2026-11-22T10:00:00Z'}));
  fs.writeFileSync(path.join(data, 'docs', '01.md'), 'Исходная точка: рост 199 см, офис, сквош два раза в неделю с тренером\n');
  return text => {
    fs.writeFileSync(path.join(repo, 'f.txt'), text);
    return pc.leaks(repo, ['f.txt'], data).map(([, kind]) => kind);
  };
}

test('finds each kind of personal data', () => {
  const check = fixture();
  assert.deepStrictEqual(check('x 2026-11-10,75.5,80.0,,FatSecret утро y'), ['строка body.csv']);
  assert.deepStrictEqual(check('id 7a8e6852-0000-0000-0000-27513f5103cb'), ['id тренировки Whoop']);
  assert.deepStrictEqual(check('{"t": "rt-SECRET-123456"}'), ['значение из secrets/whoop.json']);
  assert.deepStrictEqual(check('Исходная точка: рост 199 см, офис, сквош два раза в неделю с тренером'),
    ['строка личного документа 01.md']);
});

test('dates and clean text pass', () => {
  assert.deepStrictEqual(fixture()('2026-11-22T10:00:00Z · date,weight_kg · обычный код'), []);
});

const data = rootDir();
test('project has no personal data from the data folder', {skip: !(data && fs.existsSync(path.join(data, 'secrets'))) && 'нет папки данных на этом компьютере'}, () => {
  assert.deepStrictEqual(pc.leaks(pc.ROOT, pc.publicFiles(pc.ROOT), csvAll(data)), []);
});

test('leaks: values from every profile of the data folder are looked for', () => {
  const profiles = require('../profiles');
  const store = require('../store');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pc-prof-')), repo = fs.mkdtempSync(path.join(os.tmpdir(), 'pc-prof-repo-'));
  profiles.create(root, 'Анна', '2026-11-23');
  const b = profiles.create(root, 'Борис', '2026-11-23');
  store.upsert(b.dir, 'body.csv', {'2026-11-21': {weight_kg: 70, note: 'секретная заметка Бориса'}});
  fs.writeFileSync(path.join(repo, 'x.md'), 'тут 2026-11-21,70,секретная заметка Бориса');
  const found = pc.leaks(repo, ['x.md'], csvAll(root));
  assert.deepStrictEqual(found.map(f => f[0]), ['x.md']);
});

test('tracked symlinks are reported (a link carries a local path into the public repo)', () => {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'pc-link-'));
  const {execFileSync} = require('node:child_process');
  const git = (...a) => execFileSync('git', a, {cwd: repo});
  git('init', '-q');
  fs.writeFileSync(path.join(repo, 'a.txt'), 'x');
  fs.symlinkSync('/Users/someone/elsewhere', path.join(repo, 'node_modules'));
  git('add', 'a.txt', 'node_modules');
  assert.deepStrictEqual(pc.symlinks(repo), ['node_modules']);
  git('rm', '-q', '--cached', 'node_modules');
  assert.deepStrictEqual(pc.symlinks(repo), []);
});

test('what goes into the commit is checked: staged content, not only the working copy', () => {
  const {execFileSync} = require('node:child_process');
  const data = fs.mkdtempSync(path.join(os.tmpdir(), 'pc-data-')), repo = fs.mkdtempSync(path.join(os.tmpdir(), 'pc-idx-'));
  fs.mkdirSync(path.join(data, 'secrets'));
  fs.writeFileSync(path.join(data, 'secrets', 'whoop.json'), JSON.stringify({refresh_token: 'rt-SECRET-123456'}));
  const git = (...a) => execFileSync('git', a, {cwd: repo});
  git('init', '-q');
  fs.writeFileSync(path.join(repo, 'a.txt'), 'token rt-SECRET-123456');
  fs.writeFileSync(path.join(repo, 'b.txt'), 'token rt-SECRET-123456');
  git('add', 'a.txt', 'b.txt');
  fs.writeFileSync(path.join(repo, 'a.txt'), 'чисто');                 // в рабочей папке убрали, в индексе — осталось
  fs.rmSync(path.join(repo, 'b.txt'));                                 // файла нет, а в индексе он есть
  const files = pc.publicFiles(repo);
  assert.deepStrictEqual(files.slice().sort(), ['a.txt', 'b.txt']);
  assert.deepStrictEqual(pc.leaks(repo, files, data), [['a.txt', 'значение из secrets/whoop.json'], ['b.txt', 'значение из secrets/whoop.json']]);
  git('add', '-A');                                                    // поправили и в индексе — чисто
  assert.deepStrictEqual(pc.leaks(repo, pc.publicFiles(repo), data), []);
});
