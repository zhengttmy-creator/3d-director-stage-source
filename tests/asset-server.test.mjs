import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {fileURLToPath} from 'node:url';
import {startDirectorServer} from '../web/server.mjs';

const webRoot = fileURLToPath(new URL('../web/', import.meta.url));
const prefix = path.join(os.tmpdir(), 'director-asset-server-test-');
const write = async (root, relative, bytes) => {
  const file = path.join(root, relative);
  await fs.mkdir(path.dirname(file), {recursive: true});
  await fs.writeFile(file, bytes);
  return file;
};
const assetUrl = relative => '/local-assets/' + relative.split('/').map(encodeURIComponent).join('/');
async function withServer(options, run) {
  const temporary = await fs.mkdtemp(prefix);
  const assetsRoot = path.join(temporary, '素材库');
  let server;
  try {
    server = await startDirectorServer({webRoot, stateDir: path.join(temporary, 'state'), assetsRoot, port: 0, ...options});
    const origin = `http://127.0.0.1:${server.address().port}`;
    const request = (route, options) => fetch(origin + route, {...options, signal: AbortSignal.timeout(10000)});
    await run({server, assetsRoot, temporary, origin, request});
  } finally {
    if (server?.listening) await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    assert(path.resolve(temporary).startsWith(path.resolve(prefix)));
    await fs.rm(temporary, {recursive: true, force: true});
  }
}

test('Asset API scans folders, refreshes catalogs and streams Chinese model sidecars with GET/HEAD', async () => withServer({}, async ({assetsRoot, origin, request}) => {
  const firstResponse = await request('/api/assets/catalog');
  assert.equal(firstResponse.status, 200);
  assert.match(firstResponse.headers.get('content-type'), /^application\/json/);
  const first = await firstResponse.json();
  assert.equal(first.root, await fs.realpath(assetsRoot));
  assert.equal(first.canOpenFolder, false);
  assert.equal(first.characters.length + first.models.length + first.motions.length + first.poses.length, 0);
  for (const group of ['characters', 'models', 'motions', 'poses']) assert((await fs.stat(first.directories[group])).isDirectory());

  const fbx = Buffer.from('FBX fixture bytes');
  const bin = Buffer.from([0, 12, 34, 56, 255]);
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==', 'base64');
  await write(assetsRoot, 'characters/演员/角色 一号.fbx', fbx);
  await write(assetsRoot, 'characters/演员/角色 一号.png', png);
  await write(assetsRoot, 'motions/行走测试.fbx', fbx);
  await write(assetsRoot, 'models/房间/场景.gltf', JSON.stringify({asset: {version: '2.0'}, buffers: [{uri: '几何 数据.bin', byteLength: bin.length}], images: [{uri: '贴图/地面 颜色.png'}]}));
  await write(assetsRoot, 'models/房间/几何 数据.bin', bin);
  await write(assetsRoot, 'models/房间/贴图/地面 颜色.png', png);
  await write(assetsRoot, 'poses/椅子坐姿.motion.json', await fs.readFile(new URL('../web/assets/poses/chair-sitting.motion.json', import.meta.url)));
  const cached = await request('/api/assets/catalog').then(response => response.json());
  assert.equal(cached.revision, first.revision, 'Cached catalog remains stable until refreshed');
  const refreshResponse = await request('/api/assets/refresh', {method: 'POST', headers: {Origin: origin}});
  assert.equal(refreshResponse.status, 200);
  const catalog = await refreshResponse.json();
  assert.notEqual(catalog.revision, first.revision);
  assert.deepEqual([catalog.characters.length, catalog.models.length, catalog.motions.length, catalog.poses.length], [1, 1, 1, 1]);
  assert.deepEqual(catalog.issues, []);
  assert.equal(catalog.characters[0].displayName, '角色 一号');
  assert.equal(catalog.poses[0].durationSec, 1);
  assert.equal(catalog.poses[0].localPosePreset, true);

  for (const [route, expected, contentType] of [
    [catalog.characters[0].mediaUrl, fbx, 'application/octet-stream'],
    [catalog.characters[0].thumbnailUrl, png, 'image/png'],
    [assetUrl('models/房间/几何 数据.bin'), bin, 'application/octet-stream'],
    [assetUrl('models/房间/贴图/地面 颜色.png'), png, 'image/png'],
  ]) {
    const get = await request(route);
    assert.equal(get.status, 200, route);
    assert.equal(get.headers.get('content-type'), contentType);
    assert.equal(get.headers.get('content-length'), String(expected.length));
    assert.equal(get.headers.get('cache-control'), 'no-store');
    assert.equal(get.headers.get('x-content-type-options'), 'nosniff');
    assert.deepEqual(Buffer.from(await get.arrayBuffer()), expected);
    const head = await request(route, {method: 'HEAD'});
    assert.equal(head.status, 200);
    assert.equal(head.headers.get('content-length'), String(expected.length));
    assert.equal((await head.arrayBuffer()).byteLength, 0);
  }
  const gltf = await request(catalog.models[0].mediaUrl);
  assert.equal(gltf.headers.get('content-type'), 'model/gltf+json');
  assert.equal((await gltf.json()).buffers[0].uri, '几何 数据.bin');
  const removed = catalog.characters[0];
  await fs.unlink(path.join(assetsRoot, removed.relativePath));
  assert.equal((await request(removed.mediaUrl)).status, 404, 'Removed assets must not be served from the catalog cache');
  assert.equal((await request(removed.mediaUrl, {method: 'HEAD'})).status, 404);
  const after = await request('/api/assets/refresh', {method: 'POST', headers: {Origin: origin}}).then(response => response.json());
  assert.equal(after.characters.length, 0);
  assert.notEqual(after.revision, catalog.revision);
  assert.equal((await request('/api/assets/open', {method: 'POST', headers: {Origin: origin}})).status, 409);
}));

test('Asset routes enforce POST origin, do not expose scripts or links, and open only the configured folder', async () => {
  let opens = 0;
  await withServer({onOpenAssets: async () => { opens++; }}, async ({assetsRoot, temporary, origin, request}) => {
    await write(assetsRoot, 'models/private.js', 'private script');
    await write(assetsRoot, 'models/.env', 'test-only configuration');
    await write(assetsRoot, 'models/settings.json', '{}');
    await write(temporary, 'outside/linked.glb', 'outside');
    await fs.symlink(path.join(temporary, 'outside'), path.join(assetsRoot, 'models', 'linked'), process.platform === 'win32' ? 'junction' : 'dir');
    for (const route of ['/api/assets/refresh', '/api/assets/open']) {
      assert.equal((await request(route, {method: 'POST'})).status, 403);
      assert.equal((await request(route, {method: 'POST', headers: {Origin: 'https://example.com'}})).status, 403);
    }
    assert.equal(opens, 0);
    const catalog = await request('/api/assets/catalog').then(response => response.json());
    assert.equal(catalog.canOpenFolder, true);
    assert.equal(catalog.models.length, 0);
    assert(catalog.issues.some(issue => issue.relativePath === 'models/linked'));
    for (const route of ['/local-assets/models/private.js', '/local-assets/models/.env', '/local-assets/models/settings.json', '/local-assets/models/linked/linked.glb', '/local-assets/models/%2e%2e%2foutside/linked.glb', '/local-assets/models/%5coutside.glb']) {
      assert.equal((await request(route)).status, 404, route);
    }
    const open = await request('/api/assets/open', {method: 'POST', headers: {Origin: origin}, body: JSON.stringify({path: path.join(temporary, 'outside')})});
    assert.equal(open.status, 200);
    assert.deepEqual(await open.json(), {ok: true});
    assert.equal(opens, 1);
    assert.equal((await request('/local-assets/models/new.glb', {method: 'PUT', headers: {Origin: origin}, body: 'not uploaded'})).status, 405);
    await assert.rejects(fs.stat(path.join(assetsRoot, 'models/new.glb')), {code: 'ENOENT'});
  });
});
