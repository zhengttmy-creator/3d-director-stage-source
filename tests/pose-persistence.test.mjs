import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import vm from 'node:vm';
import {randomUUID} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {startDirectorServer} from '../web/server.mjs';

const draftKey = 'director-stage:motion-library:v1';
const webRoot = fileURLToPath(new URL('../web/', import.meta.url));
const portSource = await fs.readFile(new URL('../web/motion-library.js', import.meta.url), 'utf8');

function savedPose(name = 'Seated pose') {
  const pose = {
    signature: '0:-1|1:0',
    rotations: [
      {boneIndex: 0, rotation: {x: 12.5, y: -35.25, z: 87}, bindWorldRotation: {x: 0, y: Math.sin(Math.PI / 8), z: 0, w: Math.cos(Math.PI / 8)}},
      {boneIndex: 1, rotation: {x: -46.125, y: 22, z: 0.625}, bindWorldRotation: {x: Math.sin(Math.PI / 6), y: 0, z: 0, w: Math.cos(Math.PI / 6)}},
    ],
  };
  return {
    id: 'saved-pose-one', name, skeletonId: 'mixamo-fbx-v1', skeletonVersion: 1,
    durationSec: 1.75, loop: false, source: 'recorded', motionUsage: 'direct',
    locomotion: {mode: 'in-place', provenance: 'authored'},
    createdAt: '2026-09-22T01:00:00.000Z', updatedAt: '2026-09-22T01:00:00.000Z',
    keyframes: [0, 1.75].map(timeSec => ({
      timeSec, pose: structuredClone(pose), rootTranslation: {x: 0.125, y: -0.875, z: 1.625},
    })),
  };
}

function createClient(origin) {
  const faults = {putStatus: undefined};
  const requests = [];
  const context = vm.createContext({
    window: {}, structuredClone, crypto: {randomUUID}, AbortController, DOMException,
    Uint8Array, Blob, URL, setTimeout,
    fetch: async (route, options) => {
      assert.equal(route, '/api/motion-library');
      const headers = new Headers(options.headers);
      if (options.method === 'PUT') headers.set('Origin', origin());
      requests.push({method: options.method, version: headers.get('If-Match')});
      if (options.method === 'PUT' && faults.putStatus) return new Response('Injected failure', {status: faults.putStatus});
      return fetch(new URL(route, origin()), {...options, headers});
    },
  });
  vm.runInContext(portSource, context, {filename: 'motion-library.js'});
  const port = context.window.localDirectorMotionLibrary;
  return {
    port, faults, requests,
    async open() {
      const result = await port.beginAccountOperation('pose-persistence-test');
      assert.equal(result.ok, true);
      const lease = result.data;
      const draft = await port.getDraft(draftKey, lease);
      assert.equal(draft.ok, true);
      return {lease, draft: draft.data};
    },
    save(payload, lease) {
      return port.saveDraft(draftKey, 'generation', payload, undefined, lease);
    },
  };
}

async function fixture(t) {
  const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), 'director-pose-persistence-'));
  let server;
  const close = async () => {
    if (server?.listening) await new Promise(resolve => server.close(resolve));
  };
  t.after(async () => {
    await close();
    await fs.rm(stateDir, {recursive: true, force: true});
  });
  const restart = async () => {
    await close();
    server = await startDirectorServer({stateDir, webRoot, port: 0});
  };
  await restart();
  const origin = () => `http://127.0.0.1:${server.address().port}`;
  return {
    restart, client: () => createClient(origin),
    readDisk: () => fs.readFile(path.join(stateDir, 'motion-library.json'), 'utf8'),
  };
}

for (const format of ['expanded', 'version-two-envelope']) {
  test(`Saved pose ${format} survives a server restart and a new browser instance`, async t => {
    const app = await fixture(t);
    const motion = savedPose();
    const payload = format === 'expanded'
      ? {version: 1, motions: [motion]}
      : {version: 2, motions: [{encoding: 'expanded-v1', motion}]};
    const writer = app.client();
    const {lease} = await writer.open();
    const result = await writer.save(payload, lease);
    assert.equal(result.ok, true);
    assert.equal(result.data.versionId, '1');
    assert.deepEqual(JSON.parse(await app.readDisk()), {versionId: '1', payload});
    await writer.port.endAccountOperation(lease);

    await app.restart();
    const reader = app.client();
    const reopened = await reader.open();
    assert.equal(reopened.draft.versionId, '1');
    assert.deepEqual(reopened.draft.payload, payload);
    const restored = format === 'expanded' ? reopened.draft.payload.motions[0] : reopened.draft.payload.motions[0].motion;
    assert.equal(restored.keyframes.length, 2);
    assert.notEqual(restored.keyframes[0].timeSec, restored.keyframes[1].timeSec);
    assert.deepEqual(restored.keyframes[0].pose, restored.keyframes[1].pose);
    assert.deepEqual(restored.keyframes[0].rootTranslation, restored.keyframes[1].rootTranslation);
    assert.deepEqual(restored.keyframes[0].pose.rotations, motion.keyframes[0].pose.rotations);
    assert.equal(reader.requests.filter(request => request.method === 'PUT').length, 0);
    await reader.port.endAccountOperation(reopened.lease);
  });
}

test('An older window cannot overwrite a pose saved by another window', async t => {
  const app = await fixture(t);
  const first = app.client();
  const stale = app.client();
  const firstOpen = await first.open();
  const staleOpen = await stale.open();
  assert.equal(firstOpen.draft.versionId, '0');
  assert.equal(staleOpen.draft.versionId, '0');
  const accepted = {version: 1, motions: [savedPose('Accepted pose')]};
  assert.equal((await first.save(accepted, firstOpen.lease)).ok, true);
  const before = await app.readDisk();
  const rejected = {version: 1, motions: [savedPose('Stale pose')]};
  const result = await stale.save(rejected, staleOpen.lease);
  assert.equal(result.ok, false);
  assert.equal(result.error.code, 'conflict');
  assert.equal(stale.requests.find(request => request.method === 'PUT').version, '0');
  assert.equal(await app.readDisk(), before);
  assert.deepEqual(stale.port.getPendingDraft().payload, rejected);
  const observer = app.client();
  const observed = await observer.open();
  assert.deepEqual(observed.draft.payload, accepted);
  assert.equal(observed.draft.versionId, '1');
  await first.port.endAccountOperation(firstOpen.lease);
  await stale.port.endAccountOperation(staleOpen.lease);
  await observer.port.endAccountOperation(observed.lease);
});

test('A failed pose PUT preserves saved data and retains an immutable draft for retry', async t => {
  const app = await fixture(t);
  const client = app.client();
  const {lease} = await client.open();
  assert.equal((await client.save({version: 1, motions: [savedPose('Existing pose')]}, lease)).ok, true);
  const before = await app.readDisk();
  const pending = {version: 1, motions: [savedPose('Recoverable pose')]};
  const expected = structuredClone(pending);
  client.faults.putStatus = 503;
  const saving = client.save(pending, lease);
  pending.motions[0].name = 'Caller mutation';
  const result = await saving;
  assert.equal(result.ok, false);
  assert.equal(result.error.code, 'request-failed');
  assert.equal(await app.readDisk(), before);
  const recovery = client.port.getPendingDraft();
  assert.deepEqual(recovery.payload, expected);
  recovery.payload.motions[0].keyframes[0].rootTranslation.y = 999;
  assert.deepEqual(client.port.getPendingDraft().payload, expected);

  client.faults.putStatus = undefined;
  const retried = await client.save(client.port.getPendingDraft().payload, lease);
  assert.equal(retried.ok, true);
  assert.equal(retried.data.versionId, '2');
  assert.equal(client.port.getPendingDraft(), undefined);
  assert.deepEqual(JSON.parse(await app.readDisk()), {versionId: '2', payload: expected});
  const reader = app.client();
  const reopened = await reader.open();
  assert.deepEqual(reopened.draft.payload, expected);
  await reader.port.endAccountOperation(reopened.lease);
  await client.port.endAccountOperation(lease);
});
