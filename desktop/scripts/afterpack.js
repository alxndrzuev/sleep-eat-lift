// electron-builder afterPack (Mac и Windows): распаковать app.asar и проверить приватность всей сборки (scripts/privacy.js).
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const asar = require('@electron/asar');
const {execFileSync} = require('node:child_process');
const privacy = require('./privacy');
const {FIELDS} = require('../keys');

/** Папка ресурсов сборки (app.asar, portal/): Mac — <имя>.app/Contents/Resources, Windows — resources рядом с exe. */
function resourcesDir(platform, appOutDir, productFilename) {
  return platform === 'darwin' ? path.join(appOutDir, `${productFilename}.app`, 'Contents', 'Resources') : path.join(appOutDir, 'resources');
}

exports.resourcesDir = resourcesDir;
exports.default = async function (ctx) {
  const res = resourcesDir(ctx.electronPlatformName, ctx.appOutDir, ctx.packager.appInfo.productFilename);
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'health-asar-'));
  asar.extractAll(path.join(res, 'app.asar'), path.join(tmp, 'app'));
  fs.cpSync(path.join(res, 'portal'), path.join(tmp, 'portal'), {recursive: true});
  const values = privacy.secretValues(require('../keys').dataSecrets(), FIELDS);
  privacy.check(tmp, values);
  fs.rmSync(tmp, {recursive: true, force: true});
  // macOS вешает на файлы в «Документах» служебные атрибуты — codesign их не принимает («detritus not allowed»)
  if (ctx.electronPlatformName === 'darwin') execFileSync('xattr', ['-cr', ctx.appOutDir]);
  console.log(`  • приватность: ок (${privacy.files(path.join(res)).length} файлов, ${values.length} секретов проверено)`);
};
