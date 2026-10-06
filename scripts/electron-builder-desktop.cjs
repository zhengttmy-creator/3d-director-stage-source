const { build } = require('../package.json');

module.exports = {
  ...build,
  extends: null,
  win: {
    ...build.win,
    target: [
      { target: 'portable', arch: ['x64'] },
      { target: 'nsis', arch: ['x64'] },
    ],
  },
  portable: {
    artifactName: '${productName}-${arch}.${ext}',
  },
  nsis: {
    artifactName: '${productName}-Setup-${arch}.${ext}',
    oneClick: false,
    perMachine: false,
    allowElevation: false,
    allowToChangeInstallationDirectory: true,
    createDesktopShortcut: true,
    createStartMenuShortcut: true,
    shortcutName: build.productName,
    deleteAppDataOnUninstall: false,
  },
};
