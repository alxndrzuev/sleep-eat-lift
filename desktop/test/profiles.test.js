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

// ---------- перенос 1.x: данные из корня — в профиль ----------
const store = require('../store');
const read = (...p) => fs.readFileSync(path.join(...p), 'utf8');
const json = (...p) => JSON.parse(read(...p));

/** Папка данных 1.x: CSV со строками, фото, docs, ключи, незнакомое. */
function oldFolder() {
  const root = tmp();
  store.init(root);
  store.upsert(root, 'body.csv', {'2026-11-01': {weight_kg: 80}});
  fs.mkdirSync(path.join(root, 'photos', 'originals'), {recursive: true});
  fs.writeFileSync(path.join(root, 'photos', 'originals', '2026-11-01_front.jpg'), 'img');
  fs.mkdirSync(path.join(root, 'docs')); fs.writeFileSync(path.join(root, 'docs', 'x.md'), 'doc');
  fs.writeFileSync(path.join(root, 'sync.json'), '{"fatsecret":"2026-11-23T00:00:00Z"}');
  fs.writeFileSync(path.join(root, 'secrets', 'fatsecret.json'),
    JSON.stringify({consumer_key: 'ck', consumer_secret: 'cs', access_token: 'at', access_secret: 'as'}));
  fs.writeFileSync(path.join(root, 'secrets', 'whoop.json'), JSON.stringify({client_id: 'wi', client_secret: 'ws', refresh_token: 'rt'}));
  fs.writeFileSync(path.join(root, 'secrets', 'whoop_app.json'), JSON.stringify({client_id: 'app', client_secret: 'appsec'}));
  fs.mkdirSync(path.join(root, 'logs')); fs.writeFileSync(path.join(root, 'logs', 'l.txt'), 'log');
  fs.writeFileSync(path.join(root, '.DS_Store'), 'ds');
  return root;
}

test('needsMigration: old CSV in the root and no profiles', () => {
  assert.strictEqual(pr.needsMigration(tmp()), false);               // пустая папка — новичок
  const root = oldFolder();
  assert.strictEqual(pr.needsMigration(root), true);
  pr.migrate(root, 'Александр', T);
  assert.strictEqual(pr.needsMigration(root), false);
});

test('migrate moves what the app knows into the profile, leaves the rest', () => {
  const root = oldFolder();
  const {id, dir} = pr.migrate(root, 'Александр', T);
  assert.strictEqual(id, 'aleksandr');
  assert.deepStrictEqual(store.read(dir, 'body.csv').map(r => r.weight_kg), ['80']);
  assert.strictEqual(read(dir, 'photos', 'originals', '2026-11-01_front.jpg'), 'img');
  assert.strictEqual(read(dir, 'docs', 'x.md'), 'doc');
  assert.ok(fs.existsSync(path.join(dir, 'sync.json')));
  assert.strictEqual(json(dir, 'secrets', 'fatsecret.json').access_token, 'at');
  assert.strictEqual(json(dir, 'secrets', 'whoop.json').refresh_token, 'rt');
  for (const f of ['body.csv', 'photos', 'docs', 'sync.json', 'secrets/fatsecret.json', 'secrets/whoop.json'])
    assert.ok(!fs.existsSync(path.join(root, f)), f + ' остался в корне');
  // ключи приложений — в корне: старый whoop_app.json не тронут, fatsecret_app.json — из consumer-полей
  assert.deepStrictEqual(json(root, 'secrets', 'whoop_app.json'), {client_id: 'app', client_secret: 'appsec'});
  assert.deepStrictEqual(json(root, 'secrets', 'fatsecret_app.json'), {consumer_key: 'ck', consumer_secret: 'cs'});
  assert.strictEqual(read(root, 'logs', 'l.txt'), 'log');
  assert.strictEqual(read(root, '.DS_Store'), 'ds');
  assert.deepStrictEqual(pr.list(root), [{id, name: 'Александр', created: T, migrating: false}]);
});

test('migrate: whoop app keys from whoop.json when whoop_app.json is missing', () => {
  const root = oldFolder();
  fs.rmSync(path.join(root, 'secrets', 'whoop_app.json'));
  pr.migrate(root, 'А', T);
  assert.deepStrictEqual(json(root, 'secrets', 'whoop_app.json'), {client_id: 'wi', client_secret: 'ws'});
});

test('interrupted migration is finished by resume', () => {
  const root = oldFolder();
  const id = 'aleksandr', dir = pr.dir(root, id);
  fs.mkdirSync(path.join(dir, 'secrets'), {recursive: true});
  pr.writeMeta(root, id, {name: 'Александр', created: T, migrating: true});
  fs.renameSync(path.join(root, 'body.csv'), path.join(dir, 'body.csv'));          // успело переехать
  assert.strictEqual(pr.needsMigration(root), false);
  assert.strictEqual(pr.resume(root), id);
  assert.ok(fs.existsSync(path.join(dir, 'photos', 'originals', '2026-11-01_front.jpg')));
  assert.deepStrictEqual(store.read(dir, 'body.csv').map(r => r.weight_kg), ['80']);
  assert.strictEqual(pr.list(root)[0].migrating, false);
  assert.strictEqual(pr.resume(root), null);
});

test('old data in the root next to profiles: empty CSV — silence; rows — warning, adoptOld moves them', () => {
  const root = oldFolder();
  pr.migrate(root, 'Александр', T);
  assert.strictEqual(pr.oldRootData(root), null);
  store.init(root);                                                  // так сделает 1.x — пустые CSV в корне
  assert.strictEqual(pr.oldRootData(root), null);
  store.upsert(root, 'body.csv', {'2026-11-20': {weight_kg: 81}});
  const old = pr.oldRootData(root);
  assert.strictEqual(old.rows, 1);
  assert.strictEqual(typeof old.sig, 'string');
  const {dir} = pr.adoptOld(root, 'Старое', T);
  assert.deepStrictEqual(store.read(dir, 'body.csv').map(r => r.weight_kg), ['81']);
  assert.strictEqual(pr.oldRootData(root), null);
  assert.deepStrictEqual(pr.list(root).map(p => p.name), ['Александр', 'Старое']);
});

test('root README: written from root_readme.md, a foreign README is left alone', () => {
  const root = tmp();
  pr.writeRootReadme(root);
  const want = read(__dirname, '..', 'root_readme.md');
  assert.strictEqual(read(root, 'README.md'), want);
  assert.ok(want.startsWith('# Папка данных SEL — профили'));
  const other = tmp();
  fs.writeFileSync(path.join(other, 'README.md'), '# Мой файл');
  pr.writeRootReadme(other);
  assert.strictEqual(read(other, 'README.md'), '# Мой файл');
});

test('profile README is the per-person data README', () => {
  const {dir} = pr.create(tmp(), 'Иван', T);
  assert.ok(read(dir, 'README.md').startsWith('# Папка данных SEL'));
  assert.match(read(dir, 'README.md'), /одного профиля/);
});

test('migration failed midway and «Создать» pressed again → the same profile is finished, no second one', () => {
  const root = oldFolder();
  const real = fs.renameSync;
  let failed = false;
  fs.renameSync = (from, to) => {                                    // занятая папка (Windows: Проводник, OneDrive)
    if (!failed && from.endsWith(`${path.sep}photos`)) { failed = true; const e = new Error('EBUSY: photos'); e.code = 'EBUSY'; throw e; }
    return real(from, to);
  };
  try { assert.throws(() => pr.migrate(root, 'Александр', T), /EBUSY/); }
  finally { fs.renameSync = real; }
  const {id, dir} = pr.migrate(root, 'Александр', T);
  assert.strictEqual(id, 'aleksandr');
  assert.deepStrictEqual(pr.list(root).map(p => [p.id, p.migrating]), [['aleksandr', false]]);
  assert.ok(fs.existsSync(path.join(dir, 'photos', 'originals', '2026-11-01_front.jpg')));
  assert.deepStrictEqual(store.read(dir, 'body.csv').map(r => r.weight_kg), ['80']);
});
