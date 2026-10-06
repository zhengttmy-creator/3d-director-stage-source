const { app, BrowserWindow, Menu, session, dialog, shell, screen } = require('electron');
const fs = require('node:fs/promises');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { randomUUID } = require('node:crypto');
const { productName } = require('../package.json');

const testArgument = process.argv.find(value => value.startsWith('--self-test='));
const testRoot = testArgument ? path.resolve(testArgument.slice('--self-test='.length)) : null;
app.setName(productName);
app.setAppUserModelId('cn.yuyantai.director');
app.setPath('userData', testRoot ? path.join(testRoot, 'profile') : path.join(app.getPath('appData'), 'YuyantaiDirector'));
const userData = app.getPath('userData');
const appRoot = app.getAppPath();
let mainWindow;
let server;
let origin;
let completedTest = false;

async function copyIfMissing(source, destination) {
  try {
    await fs.access(destination);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    await fs.cp(source, destination, { recursive: true, errorOnExist: true, force: false });
  }
}

async function initializeData() {
  const stateDir = path.join(userData, 'state');
  const marker = path.join(stateDir, 'initialized.json');
  await fs.mkdir(stateDir, { recursive: true });
  try { await fs.access(marker); return stateDir; }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  const seed = path.join(appRoot, 'seed');
  const entries = await fs.readdir(seed, { withFileTypes: true }).catch(error => {
    if (error.code === 'ENOENT') return [];
    throw error;
  });
  for (const entry of entries) {
    if (entry.name.startsWith(".")) continue;
    await copyIfMissing(path.join(seed, entry.name), path.join(stateDir, entry.name));
  }
  await fs.writeFile(marker, JSON.stringify({ version: app.getVersion(), initializedAt: new Date().toISOString() }), { flag: 'wx' });
  return stateDir;
}

async function initializeAssets() {
  const applicationDirectory = process.platform === 'darwin'
    ? userData
    : app.isPackaged
      ? process.env.PORTABLE_EXECUTABLE_DIR || path.dirname(process.execPath)
      : appRoot;
  const preferred = testRoot ? path.join(testRoot, 'Assets') : path.join(applicationDirectory, 'Assets');
  const candidates = testRoot ? [preferred] : [...new Set([preferred, path.join(userData, 'Assets')])];
  let lastError;
  for (const candidate of candidates) {
    const probe = path.join(candidate, '.write-check-' + randomUUID());
    try {
      await fs.mkdir(candidate, { recursive: true });
      for (const category of ['characters', 'models', 'motions', 'poses']) {
        await fs.mkdir(path.join(candidate, category), { recursive: true });
      }
      const file = await fs.open(probe, 'wx');
      await file.close();
      await fs.unlink(probe);
      return await fs.realpath(candidate);
    } catch (error) {
      lastError = error;
      await fs.unlink(probe).catch(() => {});
    }
  }
  throw new Error('无法创建可写的资产文件夹：' + lastError.message);
}

async function start() {
  const stateDir = await initializeData();
  const assetsRoot = await initializeAssets();
  const openAssets = async () => {
    const error = await shell.openPath(assetsRoot);
    if (error) throw new Error(error);
  };
  const settingsFile = path.join(userData, 'desktop.json');
  let savedSettings = {};
  try { savedSettings = JSON.parse(await fs.readFile(settingsFile, 'utf8')); }
  catch (error) { if (error.code !== 'ENOENT' && !(error instanceof SyntaxError)) throw error; }
  const { startDirectorServer } = await import(pathToFileURL(path.join(appRoot, 'web', 'server.mjs')).href);
  const savedPort = Number.isInteger(savedSettings.port) && savedSettings.port >= 1024 && savedSettings.port <= 65535 ? savedSettings.port : 4295;
  const serverOptions = { webRoot: path.join(appRoot, 'web'), stateDir, assetsRoot, onOpenAssets: openAssets, port: testRoot ? 0 : savedPort };
  try { server = await startDirectorServer(serverOptions); }
  catch (error) {
    if (error.code !== 'EADDRINUSE') throw error;
    server = await startDirectorServer({ ...serverOptions, port: 0 });
  }
  origin = `http://127.0.0.1:${server.address().port}`;
  await fs.writeFile(settingsFile, JSON.stringify({ port: server.address().port }));

  session.defaultSession.setPermissionRequestHandler((_contents, permission, callback) => callback(permission === 'clipboard-sanitized-write'));
  session.defaultSession.setPermissionCheckHandler((_contents, permission) => permission === 'clipboard-sanitized-write');
  session.defaultSession.on('will-download', (_event, item) => {
    item.setSaveDialogOptions({ title: '保存导出文件', defaultPath: path.join(app.getPath('downloads'), path.basename(item.getFilename())) });
  });
  const area = screen.getPrimaryDisplay().workAreaSize;
  mainWindow = new BrowserWindow({
    title: productName, width: Math.min(1600, area.width), height: Math.min(1000, area.height),
    minWidth: 960, minHeight: 640, show: false, backgroundColor: '#171717',
    icon: path.join(appRoot, 'app.ico'),
    webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true, backgroundThrottling: false },
  });
  const errors = [];
  mainWindow.webContents.on('console-message', (_event, level, message) => { if (level >= 3) errors.push(message); });
  mainWindow.webContents.on('render-process-gone', (_event, details) => errors.push('Renderer: ' + details.reason));
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (new URL(url).origin !== origin) event.preventDefault();
  });
  mainWindow.webContents.on('will-prevent-unload', event => {
    if (completedTest) return event.preventDefault();
    const result = dialog.showMessageBoxSync(mainWindow, {
      type: 'question', title: '尚有未保存的修改', message: '退出前是否返回编辑器保存项目？',
      buttons: ['返回编辑器', '退出'], defaultId: 0, cancelId: 0, noLink: true,
    });
    if (result === 1) event.preventDefault();
  });
  mainWindow.on('page-title-updated', event => { event.preventDefault(); mainWindow.setTitle(productName); });
  const save = () => mainWindow.webContents.executeJavaScript("document.querySelector('[data-testid=director-stage-save-control] button:not([disabled])')?.click()");
  const refreshAssets = () => mainWindow.webContents.executeJavaScript("window.dispatchEvent(new CustomEvent('local-director-assets-refresh'))");
  const openGuide = async () => {
    const error = await shell.openPath(path.join(appRoot, 'docs', 'user-guide.html'));
    if (error) throw new Error(error);
  };
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    ...(process.platform === 'darwin' ? [{ role: 'appMenu' }] : []),
    { label: '文件', submenu: [
      { label: '保存项目', accelerator: 'CmdOrCtrl+S', click: () => save().catch(error => dialog.showErrorBox('保存失败', error.message)) },
      { label: '打开资产文件夹', click: () => openAssets().catch(error => dialog.showErrorBox('打开资产文件夹失败', error.message)) },
      { label: '刷新资产', click: () => refreshAssets().catch(error => dialog.showErrorBox('刷新资产失败', error.message)) },
      { label: '打开数据文件夹', click: () => shell.openPath(path.join(userData, 'state')) },
      { type: 'separator' }, { label: '退出', role: 'quit' },
    ] },
    ...(process.platform === 'darwin' ? [{ label: '编辑', role: 'editMenu' }] : []),
    { label: '视图', submenu: [{ label: '重新加载', role: 'reload' }, { label: '全屏', role: 'togglefullscreen' }] },
    { label: '帮助', submenu: [
      { label: '使用教程', accelerator: 'F1', click: () => openGuide().catch(error => dialog.showErrorBox('打开教程失败', error.message)) },
      { type: 'separator' },
      { label: '关于绮绘预演台', click: () => dialog.showMessageBox(mainWindow, {
      type: 'info', title: productName, message: productName,
      detail: `版本 ${app.getVersion()}\n本地三维导演台\n项目、动作库与截图保存在本机。\n外部资产：` + assetsRoot,
    }) }] },
  ]));
  await mainWindow.loadURL(origin + '/');
  if (testRoot) {
    await require('./self-test.cjs')({ window: mainWindow, origin, userData, testRoot, errors });
    completedTest = true;
    mainWindow.destroy();
    await new Promise(resolve => server.close(resolve));
    app.exit(0);
  } else {
    mainWindow.show();
  }
}

async function fail(error) {
  const logRoot = testRoot || userData;
  await fs.mkdir(logRoot, { recursive: true });
  await fs.writeFile(path.join(logRoot, 'failure.txt'), String(error.stack || error));
  if (!testRoot) dialog.showErrorBox('绮绘预演台启动失败', error.message);
  completedTest = true;
  mainWindow?.destroy();
  server?.close();
  app.exit(1);
}

if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', () => {
    if (mainWindow) { if (mainWindow.isMinimized()) mainWindow.restore(); mainWindow.show(); mainWindow.focus(); }
  });
  app.whenReady().then(start).catch(fail);
}
app.on('window-all-closed', () => { if (!testRoot) app.quit(); });
app.on('will-quit', () => { if (!testRoot) server?.close(); });
if (testRoot) setTimeout(() => fail(new Error('Desktop smoke test timed out')), 90000).unref();
