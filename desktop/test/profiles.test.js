// Профили: в корне папки данных — profiles/<id>/ (у каждого свои CSV, фото, токены); id — латиница из имени.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const pr = require('../profiles');

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'health-pr-'));
const T = '2026-11-23';

test('slug: transliteration, collisions, nothing usable → profile', () => {
  assert.strictEqual(pr.slug('Александр', new Set()), 'aleksandr');
  assert.strictEqual(pr.slug('Иван Петров', new Set(['ivan-petrov'])), 'ivan-petrov-2');
  assert.strictEqual(pr.slug('Иван Петров', new Set(['ivan-petrov', 'ivan-petrov-2'])), 'ivan-petrov-3');
  assert.strictEqual(pr.slug('Щука Юля Ёж', new Set()), 'shchuka-yulya-yozh');
  assert.strictEqual(pr.slug('../..', new Set()), 'profile');
  assert.strictEqual(pr.slug('😀', new Set()), 'profile');
  assert.strictEqual(pr.slug('😀', new Set(['profile'])), 'profile-2');
  assert.match(pr.slug('а'.repeat(80), new Set()), /^a{1,32}$/);
});

test('cleanName: trims and collapses spaces; empty or longer than 40 → error', () => {
  assert.strictEqual(pr.cleanName('  Мария   С. '), 'Мария С.');
  assert.throws(() => pr.cleanName('  '), /от 1 до 40/);
  assert.throws(() => pr.cleanName('я'.repeat(41)), /от 1 до 40/);
  assert.throws(() => pr.cleanName(null), /от 1 до 40/);
});

test('create → folder with profile.json and CSV; list sorted by name', () => {
  const root = tmp();
  const a = pr.create(root, 'Иван', T), b = pr.create(root, 'Борис', T);
  assert.deepStrictEqual(a, {id: 'ivan', dir: path.join(root, 'profiles', 'ivan')});
  assert.ok(fs.existsSync(path.join(b.dir, 'body.csv')));
  assert.deepStrictEqual(JSON.parse(fs.readFileSync(path.join(a.dir, 'profile.json'), 'utf8')), {name: 'Иван', created: T});
  assert.deepStrictEqual(pr.list(root).map(p => [p.id, p.name]), [['boris', 'Борис'], ['ivan', 'Иван']]);
  fs.mkdirSync(path.join(root, 'profiles', 'junk'));                // папка без profile.json — не профиль
  assert.strictEqual(pr.list(root).length, 2);
  assert.deepStrictEqual(pr.list(tmp()), []);
});

test('rename changes only the name', () => {
  const root = tmp();
  const {id, dir} = pr.create(root, 'Иван', T);
  pr.rename(root, id, ' Иван  Петров ');
  assert.deepStrictEqual(pr.list(root).map(p => [p.id, p.name]), [['ivan', 'Иван Петров']]);
  assert.ok(fs.existsSync(dir));
  assert.throws(() => pr.rename(root, id, ''), /от 1 до 40/);
});

test('dir rejects ids that leave profiles/', () => {
  const root = tmp();
  assert.strictEqual(pr.dir(root, 'ivan-2'), path.join(root, 'profiles', 'ivan-2'));
  for (const bad of ['../x', 'a/b', '', 'Ivan', '..']) assert.throws(() => pr.dir(root, bad), /Нет такого профиля/);
});

test('pick: wanted if exists, else first, else null', () => {
  const root = tmp();
  assert.strictEqual(pr.pick(root, 'x'), null);
  pr.create(root, 'Иван', T); pr.create(root, 'Борис', T);
  assert.strictEqual(pr.pick(root, 'ivan'), 'ivan');
  assert.strictEqual(pr.pick(root, 'nope'), 'boris');
  assert.strictEqual(pr.pick(root, undefined), 'boris');
});

test('photoCount — files in photos/originals', () => {
  const root = tmp(), {dir} = pr.create(root, 'Иван', T);
  assert.strictEqual(pr.photoCount(dir), 0);
  fs.mkdirSync(path.join(dir, 'photos', 'originals'), {recursive: true});
  fs.writeFileSync(path.join(dir, 'photos', 'originals', '2026-11-01_front.jpg'), 'x');
  fs.writeFileSync(path.join(dir, 'photos', 'originals', '2026-11-01_side.jpg'), 'x');
  assert.strictEqual(pr.photoCount(dir), 2);
});

test('remove: the last profile — refused; another — to trash', async () => {
  const root = tmp(), trashed = [];
  const trash = async p => { trashed.push(p); fs.rmSync(p, {recursive: true}); };
  pr.create(root, 'Иван', T);
  await assert.rejects(pr.remove(root, 'ivan', trash), /Последний профиль/);
  pr.create(root, 'Борис', T);
  await pr.remove(root, 'ivan', trash);
  assert.deepStrictEqual(trashed, [path.join(root, 'profiles', 'ivan')]);
  assert.deepStrictEqual(pr.list(root).map(p => p.id), ['boris']);
  await assert.rejects(pr.remove(root, 'nope', trash), /Нет такого профиля/);
});
