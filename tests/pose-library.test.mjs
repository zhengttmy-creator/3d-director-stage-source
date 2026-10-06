import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import {randomUUID} from 'node:crypto';
import {createRequire} from 'node:module';
import {Quaternion, Vector3} from 'three';

const require = createRequire(import.meta.url);
const parser = require('@babel/parser');
const traverse = require('@babel/traverse').default;
const factories = JSON.parse(await fs.readFile(new URL('../src/vendor/module-factories.json', import.meta.url), 'utf8'));
const source = factories['53401'];
const declarations = new Map();
const expressions = [];
traverse(parser.parse('(' + source + ')'), {
  FunctionDeclaration(node) { declarations.set(node.node.id.name, source.slice(node.node.start - 1, node.node.end - 1)); },
  FunctionExpression(node) { expressions.push(source.slice(node.node.start - 1, node.node.end - 1)); },
});
const context = vm.createContext({
  crypto: {randomUUID}, structuredClone, Date, AbortController, DOMException, Buffer,
  th: 'mixamo-fbx-v1', tv: new Set(['workrally-mixamo-fbx-v1', 'octo-mixamo-v1']),
  pE: {mode: 'embedded'}, pO: {mode: 'in-place', provenance: 'authored'},
  ap: 'path-traversal', am: 'direct', ag: {}, af: {},
  g5: 'director-stage:motion-library:v1', r: () => ({A: null}),
});
for (const name of ['g7', 'g6', 'fe', 'fn', 'fo', 'fs', 'tb', 'g4', 'g8', 'ah', 'av', 'pU', 'ft', 'fa', 'wR']) {
  assert.ok(declarations.has(name), `Original ${name} function must remain available`);
  vm.runInContext(declarations.get(name), context);
}
const exportFunction = expressions.filter(code => code.includes('DIRECTOR_STAGE_MOTION_EXPORT_INVALID')).sort((a, b) => a.length - b.length)[0];
const importFunction = expressions.filter(code => code.includes('DIRECTOR_STAGE_MOTION_INVALID_JSON')).sort((a, b) => a.length - b.length)[0];
vm.runInContext('this.exportMotion=' + exportFunction + ';this.importMotion=' + importFunction + ';', context);
vm.runInContext(await fs.readFile(new URL('../src/patches/pose-library-runtime.js', import.meta.url), 'utf8'), context);
const plain = value => JSON.parse(JSON.stringify(value));
const pose = {
  signature: '0:-1|1:0|2:1', rootTranslation: {x: 3.25, y: -28.547981, z: -8.5},
  rotations: [
    {boneIndex: 0, rotation: {x: 28.9, y: 11.2, z: 2.6}, bindWorldRotation: {x: 0, y: 0, z: 0, w: 1}},
    {boneIndex: 1, rotation: {x: 13, y: -0.7, z: -3.3}, bindWorldRotation: {x: 0.12, y: 0.1, z: 0.04, w: Math.sqrt(1 - 0.12 ** 2 - 0.1 ** 2 - 0.04 ** 2)}},
  ],
};
const target = {skeletonId: 'mixamo-fbx-v1', skeletonVersion: 1};
const editingSession = {objectId: 'first-character', displayName: 'First pose'};
const laterSession = {objectId: 'second-character', displayName: 'Second pose'};
assert.equal(context.__localAttachSavedPoseSession(laterSession, editingSession, 'pose-old'), laterSession);
assert.equal(context.__localAttachSavedPoseSession(null, editingSession, 'pose-old'), null);
assert.equal(context.__localAttachSavedPoseSession(null, null, 'pose-old'), null);
assert.equal(context.__localAttachSavedPoseSession(editingSession, editingSession, 'pose-saved').localPoseId, 'pose-saved');
const livePose = {...pose, rotations: pose.rotations.map(rotation => ({...rotation,
  rotation: new Vector3(rotation.rotation.x, rotation.rotation.y, rotation.rotation.z),
  bindWorldRotation: new Quaternion(rotation.bindWorldRotation.x, rotation.bindWorldRotation.y, rotation.bindWorldRotation.z, rotation.bindWorldRotation.w),
}))};
assert.equal(context.__localCreatePoseMotion({pose: livePose, target, name: 'Live viewport pose'}).keyframes[0].pose.rotations.length, 2,
  'Live copyPose Quaternion getter values must be projected before serialization');
const motion = context.__localCreatePoseMotion({pose, target, name: 'Crouch pose', durationSec: 2.5});
assert.ok(motion.id.startsWith('pose-'));
assert.equal(motion.source, 'recorded');
assert.equal(motion.keyframes.length, 2);
assert.equal(motion.keyframes[1].timeSec, 2.5);
assert.equal(motion.keyframes[0].pose.rootTranslation, undefined);
assert.deepEqual(plain(motion.keyframes[0].rootTranslation), pose.rootTranslation);
const assertPose = (actual, expected) => {
  assert.equal(actual.signature, expected.signature);
  assert.equal(actual.rotations.length, expected.rotations.length);
  actual.rotations.forEach((rotation, index) => {
    assert.equal(rotation.boneIndex, expected.rotations[index].boneIndex);
    assert.deepEqual(plain(rotation.rotation), plain(expected.rotations[index].rotation));
    for (const axis of ['x', 'y', 'z', 'w']) assert.ok(Math.abs(rotation.bindWorldRotation[axis] - expected.rotations[index].bindWorldRotation[axis]) < 1e-12);
  });
};
assertPose(motion.keyframes[0].pose, pose);
assert.ok(context.__localIsStaticPoseMotion(motion));
const exported = context.exportMotion(motion);
const imported = context.importMotion(exported);
imported.keyframes.forEach((frame, index) => {
  assert.equal(frame.timeSec, motion.keyframes[index].timeSec);
  assert.deepEqual(plain(frame.rootTranslation), plain(motion.keyframes[index].rootTranslation));
  assertPose(frame.pose, motion.keyframes[index].pose);
});
assert.equal(imported.source, 'imported');
assert.ok(context.__localIsStaticPoseMotion(imported), 'Imported pose identity must survive a regenerated motion ID');
const draft = await context.wR([motion], {createWorker: false});
assert.equal(draft.version, 2);
const compacted = draft.motions[0];
assert.equal(compacted.encoding, 'f64le-base64');
const roots = Buffer.from(compacted.rootTranslations, 'base64');
assert.deepEqual(Array.from({length: 6}, (_, index) => roots.readDoubleLE(index * 8)), [3.25, -28.547981, -8.5, 3.25, -28.547981, -8.5]);
const rotations = Buffer.from(compacted.rotations, 'base64');
assert.equal(rotations.readDoubleLE(0), 28.9);
assert.equal(compacted.signature, pose.signature);

let committed;
let puts = 0;
const common = {
  motion, motions: [], operation: {id: 'test-lease'},
  compact: motions => context.wR(motions, {createWorker: false}),
  signal: new AbortController().signal, isCurrent: () => true,
  onSaved: motions => { committed = motions; },
};
const result = await context.__localPersistPoseMotion({...common, port: {async saveDraft(key, kind, payload) {
  assert.equal(key, 'director-stage:motion-library:v1');
  assert.equal(kind, 'generation');
  assert.equal(payload.motions[0].id, motion.id);
  assert.equal(committed, undefined, 'UI state cannot change before storage confirms success');
  puts++;
  return {ok: true};
}}});
assert.equal(puts, 1);
assert.equal(committed[0].id, result.id);
assert.equal(result.name, motion.name);
const updated = await context.__localPersistPoseMotion({...common, motions: [motion], port: {async saveDraft() { return {ok: true}; }}});
assert.equal(updated.name, motion.name, 'Updating a pose must not rename it because of its own name');
assert.equal(committed.length, 1);
committed = undefined;
await assert.rejects(context.__localPersistPoseMotion({...common, motions: [motion], port: {async saveDraft() { return {ok: false, error: {message: 'conflict'}}; }}}), /conflict/);
assert.equal(committed, undefined, 'Failed saves must not report a new library entry');
await assert.rejects(context.__localPersistPoseMotion({...common, isCurrent: () => false, port: {async saveDraft() { throw Error('Storage must not be called after scope changes'); }}}), {name: 'AbortError'});
assert.equal(committed, undefined);
const management = {...common, motions: [motion], id: motion.id, inUseMotionIds: new Set(),
  port: {async saveDraft() { return {ok: true}; }}};
await context.__localManagePoseMotion({...management, kind: 'rename', name: 'Saved crouch'});
assert.equal(committed[0].name, 'Saved crouch');
assert.equal(motion.name, 'Crouch pose', 'Rename cannot mutate the original library snapshot');
committed = undefined;
await assert.rejects(context.__localManagePoseMotion({...management, kind: 'delete', inUseMotionIds: new Set([motion.id]),
  port: {async saveDraft() { throw Error('An in-use pose must not be deleted from storage'); }}}), /\u65f6\u95f4\u8f74/);
assert.equal(committed, undefined);
await assert.rejects(context.__localManagePoseMotion({...management, kind: 'delete',
  port: {async saveDraft() { return {ok: false, error: {message: 'disk full'}}; }}}), /disk full/);
assert.equal(committed, undefined, 'Delete cannot remove a card before persistence succeeds');
await context.__localManagePoseMotion({...management, kind: 'delete'});
assert.equal(committed.length, 0);
assert.throws(() => context.__localCreatePoseMotion({pose: {...pose, rootTranslation: {x: NaN, y: 0, z: 0}}, target}), /\u65e0\u6548/);
assert.throws(() => context.__localCreatePoseMotion({pose, target: {skeletonId: 'other', skeletonVersion: 1}}), /\u4eba\u7269/);

require('../src/patches/patch-local-motion-library.cjs')(factories);
require('../src/patches/pose-library.cjs')(factories);
new vm.Script('(' + factories['53401'] + ')');
console.log('Pose library: live Quaternion capture, original JSON export/import, compact storage, root translation, bind rotations, atomic save/rename/delete, in-use protection and patch syntax passed.');
