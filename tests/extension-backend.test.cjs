const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const root = path.resolve(__dirname, '..');

async function browserChecks() {
  let checks = 0;
  const check = (condition, label) => { if (!condition) throw new Error(label); checks++; };
  await localDirectorExtension.ready;
  const get = (url, options) => fetch(url, options);
  const put = (url, content, version, writeId) => get(url, {
    method: 'PUT', headers: { 'If-Match': version, ...(writeId ? { 'X-Write-Id': writeId } : {}) }, body: JSON.stringify(content),
  });
  check(!(await (await get('/api/info')).json()).versionId, 'fresh database must have no project');
  check((await get('/api/document')).status === 404, 'fresh project must be absent');
  const written = await (await put('/api/document', { scene: 'first' }, '0', 'write-one')).json();
  check(written.versionId === '1', 'first project version');
  check((await (await put('/api/document', { scene: 'ignored duplicate' }, '0', 'write-one')).json()).versionId === '1', 'write-id retry must be idempotent');
  check((await put('/api/document', {}, '0', 'conflicting')).status === 409, 'stale project version must conflict');
  check((await (await get('/api/document?version=1')).json()).scene === 'first', 'duplicate and conflict must preserve saved project');
  const concurrent = await Promise.all([put('/api/document', { scene: 'a' }, '1', 'a'), put('/api/document', { scene: 'b' }, '1', 'b')]);
  check(concurrent.map(response => response.status).sort().join(',') === '200,409', 'concurrent writes must use atomic CAS');
  const motion = { version: 1, motions: [{ id: 'saved-pose' }] };
  check((await put('/api/motion-library', motion, '0')).status === 200, 'save motion library');
  check((await put('/api/motion-library', motion, '0')).status === 409, 'motion CAS must conflict');
  check((await put('/api/motion-library', { version: 1, motions: 'wrong' }, '1')).status === 400, 'invalid motion library rejected');
  check((await (await get('/api/cz/session')).json()).connected === false, 'extension cloud disconnected');
  check((await get('/api/cz/session', { method: 'POST', body: '{}' })).status === 501, 'extension must not send cloud credentials');
  const makeFile = (relative, data, type = 'application/octet-stream') => {
    const file = new File([data], relative.split('/').at(-1), { type });
    Object.defineProperty(file, 'webkitRelativePath', { value: relative });
    return file;
  };
  const png = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 0]);
  const imported = await localDirectorExtension.importAssetFiles([
    makeFile('Assets/models/Room/room.gltf', '{"asset":{"version":"2.0"}}'),
    makeFile('Assets/models/Room/textures/diffuse.png', png, 'image/png'),
    makeFile('Assets/models/Room/room.bin', new Uint8Array([1, 2, 3])),
    makeFile('Assets/models/Room/room.png', png, 'image/png'),
    makeFile('Assets/characters/actor.fbx', new Uint8Array([1, 2, 3])),
  ]);
  check(imported.imported === 5, 'folder import count');
  const catalog = await (await get('/api/assets/catalog')).json();
  check(catalog.models.length === 1 && catalog.characters.length === 1, 'catalog groups');
  const model = catalog.models[0];
  check(model.resources['textures/diffuse.png'] === '/local-assets/models/Room/textures/diffuse.png', 'nested texture mapping retained');
  check(model.resources['diffuse.png'] === '/local-assets/models/Room/textures/diffuse.png', 'unambiguous texture basename retained');
  check(model.resources['room.bin'] === '/local-assets/models/Room/room.bin', 'GLTF buffer mapping');
  check(model.thumbnailUrl.startsWith('blob:'), 'thumbnail has renderable blob URL');
  check((await (await get(model.mediaUrl)).json()).asset.version === '2.0', 'model fetch through local API');
  const textureUrl = localDirectorExtension.resolveAssetUrl(model.resources['textures/diffuse.png']);
  check(textureUrl.startsWith('blob:') && (await get(textureUrl)).status === 200, 'texture resolves to loaded blob');
  let rejected = false;
  try { await localDirectorExtension.importAssetFiles([makeFile('Assets/models/../bad.glb', new Uint8Array([1]))]); } catch { rejected = true; }
  check(rejected, 'path traversal must be rejected');
  const captureResponse = await get('/api/captures', { method: 'POST', headers: { 'Content-Type': 'image/png', 'X-Capture-Width': '1', 'X-Capture-Height': '1', 'X-Capture-Name': 'capture.png' }, body: png });
  check(captureResponse.status === 200, 'capture saved');
  const capture = await captureResponse.json();
  check(capture.mediaUrl.startsWith('blob:') && localDirectorExtension.ownsMediaUrl(capture.mediaUrl), 'capture URL ownership');
  check(!localDirectorExtension.ownsMediaUrl('blob:https://example.test/unowned'), 'foreign media URL rejected');
  const backgroundState = (assetId, value) => get('/api/captures/' + assetId + '/background', {
    method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(value),
  });
  check((await backgroundState('invalid-id', { deleted: true })).status === 400, 'background deletion rejects invalid ID');
  check((await backgroundState('00000000-0000-4000-8000-000000000000', { deleted: true })).status === 404, 'background deletion rejects absent capture');
  check((await backgroundState(capture.assetId, { deleted: 'true' })).status === 400, 'background deletion requires a boolean');
  check((await backgroundState(capture.assetId, null)).status === 400, 'background deletion rejects missing payload');
  const deletedCapture = await (await backgroundState(capture.assetId, { deleted: true })).json();
  check(deletedCapture.backgroundDeleted === true && deletedCapture.mediaUrl === capture.mediaUrl && deletedCapture.revisionId === capture.revisionId, 'deletion preserves capture identity and blob URL');
  check(localDirectorExtension.ownsMediaUrl(capture.mediaUrl) && [...new Uint8Array(await (await get(capture.mediaUrl)).arrayBuffer())].join(',') === [...png].join(','), 'deleted background remains readable by existing scenes');
  check((await (await get('/api/captures')).json()).items[0].backgroundDeleted === true, 'deleted background remains resolvable in catalog');
  check((await (await backgroundState(capture.assetId, { deleted: false })).json()).backgroundDeleted === false, 'background can be restored');
  check((await (await backgroundState(capture.assetId, { deleted: true })).json()).backgroundDeleted === true, 'background can be removed again');
  const video = new Uint8Array([0, 0, 0, 16, 102, 116, 121, 112, 109, 112, 52, 50]);
  check((await get('/api/videos', { method: 'POST', headers: { 'Content-Type': 'video/mp4', 'X-Video-Name': 'video.mp4' }, body: video })).status === 200, 'video saved');
  check((await get('/api/videos', { method: 'POST', headers: { 'Content-Type': 'video/mp4' }, body: 'bad data' })).status === 400, 'invalid video rejected');
  const abort = new AbortController(); abort.abort();
  rejected = false;
  try { await get('/api/info', { signal: abort.signal }); } catch (error) { rejected = error.name === 'AbortError'; }
  check(rejected, 'aborted reads rejected');
  const backup = await localDirectorExtension.exportBackup();
  const payload = JSON.parse(await backup.text());
  check(payload.files.length === 5 && payload.media.length === 2 && payload.motionLibrary.payload.motions[0].id === 'saved-pose', 'complete backup');
  check(payload.media.find(item => item.kind === 'captures').descriptor.backgroundDeleted === true, 'backup retains background library membership');
  const invalid = structuredClone(payload); invalid.files[0].path = '../bad.fbx';
  rejected = false;
  try { await localDirectorExtension.importBackup(new Blob([JSON.stringify(invalid)])); } catch { rejected = true; }
  check(rejected, 'invalid backup rejected before write');
  check((await (await get('/api/assets/catalog')).json()).models[0].assetId === model.assetId, 'invalid restore must preserve assets');
  await localDirectorExtension.importAssetFiles([new File([new Uint8Array([7])], 'extra.glb')], { group: 'models' });
  check((await (await get('/api/assets/catalog')).json()).models.length === 2, 'plain file import into chosen group');
  await localDirectorExtension.importBackup(backup);
  check((await (await get('/api/assets/catalog')).json()).models.length === 1, 'restore atomically replaces imported files');
  check((await (await get('/api/captures')).json()).items.length === 1, 'restore capture index');
  check((await (await get('/api/captures')).json()).items[0].backgroundDeleted === true, 'restore retains background deletion flag');
  check((await (await get('/api/videos')).json()).items.length === 1, 'restore video index');
  check((await put('/api/document', {}, '2', 'stale-after-restore')).status === 409, 'restore invalidates old project versions');
  return { modelId: model.assetId, captureId: capture.assetId, checks };
}

async function runElectron() {
  const { app, BrowserWindow } = require('electron');
  const http = require('node:http');
  const temporary = path.join(root, 'work', 'extension-backend-test-' + process.pid);
  await fs.mkdir(temporary, { recursive: true });
  app.setPath('userData', temporary);
  app.disableHardwareAcceleration();
  let server, window;
  try {
    await app.whenReady();
    const backend = await fs.readFile(path.join(root, 'extension/browser-backend.js'));
    server = http.createServer((request, response) => {
      if (request.url === '/browser-backend.js') { response.setHeader('Content-Type', 'text/javascript'); response.end(backend); }
      else { response.setHeader('Content-Type', 'text/html'); response.end('<!doctype html><title>Backend test</title><script src="/browser-backend.js"></script>'); }
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    window = new BrowserWindow({ show: false, webPreferences: { contextIsolation: true, sandbox: true, nodeIntegration: false } });
    await window.loadURL('http://127.0.0.1:' + server.address().port + '/');
    const result = await window.webContents.executeJavaScript('(' + browserChecks.toString() + ')()');
    await window.loadURL('http://127.0.0.1:' + server.address().port + '/');
    const restored = await window.webContents.executeJavaScript(`(async () => {
      await localDirectorExtension.ready;
      const catalog = await (await fetch('/api/assets/catalog')).json();
      const capture = (await (await fetch('/api/captures')).json()).items[0];
      const response = await fetch('/api/captures/' + capture.assetId + '/background', {method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({deleted:false})});
      return {modelId:catalog.models[0].assetId,captureId:capture.assetId,readable:(await fetch(capture.mediaUrl)).ok,owned:localDirectorExtension.ownsMediaUrl(capture.mediaUrl),deleted:capture.backgroundDeleted,restored:(await response.json()).backgroundDeleted};
    })()`);
    assert.deepEqual(restored, { modelId: result.modelId, captureId: result.captureId, readable: true, owned: true, deleted: true, restored: false });
    await window.loadURL('http://127.0.0.1:' + server.address().port + '/');
    assert.equal(await window.webContents.executeJavaScript(`(async () => { await localDirectorExtension.ready; return (await (await fetch('/api/captures')).json()).items[0].backgroundDeleted; })()`), false);
    console.log('Extension backend: ' + result.checks + ' persistence, CAS, asset, media, backup checks passed; reload persistence passed.');
    window.destroy();
    await new Promise(resolve => server.close(resolve));
    app.exit(0);
  } catch (error) {
    console.error(error);
    window?.destroy();
    server?.close();
    app.exit(1);
  }
}

if (process.versions.electron) runElectron();
else {
  const { spawn } = require('node:child_process');
  const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
  const child = spawn(require('electron'), [__filename], { env, windowsHide: true, stdio: 'inherit' });
  child.on('error', error => { console.error(error); process.exitCode = 1; });
  child.on('exit', code => { process.exitCode = code || 0; });
}
