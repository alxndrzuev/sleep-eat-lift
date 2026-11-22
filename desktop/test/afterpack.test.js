// Проверка приватности после сборки ищет app.asar и portal/ там, где их кладёт сборка: Mac — внутри .app, Windows — resources/.
const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const {resourcesDir} = require('../scripts/afterpack');

test('папка ресурсов сборки: Mac и Windows', () => {
  assert.strictEqual(resourcesDir('darwin', '/out/mac-arm64', 'SEL'), path.join('/out/mac-arm64', 'SEL.app', 'Contents', 'Resources'));
  assert.strictEqual(resourcesDir('win32', '/out/win-unpacked', 'SEL'), path.join('/out/win-unpacked', 'resources'));
});
