import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { startDirectorServer } from '../web/server.mjs';

test('Local server saves documents, rejects stale writes and keeps captures outside the application', async () => {
  const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), 'director-test-'));
  const webRoot = fileURLToPath(new URL('../web/', import.meta.url));
  let server = await startDirectorServer({ stateDir, webRoot, port: 0 });
  const origin = () => `http://127.0.0.1:${server.address().port}`;
  const request = (route, options) => fetch(origin() + route, options);
  const close = () => new Promise(resolve => server.close(resolve));
  try {
    assert.equal((await request('/')).status, 200);
    assert.deepEqual(await request('/api/info').then(r => r.json()), {});
    const czSession = await request('/api/cz/session').then(r => r.json());
    assert.equal(typeof czSession.configured, 'boolean');
    assert.equal(czSession.baseUrl, 'https://czqihui.itheima.net');
    const save = version => request('/api/document', { method: 'PUT', headers: { Origin: origin(), 'If-Match': version }, body: JSON.stringify({ title: 'test' }) });
    assert.equal((await save('0')).status, 200);
    assert.equal((await save('0')).status, 409);
    assert.equal((await request('/api/document', { method: 'PUT', body: '{}' })).status, 403);
    assert.equal((await request('/server.mjs')).status, 404);
    const image = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==', 'base64');
    const capture = await request('/api/captures', { method: 'POST', headers: { Origin: origin(), 'Content-Type': 'image/png', 'X-Capture-Width': '1', 'X-Capture-Height': '1' }, body: image }).then(r => r.json());
    assert.equal((await request(capture.mediaUrl)).status, 200);
    const video = Buffer.concat([
      Buffer.from([0, 0, 0, 24]),
      Buffer.from('ftypisom', 'ascii'),
      Buffer.alloc(32),
    ]);
    const exportedVideo = await request('/api/videos', { method: 'POST', headers: { Origin: origin(), 'Content-Type': 'video/mp4', 'X-Video-Name': 'test.mp4', 'X-Video-Width': '1920', 'X-Video-Height': '1080' }, body: video }).then(r => r.json());
    assert.equal(exportedVideo.extension, '.mp4');
    assert.equal((await request(exportedVideo.mediaUrl)).status, 200);
    await close();
    server = await startDirectorServer({ stateDir, webRoot, port: 0 });
    assert.deepEqual(await request('/api/document').then(r => r.json()), { title: 'test' });
    assert.deepEqual(Buffer.from(await request(capture.mediaUrl).then(r => r.arrayBuffer())), image);
    assert.deepEqual(Buffer.from(await request(exportedVideo.mediaUrl).then(r => r.arrayBuffer())), video);
  } finally {
    await close();
    await fs.rm(stateDir, { recursive: true, force: true });
  }
});

test('Background deletion persists without removing referenced media, and can be restored', async () => {
  const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), 'director-background-test-'));
  const webRoot = fileURLToPath(new URL('../web/', import.meta.url));
  let server = await startDirectorServer({ stateDir, webRoot, port: 0 });
  const origin = () => `http://127.0.0.1:${server.address().port}`;
  const request = (route, options) => fetch(origin() + route, options);
  const close = () => new Promise(resolve => server.close(resolve));
  const restart = async () => { await close(); server = await startDirectorServer({ stateDir, webRoot, port: 0 }); };
  const patch = (assetId, payload) => request(`/api/captures/${assetId}/background`, {
    method: 'PATCH', headers: { Origin: origin(), 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
  });
  try {
    const image = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==', 'base64');
    const capture = await request('/api/captures', { method: 'POST', headers: { Origin: origin(), 'Content-Type': 'image/png', 'X-Capture-Width': '1', 'X-Capture-Height': '1' }, body: image }).then(r => r.json());
    assert.equal((await request(`/api/captures/${capture.assetId}/background`, { method: 'PATCH', body: '{"deleted":true}' })).status, 403);
    assert.equal((await patch('invalid-id', { deleted: true })).status, 400);
    assert.equal((await patch('00000000-0000-4000-8000-000000000000', { deleted: true })).status, 404);
    for (const payload of [null, {}, { deleted: 'true' }, { deleted: 1 }]) assert.equal((await patch(capture.assetId, payload)).status, 400);
    const removed = await patch(capture.assetId, { deleted: true });
    assert.equal(removed.status, 200);
    assert.deepEqual(await removed.json(), { ...capture, backgroundDeleted: true });
    await restart();
    const entries = await request('/api/captures').then(r => r.json());
    assert.deepEqual(entries.items, [{ ...capture, backgroundDeleted: true }]);
    assert.deepEqual(Buffer.from(await request(capture.mediaUrl).then(r => r.arrayBuffer())), image);
    const updates = await Promise.all(Array.from({ length: 8 }, (_, i) => patch(capture.assetId, { deleted: i % 2 === 0 })));
    assert.ok(updates.every(response => response.status === 200));
    assert.equal((await request('/api/captures').then(r => r.json())).items.length, 1);
    assert.deepEqual(await patch(capture.assetId, { deleted: false }).then(r => r.json()), { ...capture, backgroundDeleted: false });
    await restart();
    assert.deepEqual((await request('/api/captures').then(r => r.json())).items, [{ ...capture, backgroundDeleted: false }]);
    assert.deepEqual(Buffer.from(await request(capture.mediaUrl).then(r => r.arrayBuffer())), image);
  } finally {
    await close();
    await fs.rm(stateDir, { recursive: true, force: true });
  }
});
