import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import {createRequire} from 'node:module';
import * as THREE from 'three';
import {originalRetargetClasses, makeMotionRig} from '../src/motions/original-retarget-utils.mjs';

const require = createRequire(import.meta.url);
const parser = require('@babel/parser');
const traverse = require('@babel/traverse').default;
const factories = JSON.parse(await fs.readFile(new URL('../src/vendor/module-factories.json', import.meta.url), 'utf8'));
const walk = JSON.parse(await fs.readFile(new URL('../web/assets/motions/walk.motion.json', import.meta.url), 'utf8'));
const hierarchy = walk.bones.map(bone => ({name: bone.name, ...(bone.parentIndex < 0 ? {} : {parentName: walk.bones[bone.parentIndex].name})}));
const classes = originalRetargetClasses(factories, hierarchy);
factories['53401'] = require('../src/patches/motion-loader.cjs').patchMotionLoader(factories['53401']);
for (const name of ['patch-local-motion-library', 'motion-previews', 'pose-library', 'folder-models', 'root-motion']) require('../src/patches/' + name + '.cjs')(factories);
const source = factories['53401'];
new vm.Script('(' + source + ')');
const declarations = new Map();
const expressions = [];
traverse(parser.parse('(' + source + ')'), {
  FunctionDeclaration(node) { declarations.set(node.node.id.name, source.slice(node.node.start - 1, node.node.end - 1)); },
  FunctionExpression(node) { expressions.push(source.slice(node.node.start - 1, node.node.end - 1)); },
});
const so = {Pq0: THREE.Vector3, PTz: THREE.Quaternion, O9p: THREE.Euler, cj9: THREE.MathUtils, Iw4: THREE.AnimationMixer};
const context = vm.createContext({so, ap: 'path-traversal', bM: Math.PI / 180, bT: {x: 0, y: 0, z: 0}});
const names = new Set(['s6', 'lr', 'la', 'le', 's7', 'x5', 'r0', 'rq', 'r_', 'r$', 'r1', 'r2', 'r6', 'rJ', 'rQ', 'aa', 'an', 'ao', 'as', 'ai']);
for (const name of declarations.keys()) if (name.startsWith('__local')) names.add(name);
for (const name of names) {
  assert.ok(declarations.has(name), 'Missing production function ' + name);
  vm.runInContext(declarations.get(name), context);
}
const plain = value => JSON.parse(JSON.stringify(value));
const close = (actual, expected, message, epsilon = 1e-6) => assert.ok(Math.abs(actual - expected) <= epsilon, `${message}: ${actual} != ${expected}`);
const closeVector = (actual, expected, message, epsilon = 1e-6) => {
  for (const axis of ['x', 'y', 'z']) close(actual[axis], expected[axis], message + '.' + axis, epsilon);
};
const pose = {signature: 'root-motion-test', rotations: [{boneIndex: 0, rotation: {x: 0, y: 0, z: 0}, bindWorldRotation: {x: 0, y: 0, z: 0, w: 1}}]};
const motion = {
  id: 'saved-movement', durationSec: 2, loop: true, locomotion: {mode: 'embedded'}, transferMode: 'direct-local',
  keyframes: [0, 1, 2].map(timeSec => ({timeSec, pose, rootTranslation: {x: 10 + 100 * timeSec, y: 100 + 12.5 * timeSec, z: -5 + 20 * timeSec}})),
};
const expectedNative = (timeSec, loop = true) => ({x: 10 + 100 * timeSec, y: 100 + 12.5 * (loop ? timeSec % 2 : timeSec), z: -5 + 20 * timeSec});
for (const time of [0, 0.5, 1.999999, 2, 2.000001, 3.5, 4, 5.25, 8, 1.5, 0]) {
  closeVector(context.s6(motion, time).rootTranslation, expectedNative(time), 'Native root displacement at ' + time);
}
assert.deepEqual(plain(motion.keyframes[2].rootTranslation), expectedNative(2, false), 'Sampling must not mutate saved frames');
closeVector(context.s6({...motion, loop: false}, 20).rootTranslation, expectedNative(2, false), 'Nonlooping native clip clamps');
closeVector(context.s6({...motion, locomotion: {mode: 'in-place'}}, 5).rootTranslation, expectedNative(1), 'In-place native clip does not accumulate');
assert.ok(declarations.get('pQ').includes('sample:__localSampleWrappedMotion({...t,loop:r},e)'), 'Import preview must use its bounded sampler');
closeVector(context.__localSampleWrappedMotion(motion, 15).rootTranslation, expectedNative(1), 'Import preview stays within its fitted cycle bounds');
const staticMotion = {...motion, keyframes: [0, 2].map(timeSec => ({timeSec, pose, rootTranslation: {x: 4, y: 71, z: -2}}))};
closeVector(context.s6(staticMotion, 15).rootTranslation, {x: 4, y: 71, z: -2}, 'Static pose does not drift');
const noRootMotion = {...motion, keyframes: [0, 2].map(timeSec => ({timeSec, pose}))};
assert.equal(context.s6(noRootMotion, 15).rootTranslation, undefined);
const clip = {id: 'clip-native', objectId: 'person', motionId: motion.id, source: 'imported', startTimeSec: 3,
  offsetTimeSec: 0.5, durationSec: 4, speed: 2, loop: true, locomotionMode: 'embedded', motionUsage: 'direct',
  transitionInFrames: 0, createdAt: '2026-09-22T00:00:00Z'};
closeVector(context.le(clip, 150, 30, new Map([[motion.id, motion]]), {}).rootTranslation, expectedNative(4.5), 'Native timeline offset and speed');
closeVector(context.le({...clip, locomotionMode: 'in-place'}, 150, 30, new Map([[motion.id, motion]]), {}).rootTranslation,
  expectedNative(0.5), 'Clip in-place override takes priority over embedded source');
closeVector(context.le({...clip, staticPoseTimeSec: 1}, 210, 30, new Map([[motion.id, motion]]), {}).rootTranslation,
  expectedNative(1), 'Static pose source time must not accumulate');
const catalogNative = {...motion, id: 'folder-poses-native'};
closeVector(context.__localSampleCatalogMotion(catalogNative, 5, true, 'embedded').rootTranslation, expectedNative(5), 'Catalog native keyframe branch');

// Use the original 65-bone retargeter, with a deliberately different target size.
const sourceRig = makeMotionRig(walk.bones);
const targetDefinitions = walk.bones.map(bone => ({...bone, position: bone.position.map(value => value * 1.7)}));
const targetRig = makeMotionRig(targetDefinitions);
const firstRoot = sourceRig.bones[0].position.clone();
const sourceDelta = new THREE.Vector3(200, 25, -40);
const rootValues = [0, 0.5, 1].flatMap(fraction => firstRoot.clone().addScaledVector(sourceDelta, fraction).toArray());
const sourceClip = new THREE.AnimationClip('root-displacement-regression', 2, [
  new THREE.VectorKeyframeTrack(hierarchy[0].name + '.position', [0, 1, 2], rootValues),
  new THREE.QuaternionKeyframeTrack(hierarchy[0].name + '.quaternion', [0, 2], [...sourceRig.bones[0].quaternion.toArray(), ...sourceRig.bones[0].quaternion.toArray()]),
]);
const prepared = new classes.BindReference(targetRig.bones).resolve().prepareClip(new classes.Retargeter(sourceRig.bones), sourceClip, targetRig.bones);
close(prepared.legScale, 1.7, 'Target leg scale');
const rootTrack = prepared.clip.tracks.find(track => track.name === targetRig.bones[0].uuid + '.position');
assert.ok(rootTrack, 'Prepared motion contains target root track');
const interpolant = rootTrack.createInterpolant();
const targetStart = new THREE.Vector3().fromArray(interpolant.evaluate(0));
const targetEnd = new THREE.Vector3().fromArray(interpolant.evaluate(2));
const targetDelta = targetEnd.clone().sub(targetStart);
closeVector(targetDelta, sourceDelta.clone().multiplyScalar(1.7), 'Retargeted displacement uses target bone units', 2e-4);
const sceneRoot = new THREE.Group();
sceneRoot.position.set(4, 2, -5);
sceneRoot.rotation.set(0.1, Math.PI / 2, -0.2);
sceneRoot.scale.set(2, 1.3, 0.7);
const importFrame = new THREE.Group();
importFrame.scale.setScalar(0.01);
sceneRoot.add(importFrame); importFrame.add(targetRig.scene);
sceneRoot.updateMatrixWorld(true);
const player = {clip: prepared.clip, legScale: prepared.legScale, mixer: new THREE.AnimationMixer(targetRig.scene)};
player.action = player.mixer.clipAction(player.clip);
const assetPath = '/local-assets/motions/walking.fbx';
const runtime = {root: sceneRoot, bones: targetRig.bones, motionPlayers: new Map([[assetPath, player]])};
const assetMotion = {id: 'folder-motions-walking', assetPath, durationSec: 2};
const assetAt = (time, mode = 'embedded', loop = true, pathTraversal) => {
  const sample = context.__localSampleCatalogMotion(assetMotion, time, loop, mode, pathTraversal);
  assert.equal(context.x5({}, runtime, {}, sample), true);
  return {local: targetRig.bones[0].position.clone(), world: targetRig.bones[0].getWorldPosition(new THREE.Vector3()), sample};
};
for (const time of [0, 0.5, 1.999999, 2, 2.000001, 4, 5.25, 8, 1.5, 0]) {
  const result = assetAt(time);
  const expected = targetStart.clone().addScaledVector(targetDelta, time / 2);
  expected.y = targetStart.y + targetDelta.y * (time % 2) / 2;
  closeVector(result.local, expected, 'Retargeted FBX root at ' + time, 5e-4);
}
const beforeBoundary = assetAt(2 - 1e-6).local;
const afterBoundary = assetAt(2 + 1e-6).local;
assert.ok(Math.hypot(beforeBoundary.x - afterBoundary.x, beforeBoundary.z - afterBoundary.z) < 0.001, 'Horizontal movement is continuous at FBX loop boundary');
const worldAt1 = assetAt(1).world;
const worldAt5 = assetAt(5).world;
targetRig.bones[0].parent.updateWorldMatrix(true, false);
const expectedWorldDelta = targetDelta.clone().setY(0).multiplyScalar(2).applyMatrix3(new THREE.Matrix3().setFromMatrix4(targetRig.bones[0].parent.matrixWorld));
closeVector(worldAt5.clone().sub(worldAt1), expectedWorldDelta, 'Local displacement passes through import frame and object transform', 1e-5);
closeVector(assetAt(5, 'in-place').local, targetStart.clone().addScaledVector(targetDelta, 0.5), 'In-place asset mode skips cycle offset', 5e-4);
closeVector(assetAt(5, 'embedded', false).local, targetEnd, 'Nonlooping FBX clamps at last pose', 5e-4);
const pathTime = 5 / player.legScale % 2;
closeVector(assetAt(5, 'embedded', true, {sourceTimeSec: 5, offsetTimeSec: 0}).local,
  targetStart.clone().addScaledVector(targetDelta, pathTime / 2), 'Path traversal owns motion timing and must not double displacement', 5e-4);
const catalogClip = {...clip, motionId: assetMotion.id, source: 'catalog'};
const catalogSample = context.le(catalogClip, 150, 30, new Map(), {catalogMotions: new Map([[assetMotion.id, assetMotion]])});
assert.equal(context.x5({}, runtime, {}, catalogSample), true);
const catalogExpected = targetStart.clone().addScaledVector(targetDelta, 4.5 / 2);
catalogExpected.y = targetStart.y + targetDelta.y * 0.5 / 2;
closeVector(targetRig.bones[0].position, catalogExpected, 'Catalog timeline preserves unwrapped speed/offset time', 5e-4);

// These are real bundled Mixamo clips, including asymmetric and noncyclic poses.
for (const name of ['sneak', 'crouch-down', 'stand-up']) {
  const json = JSON.parse(await fs.readFile(new URL('../web/assets/motions/' + name + '.motion.json', import.meta.url), 'utf8'));
  const originalRig = makeMotionRig(json.bones);
  const realTarget = makeMotionRig(walk.bones);
  const realPrepared = new classes.BindReference(realTarget.bones).resolve().prepareClip(new classes.Retargeter(originalRig.bones), THREE.AnimationClip.parse(json.clip), realTarget.bones);
  const realPlayer = {clip: realPrepared.clip, legScale: realPrepared.legScale, mixer: new THREE.AnimationMixer(realTarget.scene)};
  realPlayer.action = realPlayer.mixer.clipAction(realPlayer.clip);
  const realAsset = {...assetMotion, id: 'real-' + name, assetPath: '/assets/motions/' + name + '.motion.json', durationSec: json.clip.duration};
  const realRuntime = {root: realTarget.scene, bones: realTarget.bones, motionPlayers: new Map([[realAsset.assetPath, realPlayer]])};
  const evaluate = time => {
    context.x5({}, realRuntime, {}, context.__localSampleCatalogMotion(realAsset, time, true, 'embedded'));
    return realTarget.bones[0].position.clone();
  };
  const realTrack = realPrepared.clip.tracks.find(track => track.name === realTarget.bones[0].uuid + '.position');
  const realInterpolant = realTrack.createInterpolant();
  const realFirst = new THREE.Vector3().fromArray(realInterpolant.evaluate(0));
  const realDelta = new THREE.Vector3().fromArray(realInterpolant.evaluate(json.clip.duration)).sub(realFirst);
  const quarter = evaluate(json.clip.duration * 0.25);
  const thirdCycleQuarter = evaluate(json.clip.duration * 2.25);
  closeVector(thirdCycleQuarter.clone().sub(quarter), realDelta.clone().setY(0).multiplyScalar(2), name + ' real cycle displacement', 5e-4);
  close(thirdCycleQuarter.y, quarter.y, name + ' never sinks or rises on repeated cycles', 5e-5);
  closeVector(evaluate(json.clip.duration * 0.25), quarter, name + ' backward seek', 5e-5);
  if (name === 'sneak') {
    assert.ok(Math.hypot(realDelta.x, realDelta.z) > 100, 'Real sneak has meaningful forward displacement in centimeters');
    const a = evaluate(json.clip.duration - 1e-5);
    const b = evaluate(json.clip.duration + 1e-5);
    assert.ok(a.distanceTo(b) < 0.1, 'Real sneak remains continuous across the loop boundary');
  }
}

const schedulerSource = expressions.filter(code => /new Map\(i\.map\(e=>\[e\.id,e\]\)\)/.test(code) && /\ble\(/.test(code)).sort((a, b) => a.length - b.length)[0];
assert.ok(schedulerSource, 'Production motion scheduler must be available');
vm.runInContext('this.createMotionScheduler=' + schedulerSource, context);
const makeScheduler = clips => context.createMotionScheduler({displayFps: 30, clips}, [motion], {});
const scheduler = makeScheduler([clip]);
assert.equal(scheduler.sample(2).person, undefined, 'No motion before clip starts');
closeVector(scheduler.sample(5).person.sample.rootTranslation, expectedNative(4.5), 'Active timeline pose');
closeVector(scheduler.sample(7).person.sample.rootTranslation, expectedNative(8.5), 'End holds actual clip endpoint including speed/offset');
closeVector(scheduler.sample(20).person.sample.rootTranslation, expectedNative(8.5), 'Gap after motion holds final displacement');
assert.equal(scheduler.sample(1).person, undefined, 'Seeking backward before start clears held pose');
closeVector(scheduler.sample(4).person.sample.rootTranslation, expectedNative(2.5), 'Seeking back inside clip recomputes deterministic displacement');
assert.equal(makeScheduler([{...clip, locomotionMode: 'in-place'}]).sample(20).person, undefined, 'In-place clips retain original post-clip behavior');
assert.equal(makeScheduler([{...clip, motionUsage: 'path-traversal'}]).sample(20).person, undefined, 'Path traversal is not held by embedded root-motion policy');
assert.equal(makeScheduler([{...clip, staticPoseTimeSec: 1}]).sample(20).person, undefined, 'Static poses are not classified as moving clips');
const laterInPlace = {...clip, id: 'later-in-place', startTimeSec: 8, durationSec: 1, locomotionMode: 'in-place'};
assert.equal(makeScheduler([clip, laterInPlace]).sample(20).person, undefined, 'Later nonmoving clips must not resurrect old held movement');
console.log('Root motion tests passed: native and retargeted FBX continuous ground displacement, source units, stable height, speed/offset, deterministic seeks, transformed world continuity, bounded previews, real Mixamo clips, mode exclusions, and clip-end hold.');
