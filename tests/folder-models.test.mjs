import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import {randomUUID} from 'node:crypto';
import {createRequire} from 'node:module';
import * as THREE from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {clone as cloneSkeleton} from 'three/addons/utils/SkeletonUtils.js';
import {loadSource, targetModelFile} from '../src/motions/motion-source-utils.mjs';

const require = createRequire(import.meta.url);
const parser = require('@babel/parser');
const traverse = require('@babel/traverse').default;
const factories = JSON.parse(await fs.readFile(new URL('../src/vendor/module-factories.json', import.meta.url), 'utf8'));
factories['53401'] = require('../src/patches/motion-loader.cjs').patchMotionLoader(factories['53401']);
for (const name of ['patch-local-motion-library', 'motion-previews', 'pose-library', 'folder-models']) require('../src/patches/' + name + '.cjs')(factories);
new vm.Script('(' + factories['53401'] + ')');
new vm.Script('(' + factories['51687'] + ')');
const source = factories['53401'];
const declarations = new Map();
const expressions = [];
const arrows = [];
traverse(parser.parse('(' + source + ')'), {
  FunctionDeclaration(node) { declarations.set(node.node.id.name, source.slice(node.node.start - 1, node.node.end - 1)); },
  FunctionExpression(node) { expressions.push(source.slice(node.node.start - 1, node.node.end - 1)); },
  ArrowFunctionExpression(node) { arrows.push(source.slice(node.node.start - 1, node.node.end - 1)); },
});
const plain = value => JSON.parse(JSON.stringify(value));
const context = vm.createContext({
  crypto: {randomUUID}, structuredClone, Date, URL, AbortController, DOMException,
  th: 'mixamo-fbx-v1', tv: new Set(['workrally-mixamo-fbx-v1', 'octo-mixamo-v1']),
  pE: {mode: 'embedded'}, pO: {mode: 'in-place', provenance: 'authored'},
  ap: 'path-traversal', am: 'direct', ag: {}, af: {}, lV: Array.from({length: 65}),
  bM: Math.PI / 180, iv: () => '#aabbcc', window: {location: new URL('http://127.0.0.1:4207/')},
  so: {KPJ: THREE.LoadingManager, cj9: THREE.MathUtils, PTz: THREE.Quaternion, O9p: THREE.Euler},
});
for (const name of ['__localCatalogModelKind', '__localIsFolderProp', '__localCreateCatalogModel', '__localLoadFolderPose', '__localIsPoseCatalog', '__localResolveModelResource', '__localSampleCatalogMotion',
  'g7', 'g6', 'fe', 'fn', 'fo', 'fs', 'tb', 'ah', 'av', 'pU', 'kN', 'iY', 'iQ', 'x$', 'xZ', 'AU', 'le', 's6', 'lr', 'la', 'r0', 'r_', 'r1', 'r2', 'rq', 'rJ', 'ao', 'as']) vm.runInContext(declarations.get(name), context);
const smallest = term => expressions.filter(code => code.includes(term)).sort((a, b) => a.length - b.length)[0];
const objectFunction = term => expressions.filter(code => code.includes(term) && code.includes('placementAnchor')).sort((a, b) => a.length - b.length)[0];
vm.runInContext('this.encodeObject=' + objectFunction('unstable-resource-reference') + ';this.decodeObject=' + objectFunction('resource-unavailable') + ';', context);
vm.runInContext('this.normalizeAsset=' + smallest('Object.entries(e.resources)') + ';', context);
const encodedGltf = {
  asset: {version: '2.0'}, scene: 0, scenes: [{nodes: [0]}], nodes: [{mesh: 0}],
  meshes: [{primitives: [{attributes: {POSITION: 0}, material: 0}]}],
  materials: [{pbrMetallicRoughness: {baseColorFactor: [0.15, 0.75, 0.3, 1]}}],
  buffers: [{byteLength: 36}], bufferViews: [{buffer: 0, byteLength: 36}],
  accessors: [{bufferView: 0, componentType: 5126, count: 3, type: 'VEC3', min: [0, 0, 0], max: [2, 3, 0]}],
};
const bin = Buffer.from(new Float32Array([0, 0, 0, 2, 0, 0, 0, 3, 0]).buffer);
const jsonText = JSON.stringify(encodedGltf);
const json = Buffer.from(jsonText.padEnd(Math.ceil(jsonText.length / 4) * 4, ' '));
const glb = Buffer.alloc(12 + 8 + json.length + 8 + bin.length);
glb.writeUInt32LE(0x46546c67, 0); glb.writeUInt32LE(2, 4); glb.writeUInt32LE(glb.length, 8);
glb.writeUInt32LE(json.length, 12); glb.writeUInt32LE(0x4e4f534a, 16); json.copy(glb, 20);
glb.writeUInt32LE(bin.length, 20 + json.length); glb.writeUInt32LE(0x004e4942, 24 + json.length); bin.copy(glb, 28 + json.length);
const loaded = await new GLTFLoader().parseAsync(glb.buffer.slice(glb.byteOffset, glb.byteOffset + glb.byteLength), '');
let mesh;
loaded.scene.traverse(node => {if (node.isMesh) mesh = node;});
assert.equal(mesh.geometry.attributes.position.count, 3);
assert.equal(mesh.material.color.g, 0.75);
const textureUrl = 'http://127.0.0.1:4207/assets/folders/a/texture%20name.png';
const loadRequests = [];
context.pD = {w: class {constructor(manager) {this.manager = manager;} async loadAsync(url) {loadRequests.push(['fbx', url, this.manager.resolveURL('C:/old/texture%20name.png')]);return loadSource(targetModelFile);}}};
context.vg = {B: class {constructor(manager) {this.manager = manager;} async loadAsync(url) {loadRequests.push(['gltf', url, this.manager.resolveURL('old/texture%20name.png')]);return loaded;}}};
for (const extension of ['.fbx', '.glb', '.gltf']) {
  const entry = {assetId: 'folder-models-test-' + extension.slice(1), displayName: 'Test model', localAssetKind: 'model'};
  const resource = {assetId: entry.assetId, revisionId: 'revision-1', extension,
    mediaUrl: 'http://127.0.0.1:4207/assets/folders/test' + extension, resources: {'texture name.png': textureUrl}};
  const object = context.__localCreateCatalogModel(entry, resource);
  assert.equal(object.color, undefined, 'Imported prop materials retain original colors');
  assert.equal(object.placementAnchor, 'bottom-center-v1');
  assert.deepEqual(plain(context.normalizeAsset(object.asset)), resource.provider ? resource : {...resource, provider: 'catalog'});
  object.transform = {position: {x: 2, y: 3, z: -4}, rotation: {x: 35, y: -47, z: 125}, scale: {x: 2, y: 3, z: 0.5}};
  const state = {loaderCache: new Map(), propsRef: {current: {}}};
  const asset = await context.xZ(state, object, resource.mediaUrl);
  assert.equal(asset.format, extension === '.fbx' ? 'fbx' : 'gltf');
  assert.ok(asset.scene.children.length > 0);
  const root = new THREE.Group(); root.add(asset.scene.clone());
  context.x$({root}, object);
  assert.deepEqual(root.position.toArray(), [2, 3, -4]);
  assert.deepEqual(root.scale.toArray(), [2, 3, 0.5]);
  assert.ok(Math.abs(root.rotation.z - 125 * Math.PI / 180) < 1e-12);
  const encoded = context.encodeObject(object);
  assert.equal(encoded.ok, true);
  assert.equal(encoded.object.resource.provider, 'catalog');
  const decoded = context.decodeObject(plain(encoded.object), ref => ref.resourceId === entry.assetId ? {mediaUrl: resource.mediaUrl, resources: resource.resources} : undefined);
  assert.equal(decoded.ok, true);
  assert.deepEqual(plain(decoded.object.transform), object.transform);
  assert.deepEqual(plain(decoded.object.asset.resources), resource.resources);
  assert.equal(decoded.object.asset.extension, extension);
  assert.equal(decoded.object.asset.revisionId, resource.revisionId);
  assert.equal(decoded.object.placementAnchor, 'bottom-center-v1');
  assert.equal(context.decodeObject(encoded.object, () => undefined).reason, 'resource-unavailable');
}
assert.deepEqual(loadRequests.map(request => request[0]), ['fbx', 'gltf', 'gltf']);
assert.ok(loadRequests.every(request => request[2] === textureUrl), 'Both FBX and GLTF resolve sidecar resources');
Object.assign(context.so, {eaF: THREE.Mesh, I46: THREE.SkinnedMesh, $Kf: THREE.Bone});
Object.assign(context, {
  vf: {o8: cloneSkeleton}, AE: () => 'bottom-center-v1', vi: () => {}, lJ: () => undefined,
  lq: value => value.toLowerCase(), l0: () => [], AL: () => 'test-asset', xV: value => value,
  vB: ({content}) => {const root = new THREE.Group();root.add(content);return {userRoot: root, importFrame: content, anchorFrame: root, assetLocalBounds: new THREE.Box3().setFromObject(content), anchorOffset: new THREE.Vector3()};},
});
vm.runInContext(declarations.get('x_'), context);
const skinnedProp = context.__localCreateCatalogModel({assetId: 'folder-models-skinned', displayName: 'Skinned prop', localAssetKind: 'model'},
  {assetId: 'folder-models-skinned', extension: '.fbx', mediaUrl: '/assets/skinned.fbx'});
const skinnedRuntime = context.x_(skinnedProp, {format: 'fbx', scene: await loadSource(targetModelFile)});
assert.ok(skinnedRuntime.skinnedMeshes.length > 0, 'Static folder props retain real skinned render meshes');
assert.equal(skinnedRuntime.bones.length, 0, 'Static folder props must not become character authoring rigs');
assert.equal(skinnedRuntime.jointHandles.length, 0);
assert.equal(skinnedRuntime.standardMixamoRig, false);
assert.equal(skinnedRuntime.motionBindReference, undefined);
assert.ok(skinnedRuntime.materials.length > 0);
assert.equal(context.__localIsFolderProp(skinnedProp), true);
const conflictingTextures = {'textures/shared.png': '/textures/first.png', 'other/shared.png': '/textures/second.png'};
assert.equal(context.__localResolveModelResource('C:\\old\\textures\\shared.png', conflictingTextures), '/textures/first.png');
assert.equal(context.__localResolveModelResource('C:\\old\\unknown\\shared.png', conflictingTextures), 'C:\\old\\unknown\\shared.png', 'Ambiguous basenames must not pick an arbitrary texture');
assert.equal(context.__localResolveModelResource('texture%20name.png', {'texture name.png': textureUrl}), textureUrl);
const characterEntry = {assetId: 'folder-characters-test', displayName: 'Mixamo', localAssetKind: 'character'};
const character = context.__localCreateCatalogModel(characterEntry, {...characterEntry, extension: '.fbx', mediaUrl: '/assets/test.fbx'});
assert.equal(character.color, '#aabbcc');
assert.ok(character.id.startsWith('character-'));
assert.throws(() => context.__localCreateCatalogModel(characterEntry, {...characterEntry, extension: '.glb', mediaUrl: '/assets/test.glb'}), /Mixamo FBX/);
assert.throws(() => context.__localCreateCatalogModel(characterEntry, {...characterEntry, assetId: 'mismatch', extension: '.fbx', mediaUrl: '/assets/test.fbx'}));
const poseMotion = {id: 'pose-old', name: 'Crouch', skeletonId: 'mixamo-fbx-v1', skeletonVersion: 1,
  source: 'recorded', durationSec: 1, loop: false, transferMode: 'direct-local',
  keyframes: [0, 1].map(timeSec => ({timeSec, rootTranslation: {x: 1, y: -38, z: 2}, pose: {signature: '0:-1',
    rotations: [{boneIndex: 0, rotation: {x: 20, y: 45, z: 9}, bindWorldRotation: {x: 0, y: 0, z: 0, w: 1}}]}})),
  createdAt: '2026-09-22T00:00:00Z', updatedAt: '2026-09-22T00:00:00Z'};
let payload = {format: 'octo-director-motion', version: 1, motion: poseMotion};
context.fetch = async (_url, options) => {assert.equal(options.credentials, 'omit');return {ok: true, json: async () => payload};};
const poseResource = {assetId: 'folder-poses-crouch', extension: '.octomotion.json', mediaUrl: '/assets/crouch.octomotion.json'};
const motion = await context.__localLoadFolderPose(poseResource, {assetId: poseResource.assetId, displayName: 'Folder crouch'});
assert.equal(motion.id, poseResource.assetId);
assert.equal(motion.assetPath, undefined, 'Native pose keyframes must not be parsed as FBX');
assert.equal(motion.transferMode, 'direct-local');
assert.deepEqual(plain(motion.keyframes), poseMotion.keyframes);
assert.equal(context.__localIsPoseCatalog({assetId: poseResource.assetId}), true);
assert.equal(motion.fps, 30, 'Catalog static pose application requires a valid frame rate');
const timelineClip = {id: 'clip-folder-pose', objectId: 'character-test', motionId: motion.id, source: 'catalog',
  startTimeSec: 0, offsetTimeSec: 0, durationSec: 4, staticPoseTimeSec: 0, speed: 1, loop: false, locomotionMode: 'in-place', motionUsage: 'direct', createdAt: poseMotion.createdAt};
const sampled = context.le(timelineClip, 30, 30, new Map(), {catalogMotions: new Map([[motion.id, motion]])});
assert.equal(sampled.kind, undefined, 'Native JSON poses must not request a nonexistent assetPath');
assert.deepEqual(plain(sampled.rootTranslation), poseMotion.keyframes[0].rootTranslation);
assert.deepEqual(plain(sampled.rotations), poseMotion.keyframes[0].pose.rotations);
assert.equal(sampled.transferMode, 'direct-local');
const clipArrow = term => arrows.filter(code => code.includes(term)).sort((a, b) => a.length - b.length)[0];
context.o = 30; context.d = 30;
vm.runInContext('this.encodeClip=' + clipArrow('staticPoseFrame:r_') + ';this.decodeClip=' + clipArrow('void 0===e.staticPoseFrame?a:') + ';', context);
const persistedClip = JSON.stringify(context.encodeClip(timelineClip));
assert.equal(JSON.parse(persistedClip).motion.provider, 'catalog');
assert.equal(JSON.parse(persistedClip).motion.resourceId, motion.id);
const restoredClip = context.decodeClip(JSON.parse(persistedClip));
assert.equal(restoredClip.source, 'catalog');
assert.equal(restoredClip.staticPoseTimeSec, 0);
payload = JSON.parse(JSON.stringify(payload));
const restoredMotion = await context.__localLoadFolderPose(poseResource, {assetId: poseResource.assetId, displayName: 'Folder crouch'});
const restoredSample = context.le(restoredClip, 75, 30, new Map(), {catalogMotions: new Map([[restoredMotion.id, restoredMotion]])});
assert.deepEqual(plain(restoredSample), plain(sampled), 'Catalog references must sample the same native pose after persistence and a fresh resolve');
const fbxSample = context.__localSampleCatalogMotion({id: 'fbx-motion', assetPath: '/assets/walk.fbx', durationSec: 2}, 3, true, 'in-place', {sourceTimeSec: 3, offsetTimeSec: 0});
assert.equal(fbxSample.kind, 'asset');
assert.equal(fbxSample.assetPath, '/assets/walk.fbx');
assert.equal(fbxSample.localTimeSec, 1);
assert.deepEqual(plain(fbxSample.pathTraversal), {sourceTimeSec: 3, offsetTimeSec: 0});
payload = {...payload, motion: {...poseMotion, skeletonId: 'unsupported'}};
await assert.rejects(context.__localLoadFolderPose(poseResource), /Mixamo/);
payload = {...payload, format: 'unknown'};
await assert.rejects(context.__localLoadFolderPose(poseResource), /JSON/);
await assert.rejects(context.__localLoadFolderPose({...poseResource, mediaUrl: 'https://example.com/test.json'}));
const abort = new AbortController(); abort.abort();
await assert.rejects(context.__localLoadFolderPose(poseResource, undefined, abort.signal), error => error.name === 'AbortError');
console.log('Folder model tests passed: FBX/GLB/GLTF scene loads, material/XYZ transforms, project round-trip, texture mapping, Mixamo validation, native pose JSON and abort/error paths.');
