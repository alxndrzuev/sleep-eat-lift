// portal/photos_guide.js — окно «Как снимать» перед загрузкой фото: схематичные фигурки поз, схемы кадра, правила.
const test = require('node:test');
const assert = require('node:assert');
const {load, source} = require('./_portal');

const js = load('photos_core.js', 'photos_guide.js');

test('every pose has its own schematic figure: svg in the theme colour, front ≠ back, left is the mirrored right', () => {
  const poses = js('PhotosCore.POSES');
  const svgs = Object.fromEntries(poses.map(p => [p, js(`PhotosGuide.figure("${p}")`)]));
  for (const [p, s] of Object.entries(svgs)) {
    assert.match(s, /^<svg [^>]*viewBox="0 0 100 200"/, p);
    assert.match(s, /currentColor/, p);
    assert.match(s, /<\/svg>$/, p);
  }
  assert.strictEqual(new Set(Object.values(svgs)).size, poses.length);
  assert.match(svgs.side_left, /scale\(-1,\s?1\)/);
  assert.throws(() => js('PhotosGuide.figure("dance")'), /Нет такой позы/);
});

test('guide window: all poses, side with any arms, shoulders and knees in the frame, rules, buttons', () => {
  const h = js('PhotosGuide.html()');
  for (const name of ['Спереди', 'Сбоку', 'Сзади', 'Спина, бицепс', 'Бицепс', 'Сбоку слева']) assert.ok(h.includes(name), name);
  assert.match(h, /руки любые/);
  assert.match(h, /плечи и колени/);
  assert.match(h, /до еды/);
  assert.match(h, /перетащить/);
  assert.match(h, /id="gChoose"[^>]*>Выбрать файлы</);
  assert.match(h, /id="gCancel"[^>]*>Отмена</);
  assert.strictEqual((h.match(/<svg /g) || []).length, 8);   // 6 поз + 2 схемы кадра
});

test('photos page: guide script after the logic, «Загрузить фото» opens the guide, its button — the file picker', () => {
  const h = source('photos.html');
  assert.ok(h.indexOf('<script src="photos_guide.js"></script>') > h.indexOf('<script src="photos_core.js"></script>'));
  assert.match(h, /\$\("uploadBtn"\)\.onclick = showGuide;/);
  assert.match(h, /\$\("gChoose"\)\.onclick = \(\) => \{[^}]*\$\("fileInput"\)\.click\(\)/);
});
