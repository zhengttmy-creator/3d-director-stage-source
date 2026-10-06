import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {createAssetLibrary} from '../web/asset-library.mjs';

const localMotionFixture = (animated = false) => JSON.stringify({
  format: 'local-director-animation-clip', version: 1,
  bones: Array.from({length: 65}, (_, index) => ({name: `bone-${index}`})),
  clip: {duration: 1, tracks: [{
    name: 'bone-0.position', type: 'vector', times: [0, 1],
    values: animated ? [0, 0, 0, 0, 0.25, 0] : [0, 0, 0, 0, 0, 0],
  }]},
});
const poseFixture = localMotionFixture();
const rootPrefix = path.join(os.tmpdir(), 'director-assets-test-');
async function fixture(run) {
  const directory = await fs.mkdtemp(rootPrefix);
  const library = createAssetLibrary({assetsRoot: path.join(directory, 'assets')});
  try { await library.initialize(); await run(library, directory, path.join(directory, 'assets')); }
  finally {
    library.close();
    assert(path.resolve(directory).startsWith(path.resolve(rootPrefix)));
    await fs.rm(directory, {recursive: true, force: true});
  }
}
const write = async (root, file, data) => { const target = path.join(root, file); await fs.mkdir(path.dirname(target), {recursive: true}); await fs.writeFile(target, data); return target; };
const exportedPose = () => ({format: 'octo-director-motion', version: 1, motion: {
  id: 'test-pose', name: 'Stored pose name', skeletonId: 'mixamo-fbx-v1', skeletonVersion: 1, durationSec: 1,
  keyframes: [0, 1].map(timeSec => ({timeSec, pose: {signature: '0:-1', rotations: [{boneIndex: 0, rotation: {x: 0, y: 0, z: 0}, bindWorldRotation: {x: 0, y: 0, z: 0, w: 1}}]}, rootTranslation: {x: 0, y: -30, z: 0}})),
}});

test('Folder catalog creates groups, scans Chinese paths, preserves IDs and supplies sidecars', async () => fixture(async (library, temporary, root) => {
  for (const group of ['characters', 'models', 'motions', 'poses']) assert((await fs.stat(path.join(root, group))).isDirectory());
  await write(root, 'characters/人物/演员 一号.FBX', 'character');
  await write(root, 'characters/人物/演员 一号.JPG', 'thumbnail');
  await write(root, 'models/家具/椅子.glb', 'glb');
  await write(root, 'models/场景/舞台.gltf', JSON.stringify({asset: {version: '2.0'}, buffers: [{uri: '舞台.bin'}]}));
  await write(root, 'models/场景/舞台.bin', 'buffer');
  await write(root, 'models/场景/贴图/颜色.png', 'texture');
  await write(root, 'motions/舞蹈.fbx', 'motion');
  await write(root, 'poses/坐姿.motion.json', poseFixture);
  await write(root, 'poses/自定义姿势.octomotion.json', JSON.stringify(exportedPose()));
  const catalog = await library.scan();
  assert.equal(catalog.root, await fs.realpath(root));
  assert.equal(catalog.characters.length, 1);
  assert.equal(catalog.models.length, 2);
  assert.equal(catalog.motions.length, 1);
  assert.equal(catalog.poses.length, 2);
  assert.deepEqual(catalog.issues, []);
  const character = catalog.characters[0];
  assert.equal(character.displayName, '演员 一号');
  assert.equal(character.folder, '人物');
  assert.equal(character.extension, '.fbx');
  assert(character.mediaUrl.includes(encodeURIComponent('演员 一号.FBX')));
  assert(character.thumbnailUrl.endsWith(encodeURIComponent('演员 一号.JPG')));
  assert.equal((await library.resolveFile(character.mediaUrl)).size, 9);
  assert.equal((await library.resolveFile(character.thumbnailUrl)).contentType, 'image/jpeg');
  assert.equal((await library.resolveFile('/local-assets/models/' + ['场景', '舞台.bin'].map(encodeURIComponent).join('/'))).contentType, 'application/octet-stream');
  assert.equal((await library.resolveFile('/local-assets/models/' + ['场景', '贴图', '颜色.png'].map(encodeURIComponent).join('/'))).contentType, 'image/png');
  assert.equal(catalog.motions[0].durationSec, undefined, 'FBX metadata must be resolved by the browser loader');
  assert(catalog.poses.every(pose => pose.localPosePreset && pose.staticPose && pose.durationSec === 1));
  assert.equal(catalog.poses.find(pose => pose.extension === '.octomotion.json').poseFormat, 'octo-director-motion');
  assert.equal(catalog.models.find(model => model.extension === '.gltf').resources['贴图/颜色.png'], '/local-assets/models/' + ['场景', '贴图', '颜色.png'].map(encodeURIComponent).join('/'));
  catalog.characters[0].displayName = 'caller mutation';
  assert.equal((await library.scan()).characters[0].displayName, '演员 一号');
  await write(root, 'characters/人物/演员 一号.FBX', 'updated character data');
  const changed = await library.scan({refresh: true});
  assert.equal(changed.characters[0].assetId, character.assetId);
  assert.notEqual(changed.revision, catalog.revision);
  assert.notEqual(changed.characters[0].revisionId, character.revisionId);
}));

test('Model resource maps keep exact subpaths, add only unique basename aliases and revise on texture changes', async () => fixture(async (library, temporary, root) => {
  await write(root, 'characters/人像/人物.fbx', 'character');
  await write(root, 'characters/人像/textures/皮肤.png', 'skin');
  await write(root, 'models/房间/scene.gltf', '{}');
  await write(root, 'models/房间/a/同名.png', 'texture a');
  await write(root, 'models/房间/b/同名.png', 'texture b');
  await write(root, 'models/房间/mesh.bin', 'geometry');
  await write(root, 'models/其他/outside.png', 'unrelated');
  await write(root, 'models/房间/script.js', 'not a resource');
  const catalog = await library.scan();
  const character = catalog.characters[0];
  assert.equal(character.resources['皮肤.png'], '/local-assets/characters/' + ['人像', 'textures', '皮肤.png'].map(encodeURIComponent).join('/'));
  assert.equal(character.resources['textures/皮肤.png'], character.resources['皮肤.png']);
  const model = catalog.models[0];
  assert.equal(model.resources['同名.png'], undefined, 'Duplicate nested texture names cannot receive a guessed basename alias');
  assert(model.resources['a/同名.png']);
  assert(model.resources['b/同名.png']);
  assert.notEqual(model.resources['a/同名.png'], model.resources['b/同名.png']);
  assert.equal(model.resources[model.resources['a/同名.png']], model.resources['a/同名.png']);
  assert(model.resources['mesh.bin']);
  assert.equal(model.resources['outside.png'], undefined);
  assert.equal(model.resources['script.js'], undefined);
  await write(root, 'models/房间/a/同名.png', 'updated texture pixels');
  const updated = await library.scan({refresh: true});
  assert.equal(updated.models[0].assetId, model.assetId);
  assert.notEqual(updated.models[0].revisionId, model.revisionId, 'Texture edits must invalidate the model revision');
}));

test('Cache, explicit refresh, invalidation and automatic expiry observe added and removed files', async () => fixture(async (library, temporary, root) => {
  const original = await library.scan();
  await write(root, 'models/new.glb', 'new');
  assert.equal((await library.scan()).models.length, 0);
  const refreshed = await library.scan({refresh: true});
  assert.equal(refreshed.models.length, 1);
  assert.notEqual(refreshed.revision, original.revision);
  const stable = await library.scan({refresh: true});
  assert.equal(stable.revision, refreshed.revision);
  await fs.unlink(path.join(root, 'models/new.glb'));
  library.invalidate();
  assert.equal((await library.scan()).models.length, 0);
  const expiring = createAssetLibrary({assetsRoot: root, cacheMs: 1});
  try {
    await expiring.scan();
    await write(root, 'models/another.glb', 'later');
    await new Promise(resolve => setTimeout(resolve, 5));
    assert.equal((await expiring.scan()).models.length, 1);
  } finally { expiring.close(); }
}));

test('Resolver denies traversal, hidden files, scripts, arbitrary JSON and linked directories', async () => fixture(async (library, temporary, root) => {
  await write(root, 'models/allowed.glb', 'model');
  await write(root, 'models/secret.js', 'secret');
  await write(root, 'models/.env', 'credential');
  await write(root, 'models/config.json', 'private');
  await write(root, 'models/.hidden/private.png', 'private image');
  await write(root, 'models/unsafe.svg', '<svg/>');
  await write(temporary, 'outside/external.glb', 'outside asset');
  await fs.symlink(path.join(temporary, 'outside'), path.join(root, 'models', 'linked'), process.platform === 'win32' ? 'junction' : 'dir');
  const bad = [
    '/other/allowed.glb', '/local-assets/models/../outside/external.glb',
    '/local-assets/models/%2e%2e/outside/external.glb', '/local-assets/models/%2Foutside.glb',
    '/local-assets/models/%5coutside.glb', '/local-assets/models/%00file.glb',
    '/local-assets/models/%zz.glb', '/local-assets/models/C%3Afile.glb',
    '/local-assets/models/secret.js', '/local-assets/models/.env', '/local-assets/models/config.json',
    '/local-assets/models/.hidden/private.png', '/local-assets/models/unsafe.svg', '/local-assets/models/linked/external.glb',
  ];
  for (const url of bad) assert.equal(await library.resolveFile(url), null, url);
  const catalog = await library.scan();
  assert.deepEqual(catalog.models.map(item => item.displayName), ['allowed']);
  assert(catalog.issues.some(issue => issue.relativePath === 'models/linked'));
  const linkedRoot = createAssetLibrary({assetsRoot: path.join(root, 'models/linked')});
  try { await assert.rejects(linkedRoot.initialize(), /real directory/); }
  finally { linkedRoot.close(); }
}));

test('Catalog rejects corrupt or animated pose JSON with readable issues', async () => fixture(async (library, temporary, root) => {
  await write(root, 'poses/broken.motion.json', '{');
  await write(root, 'poses/unrelated.motion.json', JSON.stringify({password: 'test-fixture'}));
  const moving = exportedPose();
  moving.motion.keyframes[1].rootTranslation.y = -20;
  await write(root, 'poses/moving.octomotion.json', JSON.stringify(moving));
  const badRotation = exportedPose();
  badRotation.motion.keyframes[0].pose.rotations[0].rotation.x = 'bad';
  await write(root, 'poses/invalid.octomotion.json', JSON.stringify(badRotation));
  const realMotion = localMotionFixture(true);
  await write(root, 'motions/walk.motion.json', realMotion);
  await write(root, 'poses/animated.motion.json', realMotion);
  const catalog = await library.scan();
  assert.equal(catalog.poses.length, 0);
  assert.equal(catalog.motions.length, 1);
  assert.equal(catalog.issues.length, 5);
  assert(catalog.issues.every(issue => issue.code === 'invalid-asset'));
}));

