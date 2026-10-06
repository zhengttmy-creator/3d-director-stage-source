const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const { parse } = require('@babel/parser');

const source = fs.readFileSync(path.join(__dirname, '..', 'desktop', 'main.cjs'), 'utf8');
const initializer = parse(source).program.body.find(node => node.type === 'FunctionDeclaration' && node.id.name === 'initializeAssets');
assert(initializer, 'The actual desktop asset initializer must be tested');
const script = new vm.Script('(' + source.slice(initializer.start, initializer.end) + ')()');

async function initialize({ platform, execPath, userData, appRoot = '/source', testRoot = null, portableDirectory, isPackaged = true, deniedRoot }) {
  const created = [];
  const paths = platform === 'win32' ? path.win32 : path.posix;
  const context = {
    path: paths, app: { isPackaged }, appRoot, testRoot, userData,
    process: { platform, execPath, env: { PORTABLE_EXECUTABLE_DIR: portableDirectory } },
    randomUUID: () => 'probe',
    fs: {
      mkdir: async directory => {
        created.push(directory);
        if (directory === deniedRoot) throw Object.assign(new Error('Read-only directory'), { code: 'EACCES' });
      },
      open: async () => ({ close: async () => {} }),
      unlink: async () => {},
      realpath: async directory => directory,
    },
  };
  return { root: await script.runInNewContext(context), created };
}

const macData = '/Users/editor/Library/Application Support/YuyantaiDirector';

test('macOS assets stay outside the application bundle and survive relocation', async () => {
  for (const appDirectory of ['/Applications/Director.app', '/Volumes/Director/Director.app', '/private/var/folders/example/AppTranslocation/Director.app']) {
    const result = await initialize({ platform: 'darwin', execPath: appDirectory + '/Contents/MacOS/Director', userData: macData });
    assert.equal(result.root, macData + '/Assets');
    assert(result.created.every(directory => directory.startsWith(macData + '/Assets')));
    assert.equal(result.created.length, 5, 'Root and four asset categories must be initialized');
  }
});

test('macOS development and inherited portable settings also use user assets', async () => {
  const result = await initialize({ platform: 'darwin', execPath: '/tools/Electron.app/Contents/MacOS/Electron', userData: macData, isPackaged: false, portableDirectory: '/tmp/portable' });
  assert.equal(result.root, macData + '/Assets');
});

test('desktop self-tests never touch production asset directories', async () => {
  for (const platform of ['darwin', 'win32']) {
    const paths = platform === 'win32' ? path.win32 : path.posix;
    const testRoot = platform === 'win32' ? 'C:\\smoke-test' : '/tmp/smoke-test';
    const result = await initialize({ platform, execPath: '/application/Director', userData: macData, testRoot });
    assert.equal(result.root, paths.join(testRoot, 'Assets'));
    assert(result.created.every(directory => directory.startsWith(result.root)));
  }
});

test('Windows keeps portable, installed and read-only fallback directories', async () => {
  const options = { platform: 'win32', execPath: 'C:\\Programs\\Director\\Director.exe', userData: 'C:\\Users\\editor\\AppData\\Roaming\\YuyantaiDirector' };
  const portable = await initialize({ ...options, portableDirectory: 'D:\\Director' });
  assert.equal(portable.root, 'D:\\Director\\Assets');
  const installed = await initialize(options);
  assert.equal(installed.root, 'C:\\Programs\\Director\\Assets');
  const fallback = await initialize({ ...options, deniedRoot: installed.root });
  assert.equal(fallback.root, path.win32.join(options.userData, 'Assets'));
  assert.equal(fallback.created[0], installed.root);
});
