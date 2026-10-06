import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import vm from 'node:vm';
import {randomUUID} from 'node:crypto';
import {createRequire} from 'node:module';
import {clone as cloneSkeleton} from 'three/addons/utils/SkeletonUtils.js';
import {THREE, loadSource, repositoryRoot} from '../src/motions/motion-source-utils.mjs';
import {originalRetargetClasses, validateOriginalRetarget, makeMotionRig} from '../src/motions/original-retarget-utils.mjs';

const require = createRequire(import.meta.url);
const parser = require('@babel/parser');
const traverse = require('@babel/traverse').default;
const factories = JSON.parse(await fs.readFile(new URL('../src/vendor/module-factories.json', import.meta.url), 'utf8'));
factories['53401'] = require('../src/patches/motion-loader.cjs').patchMotionLoader(factories['53401']);
for (const name of ['patch-local-motion-library', 'motion-previews', 'pose-library', 'folder-models', 'body-presets']) {
  require('../src/patches/' + name + '.cjs')(factories);
}
const source = factories['53401'];
new vm.Script('(' + source + ')');
const declarations = new Map();
const expressions = [];
traverse(parser.parse('(' + source + ')'), {
  FunctionDeclaration(p) {declarations.set(p.node.id.name, source.slice(p.node.start - 1, p.node.end - 1));},
  FunctionExpression(p) {expressions.push(source.slice(p.node.start - 1, p.node.end - 1));},
});
const readJson = async relative => JSON.parse(await fs.readFile(path.join(repositoryRoot, relative), 'utf8'));
const manifest = await readJson('web/assets/characters/manifest.json');
const walk = await readJson('web/assets/motions/walk.motion.json');
const crouch = await readJson('web/assets/poses/crouching.motion.json');
const sit = await readJson('web/assets/poses/sitting.motion.json');
const hierarchy = walk.bones.map(bone => ({name: bone.name,
  ...(bone.parentIndex < 0 ? {} : {parentName: walk.bones[bone.parentIndex].name})}));
const classes = originalRetargetClasses(factories, hierarchy);
const aliases = {
  YJl: THREE.Group, $Kf: THREE.Bone, eaF: THREE.Mesh, I46: THREE.SkinnedMesh,
  Pq0: THREE.Vector3, PTz: THREE.Quaternion, O9p: THREE.Euler, NRn: THREE.Box3,
  _xc: THREE.SkeletonHelper, Q1f: THREE.Color, Gu$: THREE.SphereGeometry, V9B: THREE.MeshBasicMaterial,
};
const context = vm.createContext({
  crypto: {randomUUID}, structuredClone, Date, so: aliases, vf: {o8: cloneSkeleton},
  vb: classes.BindReference, lV: hierarchy, lQ: new Set([7, 31]), ay: {x: 0, y: 0, z: 0},
  iv: () => '#aabbcc', vi: () => {}, bX: () => {}, lY: () => [],
  th: 'mixamo-fbx-v1', tv: new Set(['workrally-mixamo-fbx-v1', 'octo-mixamo-v1']),
  pE: {mode: 'embedded'}, pO: {mode: 'in-place', provenance: 'authored'},
  ap: 'path-traversal', am: 'direct', ag: {}, af: {},
});
for (const name of ['__localIsBodyPresetAsset', '__localCatalogModelKind', '__localIsFolderProp', '__localCreateCatalogModel',
  'lJ', 'lq', 'l0', 'l_', 'l$', 'x_', 'xV', 'vB', 'ak', 'aw', 'AE', 'aA', 'AL',
  'fe', 'fn', 'fo', 'fs', 'tb', 'ah', 'av', 'pU', 'kN', 'iY', 'iQ']) {
  assert.ok(declarations.has(name), 'Runtime declaration exists: ' + name);
  vm.runInContext(declarations.get(name), context);
}
const objectFunction = term => expressions.filter(code => code.includes(term) && code.includes('placementAnchor')).sort((a, b) => a.length - b.length)[0];
vm.runInContext('this.encodeObject=' + objectFunction('unstable-resource-reference')
  + ';this.decodeObject=' + objectFunction('resource-unavailable') + ';', context);
const plain = value => JSON.parse(JSON.stringify(value));

assert.equal(manifest.characters.length, 12);
assert.equal(new Set(manifest.characters.map(entry => entry.assetId)).size, 12);
assert.equal(context.__localIsBodyPresetAsset({assetId: 'local-body-male-standard', extension: '.glb'}), true);
for (const asset of [
  {assetId: 'folder-characters-import', extension: '.glb'},
  {assetId: 'local-body-male-unknown', extension: '.glb'},
  {assetId: 'local-body-male-standard-more', extension: '.glb'},
  {assetId: 'local-body-male-standard', extension: '.gltf'},
]) assert.equal(context.__localIsBodyPresetAsset(asset), false);
assert.throws(() => context.__localCreateCatalogModel(
  {assetId: 'folder-characters-import', displayName: 'Custom'},
  {assetId: 'folder-characters-import', mediaUrl: '/assets/custom.glb', extension: '.glb'}), /Mixamo FBX/);
const original = context.__localCreateCatalogModel({assetId: 'folder-characters-import', displayName: 'Original'},
  {assetId: 'folder-characters-import', mediaUrl: '/assets/original.fbx', extension: '.fbx'});
assert.equal(original.color, '#aabbcc');
const disposeRuntime = runtime => {
  runtime.jointHandles.forEach(handle => {handle.geometry.dispose(); handle.material.dispose();});
  runtime.materials.forEach(material => material.dispose());
  runtime.skeletonHelper?.dispose();
};

const results = [];
for (const entry of manifest.characters) {
  const model = await loadSource(path.join(repositoryRoot, 'web', entry.mediaUrl.replace(/^\//, '')));
  const object = context.__localCreateCatalogModel(entry, entry);
  assert.equal(object.color, '#d2d5d8');
  assert.equal(object.placementAnchor, 'bottom-center-v1');
  const runtime = context.x_(object, {scene: model, format: 'gltf'});
  assert.equal(runtime.standardMixamoRig, true, entry.assetId + ': standard rig');
  assert.equal(runtime.bones.length, 65);
  assert.ok(runtime.skinnedMeshes.length > 0);
  assert.ok(runtime.motionBindReference);
  assert.equal(runtime.motionBindReference.resolve().reference.bones.length, 65);
  assert.ok(runtime.bones.every(bone => [...bone.position, ...bone.quaternion, ...bone.scale].every(Number.isFinite)));
  if (!results.length) {
    const generic = context.x_({...object, asset: {...object.asset, assetId: 'folder-characters-import'}}, {scene: model, format: 'gltf'});
    assert.equal(generic.standardMixamoRig, false, 'Unrelated GLB characters retain original import rules');
    assert.equal(generic.motionBindReference, undefined);
    disposeRuntime(generic);
    const invalidScene = cloneSkeleton(model);
    context.lJ(invalidScene).find(bone => bone.name === 'mixamorigHead').name = 'unsupported-head';
    const invalid = context.x_(object, {scene: invalidScene, format: 'gltf'});
    assert.equal(invalid.standardMixamoRig, false, 'A matching ID does not bypass actual skeleton validation');
    assert.equal(invalid.motionBindReference, undefined);
    disposeRuntime(invalid);
  }
  const bounds = new THREE.Box3().setFromObject(runtime.root, true);
  const dimensions = bounds.getSize(new THREE.Vector3());
  assert.ok(Math.abs(bounds.min.y) < 0.001, entry.assetId + ': feet at ground');
  assert.ok(Math.abs(dimensions.y - entry.heightMeters) < 0.025, entry.assetId + ': meter units');

  const definitions = runtime.bones.map((bone, index) => ({name: hierarchy[index].name,
    parentIndex: walk.bones[index].parentIndex, position: bone.position.toArray(),
    quaternion: bone.quaternion.toArray(), scale: bone.scale.toArray()}));
  const motionResults = [walk, crouch, sit].map(motion => validateOriginalRetarget(motion, definitions, classes, {allowStatic: motion !== walk}));
  const sourceRig = makeMotionRig(walk.bones);
  const prepared = runtime.motionBindReference.resolve().prepareClip(new classes.Retargeter(sourceRig.bones),
    THREE.AnimationClip.parse(walk.clip), runtime.bones);
  const mixer = new THREE.AnimationMixer(runtime.animationRoot);
  mixer.clipAction(prepared.clip).play();
  const before = runtime.skinnedMeshes.map(mesh => mesh.getVertexPosition(0, new THREE.Vector3()).clone());
  mixer.setTime(0.3);
  runtime.root.updateMatrixWorld(true);
  assert.ok(runtime.skinnedMeshes.some((mesh, index) => mesh.getVertexPosition(0, new THREE.Vector3()).distanceTo(before[index]) > 0.01),
    entry.assetId + ': retargeting deforms actual skinned geometry');
  for (const mesh of runtime.skinnedMeshes) {
    for (let index = 0; index < mesh.geometry.attributes.position.count; index += 701) {
      assert.ok(mesh.getVertexPosition(index, new THREE.Vector3()).toArray().every(Number.isFinite), entry.assetId + ': finite skin');
    }
  }
  mixer.stopAllAction();
  mixer.uncacheRoot(runtime.animationRoot);

  const saved = context.encodeObject({...object, rigged: true});
  assert.equal(saved.ok, true);
  const restored = context.decodeObject(plain(saved.object), reference => reference.resourceId === entry.assetId ? {mediaUrl: entry.mediaUrl} : undefined);
  assert.equal(restored.ok, true);
  assert.equal(restored.object.rigged, true);
  assert.equal(restored.object.asset.extension, '.glb');
  assert.equal(restored.object.color, '#d2d5d8');
  assert.equal(restored.object.placementAnchor, 'bottom-center-v1');
  const restoredRuntime = context.x_(restored.object, {scene: model, format: 'gltf'});
  assert.equal(restoredRuntime.standardMixamoRig, true, entry.assetId + ': restored rig');
  assert.equal(restoredRuntime.rigSignature, runtime.rigSignature);
  assert.notEqual(restoredRuntime.bones[0], runtime.bones[0], 'Instances own separate skeletons');
  assert.notEqual(restoredRuntime.bones[0], context.lJ(model)[0], 'Loader cache remains unmodified');
  for (const instance of [runtime, restoredRuntime]) disposeRuntime(instance);
  results.push({assetId: entry.assetId, heightMeters: dimensions.y,
    maxMotionAngleError: Math.max(...motionResults.map(result => result.maxBodyDirectionErrorDegrees))});
}
console.log(JSON.stringify({presets: results.length, rigBones: 65, motionsPerPreset: 3,
  persistence: 'passed', cachedSkeletonIsolation: 'passed', results}, null, 2));
