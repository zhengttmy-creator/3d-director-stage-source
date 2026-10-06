import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import {randomUUID} from 'node:crypto';
import {createRequire} from 'node:module';
import * as THREE from 'three';

const require = createRequire(import.meta.url);
const parser = require('@babel/parser');
const traverse = require('@babel/traverse').default;
const factories = JSON.parse(await fs.readFile(new URL('../src/vendor/module-factories.json', import.meta.url), 'utf8'));
factories['53401'] = require('../src/patches/motion-loader.cjs').patchMotionLoader(factories['53401']);
for (const name of ['patch-local-motion-library', 'motion-previews', 'pose-library', 'folder-models', 'root-motion', 'transform-autokey']) {
  require('../src/patches/' + name + '.cjs')(factories);
}
const source = factories['53401'];
new vm.Script('(' + source + ')');
const ast = parser.parse('(' + source + ')');
const hookCandidates = [];
traverse(ast, {FunctionExpression(node) {
  const code = source.slice(node.node.start - 1, node.node.end - 1);
  if (code.includes('commitObjectTransforms:m')) hookCandidates.push(code);
}});
const hookSource = hookCandidates.sort((a, b) => a.length - b.length)[0];
assert.ok(hookSource, 'Actual transform authoring hook must exist');
const context = vm.createContext({
  crypto: {randomUUID}, Date, structuredClone,
  n: {useCallback: fn => fn},
  so: {cj9: THREE.MathUtils, Pq0: THREE.Vector3, PTz: THREE.Quaternion, O9p: THREE.Euler},
  em: ['x', 'y', 'z'], ep: Math.PI / 180, eg: 180 / Math.PI,
  bz: 180 / Math.PI, bT: {x: 0, y: 0, z: 0},
  tW: ['x', 'y', 'z'], tK: ['position', 'rotation', 'scale'],
  tj: ['position.x', 'position.y', 'position.z', 'rotation.x', 'rotation.y', 'rotation.z', 'scale.x', 'scale.y', 'scale.z'],
});
// Declare the bundled samplers unchanged; only React and unrelated path-facing services are controlled.
for (const node of ast.program.body[0].expression.body.body) {
  if (node.type === 'FunctionDeclaration') vm.runInContext(source.slice(node.start - 1, node.end - 1), context);
}
vm.runInContext('this.createTransformAuthoring=' + hookSource, context);
const plain = value => JSON.parse(JSON.stringify(value));
const clone = value => structuredClone(plain(value));
const axes = ['x', 'y', 'z'];
const base = {
  position: {x: 1, y: 2, z: 3},
  rotation: {x: 10, y: 20, z: -30},
  scale: {x: 1, y: 1.5, z: 0.75},
};
const makeObject = (id, transform = base, kind = 'model') => ({id, kind, locked: false, transform: clone(transform)});
const makeState = (objects = [makeObject('person')], objectTracks = {}) => ({
  objects,
  timeline: {displayFps: 30, durationSec: 20, clips: [], objectTracks,
    cameraTracks: {'position.x': [{id: 'camera-key', frame: 10, value: 9, interpolation: 'hold', createdAt: '2026-09-22'}]}},
  sceneCamera: {id: 'camera-main', position: {x: 4, y: 5, z: 6}},
});
const transformWith = (transform, patch) => ({...clone(transform), ...clone(patch)});
const close = (actual, expected, message) => assert.ok(Math.abs(actual - expected) < 1e-7, `${message}: ${actual} != ${expected}`);
const assertVector = (actual, expected, message) => axes.forEach(axis => close(actual[axis], expected[axis], message + '.' + axis));
function commit(input, updates, {workspace = 'performance', frame = 60, facing = {}, locked = []} = {}) {
  let state = input;
  const events = {stage: [], object: [], notices: [], stops: 0};
  context.lT = () => ({sampleFacing: id => facing[id]});
  context.lL = ({object}) => !!object && locked.includes(object.id);
  context.lD = (rotation, yaw) => ({...rotation, y: yaw});
  const hook = context.createTransformAuthoring({workspace, stageState: input,
    displaySceneCamera: input.sceneCamera, readTimelineTimeSec: () => frame / input.timeline.displayFps,
    readActivePreviewCameraId: () => 'camera-main', selection: {},
    copy: {pathFacingRotationLocked: 'rotation-locked'},
    persistence: {
      commitStageChange(update, reason) {events.stage.push(reason);state = update(state);return true;},
      commitObjectPositionAuthoringChange(update, reason) {events.object.push(reason);state = update(state);return true;},
    },
    ui: {stopPlayback() {events.stops++;}, showNotice(value) {events.notices.push(value);}},
  });
  const accepted = hook.commitObjectTransforms(updates);
  assert.equal(state.timeline.cameraTracks, input.timeline.cameraTracks, 'Object commits preserve camera tracks by identity');
  assert.deepEqual(plain(state.sceneCamera), plain(input.sceneCamera), 'Object commits never move the camera');
  return {state, events, accepted};
}
const trackFor = state => state.timeline.objectTracks.person;
const sample = (state, frame, id = 'person') => context.tL(state.objects.find(object => object.id === id).transform, state.timeline.objectTracks[id], frame);
const targetRotation = {x: 80, y: 740, z: -90};
const first = commit(makeState(), {person: transformWith(base, {rotation: targetRotation})});
assert.equal(first.accepted, true);
assert.equal(first.events.stops, 1);
assert.equal(first.events.object.length, 1);
assert.equal(first.events.stage.length, 0);
assert.deepEqual(plain(first.state.objects[0].transform), base, 'First rotation key preserves the original object transform');
for (const axis of axes) {
  assert.deepEqual(plain(trackFor(first.state)['rotation.' + axis].map(key => [key.frame, key.value])), [[0, base.rotation[axis]], [60, targetRotation[axis]]]);
  assert.equal(trackFor(first.state)['scale.' + axis], undefined);
  assert.equal(trackFor(first.state)['position.' + axis], undefined);
}
assertVector(sample(first.state, 0).rotation, base.rotation, 'First rotation baseline');
assertVector(sample(first.state, 60).rotation, targetRotation, 'First authored rotation');
assertVector(sample(first.state, 180).rotation, targetRotation, 'Last rotation holds');

const targetScale = {x: 2, y: 3.5, z: 1.25};
const scaled = commit(makeState(), {person: transformWith(base, {scale: targetScale})});
assertVector(sample(scaled.state, 0).scale, base.scale, 'Scale baseline');
assertVector(sample(scaled.state, 30).scale, {x: 1.5, y: 2.5, z: 1}, 'Scale interpolation');
assertVector(sample(scaled.state, 60).scale, targetScale, 'Scale target');
assert.deepEqual(plain(scaled.state.objects[0].transform), base);

const atZero = commit(makeState(), {person: transformWith(base, {rotation: targetRotation, scale: targetScale})}, {frame: 0});
for (const group of ['rotation', 'scale']) for (const axis of axes) {
  const keys = trackFor(atZero.state)[group + '.' + axis];
  assert.equal(keys.length, 1, 'Editing frame zero creates one key per channel');
  assert.equal(keys[0].frame, 0);
}
const nextRotation = {x: 120, y: 1100, z: -160};
const later = commit(first.state, {person: transformWith(sample(first.state, 120), {rotation: nextRotation})}, {frame: 120});
for (const axis of axes) assert.deepEqual(plain(trackFor(later.state)['rotation.' + axis].map(key => key.frame)), [0, 60, 120]);
const beforeReplace = clone(trackFor(later.state));
const replacement = {x: 140, y: 1180, z: -200};
const replaced = commit(later.state, {person: transformWith(sample(later.state, 120), {rotation: replacement})}, {frame: 120});
for (const axis of axes) {
  const channel = 'rotation.' + axis;
  const keys = trackFor(replaced.state)[channel];
  assert.equal(keys.length, 3);
  assert.equal(keys[2].id, beforeReplace[channel][2].id, 'Same-frame replacement preserves key ID');
  assert.equal(keys[2].createdAt, beforeReplace[channel][2].createdAt);
  assert.deepEqual(plain(keys.slice(0, 2)), beforeReplace[channel].slice(0, 2), 'Updating current frame preserves earlier keyframes');
}
const unchanged = commit(replaced.state, {person: clone(sample(replaced.state, 30))}, {frame: 30});
assert.equal(unchanged.state.timeline, replaced.state.timeline, 'No transform change writes no keys');
const tiny = clone(sample(replaced.state, 30)); tiny.rotation.x += 1e-9;
assert.equal(commit(replaced.state, {person: tiny}, {frame: 30}).state.timeline, replaced.state.timeline, 'Floating point noise writes no keys');

const staging = commit(makeState(), {person: transformWith(base, {rotation: targetRotation, scale: targetScale})}, {workspace: 'staging'});
assert.equal(staging.events.stage.length, 1);
assert.equal(staging.events.object.length, 0);
assert.equal(staging.events.stops, 0);
assert.deepEqual(plain(staging.state.timeline.objectTracks), {}, 'Static workspace does not add timeline keys');
assertVector(staging.state.objects[0].transform.rotation, targetRotation, 'Static workspace still updates rotation');
assertVector(staging.state.objects[0].transform.scale, targetScale, 'Static workspace still updates scale');

const positionTarget = {x: 7, y: 4, z: -3};
const positioned = commit(makeState(), {person: transformWith(base, {position: positionTarget})});
assertVector(positioned.state.objects[0].transform.position, base.position, 'First timed move preserves the initial placement');
for (const axis of axes) assert.deepEqual(plain(trackFor(positioned.state)['position.' + axis].map(key => [key.frame, key.value])),
  [[0, base.position[axis]], [60, positionTarget[axis]]]);
assertVector(sample(positioned.state, 0).position, base.position, 'Position at frame zero remains unchanged');
assertVector(sample(positioned.state, 30).position, {x: 4, y: 3, z: 0}, 'First timed move interpolates from the original position');
assertVector(sample(positioned.state, 60).position, positionTarget, 'The authored frame reaches the moved position');
assertVector(sample(positioned.state, 180).position, positionTarget, 'Position holds after the last key');
const initialPlacement = commit(makeState(), {person: transformWith(base, {position: positionTarget})}, {frame: 0});
assert.deepEqual(plain(initialPlacement.state.timeline.objectTracks), {}, 'An unkeyed frame-zero move remains initial placement');
assertVector(initialPlacement.state.objects[0].transform.position, positionTarget, 'Frame-zero placement updates the base');
const staticPosition = commit(makeState(), {person: transformWith(base, {position: positionTarget})}, {workspace: 'staging'});
assert.deepEqual(plain(staticPosition.state.timeline.objectTracks), {}, 'Static staging does not create position animation');
assertVector(staticPosition.state.objects[0].transform.position, positionTarget, 'Static staging still moves objects');
const combined = commit(makeState(), {person: transformWith(base, {position: positionTarget, rotation: targetRotation})});
assertVector(sample(combined.state, 60).position, positionTarget, 'Combined drag commits position at the current frame');
assertVector(sample(combined.state, 0).rotation, base.rotation, 'Position update cannot overwrite rotation baseline');
assertVector(sample(combined.state, 0).position, base.position, 'Combined movement preserves both starting values');
const positionAgain = commit(positioned.state, {person: transformWith(sample(positioned.state, 60), {position: {x: 9, y: 6, z: -5}})});
for (const axis of axes) {
  const before = trackFor(positioned.state)['position.' + axis];
  const after = trackFor(positionAgain.state)['position.' + axis];
  assert.equal(after.length, 2, 'Repeated dragging updates the same frame instead of appending keys');
  assert.equal(after[1].id, before[1].id);
  assert.deepEqual(plain(after[0]), plain(before[0]), 'Repeated dragging preserves the starting key');
}
const laterPosition = commit(positioned.state, {person: transformWith(sample(positioned.state, 120), {position: {x: 11, y: 6, z: 1}})}, {frame: 120});
assert.deepEqual(plain(trackFor(laterPosition.state)['position.x'].map(key => key.frame)), [0, 60, 120]);
const betweenPositions = sample(laterPosition.state, 90).position;
for (const axis of axes) assert.ok(betweenPositions[axis] > positionTarget[axis] && betweenPositions[axis] < {x: 11, y: 6, z: 1}[axis],
  'Subsequent moves follow the existing spatial curve between authored positions');
assertVector(sample(laterPosition.state, 60).position, positionTarget, 'A later move preserves the previous authored position');
assertVector(sample(laterPosition.state, 120).position, {x: 11, y: 6, z: 1}, 'The later key reaches the new position');
const partialPosition = makeState(undefined, {person: {'position.x': clone(trackFor(positioned.state)['position.x'])}});
const repairedPosition = commit(partialPosition, {person: transformWith(sample(partialPosition, 90), {position: {x: 10, y: 8, z: -7}})}, {frame: 90});
assert.deepEqual(plain(trackFor(repairedPosition.state)['position.x'].slice(0, 2)), plain(trackFor(positioned.state)['position.x']));
for (const axis of ['y', 'z']) assert.deepEqual(plain(trackFor(repairedPosition.state)['position.' + axis].map(key => key.frame)), [0, 90]);
for (const kind of ['model', 'light', 'primitive', 'background']) {
  const moved = commit(makeState([makeObject('person', base, kind)]), {person: transformWith(base, {position: positionTarget})});
  assertVector(sample(moved.state, 30).position, {x: 4, y: 3, z: 0}, kind + ' uses position auto-key');
}
const batchMove = commit(makeState([makeObject('person'), makeObject('second', transformWith(base, {position: {x: -5, y: 0, z: 10}})), makeObject('ignored')]), {
  person: transformWith(base, {position: positionTarget}),
  second: transformWith(base, {position: {x: -3, y: 2, z: 12}}),
});
assertVector(sample(batchMove.state, 0, 'second').position, {x: -5, y: 0, z: 10}, 'Multi-selection retains each object starting point');
assertVector(sample(batchMove.state, 30, 'second').position, {x: -4, y: 1, z: 11}, 'Multi-selection animates each moved object');
assert.equal(batchMove.state.timeline.objectTracks.ignored, undefined);

const partialKeys = [
  {id: 'x-early', frame: 15, value: 25, interpolation: 'hold', createdAt: '2026-09-20'},
  {id: 'x-edit', frame: 60, value: 55, interpolation: 'smooth', tangents: {mode: 'free', in: {frameDelta: -0.2, valueDelta: -0.3}, out: {frameDelta: 0.2, valueDelta: 0.3}}, createdAt: '2026-09-21'},
];
const partialInput = makeState(undefined, {person: {'rotation.x': clone(partialKeys)}});
const partialBefore = clone(partialInput);
const partial = commit(partialInput, {person: transformWith(base, {rotation: targetRotation})});
assert.deepEqual(plain(partialInput), partialBefore, 'Auto-key does not mutate prior state');
assert.deepEqual(plain(trackFor(partial.state)['rotation.x'].map(key => key.frame)), [15, 60], 'An existing axis receives no invented zero-frame key');
assert.deepEqual(plain(trackFor(partial.state)['rotation.x'][0]), partialKeys[0]);
assert.equal(trackFor(partial.state)['rotation.x'][1].id, 'x-edit');
assert.equal(trackFor(partial.state)['rotation.x'][1].interpolation, 'smooth');
assert.deepEqual(plain(trackFor(partial.state)['rotation.x'][1].tangents), partialKeys[1].tangents);
for (const axis of ['y', 'z']) assert.deepEqual(plain(trackFor(partial.state)['rotation.' + axis].map(key => key.frame)), [0, 60]);
close(sample(partial.state, 30).rotation.x, 25, 'Existing hold interpolation remains intact');
const keyedPosition = context.tN(undefined, 'position', 0, base.position).track;
const keyedPositionInput = makeState(undefined, {person: keyedPosition});
const keyedPositionResult = commit(keyedPositionInput, {person: transformWith(base, {position: positionTarget})});
for (const axis of axes) assert.deepEqual(plain(trackFor(keyedPositionResult.state)['position.' + axis].map(key => key.frame)), [0, 60]);

const secondBase = transformWith(base, {rotation: {x: -20, y: 35, z: 50}, scale: {x: 0.5, y: 0.8, z: 1.1}});
const multi = commit(makeState([makeObject('person'), makeObject('second', secondBase), makeObject('ignored')]), {
  person: transformWith(base, {rotation: targetRotation}),
  second: transformWith(secondBase, {scale: targetScale}),
});
assertVector(sample(multi.state, 0).rotation, base.rotation, 'First selected object keeps its baseline');
assertVector(sample(multi.state, 0, 'second').scale, secondBase.scale, 'Second selected object keeps its own baseline');
assertVector(sample(multi.state, 60, 'second').scale, targetScale, 'Second selected object gets scale keys');
assert.equal(multi.state.timeline.objectTracks.ignored, undefined, 'Unselected objects receive no keys');
const atTimelineEnd = commit(makeState(), {person: transformWith(base, {scale: targetScale})}, {frame: 900});
assert.equal(atTimelineEnd.state.timeline.durationSec, 30, 'Transform key extends timeline to its authored frame');
const alternateFps = makeState(); alternateFps.timeline.displayFps = 24;
const rounded = commit(alternateFps, {person: transformWith(base, {scale: targetScale})}, {frame: 24.2});
assert.deepEqual(plain(trackFor(rounded.state)['scale.x'].map(key => key.frame)), [0, 24], 'Nondefault FPS snaps to one integer frame');

const pathFacing = {person: {source: 'controlled', facingYawDegrees: 90}};
const lockedState = makeState();
const lockedResult = commit(lockedState, {person: transformWith(base, {rotation: targetRotation})}, {facing: pathFacing, locked: ['person']});
assert.equal(lockedResult.accepted, false);
assert.equal(lockedResult.state, lockedState);
assert.deepEqual(lockedResult.events.notices, ['rotation-locked']);
assert.equal(lockedResult.events.object.length, 0, 'Path-controlled rotation rejects authoring before persistence');
const lockedBatchState = makeState([makeObject('person'), makeObject('second')]);
const lockedBatch = commit(lockedBatchState, {
  person: transformWith(base, {rotation: targetRotation}), second: transformWith(base, {scale: targetScale}),
}, {facing: pathFacing, locked: ['person']});
assert.equal(lockedBatch.accepted, false);
assert.equal(lockedBatch.state, lockedBatchState, 'Rejected path rotation keeps a multi-object commit atomic');
const scaleOnPath = commit(lockedState, {person: transformWith(base, {rotation: {...base.rotation, y: 90}, scale: targetScale})}, {facing: pathFacing, locked: ['person']});
assert.equal(scaleOnPath.accepted, true, 'Path facing does not prevent scale authoring');
assert.equal(trackFor(scaleOnPath.state)['rotation.x'], undefined, 'Unchanged evaluated path rotation adds no rotation key');
assertVector(sample(scaleOnPath.state, 60).scale, targetScale, 'Scale remains editable on a controlled path');
const handoff = commit(makeState(), {person: transformWith(base, {rotation: targetRotation})}, {facing: {person: {source: 'handoff', facingYawDegrees: 90}}});
for (const axis of axes) assert.deepEqual(plain(trackFor(handoff.state)['rotation.' + axis].map(key => key.frame)), [60], 'Path handoff keeps its existing keyframe policy');

assertVector(sample(first.state, 30).rotation, {x: 45, y: 380, z: -60}, 'Real sampler interpolates multiple-turn rotations');
assertVector(sample(replaced.state, 90).rotation, {x: 110, y: 960, z: -145}, 'Updated late key interpolates forward');
assertVector(sample(replaced.state, 30).rotation, {x: 45, y: 380, z: -60}, 'Updating a later key does not affect the earlier segment');

const quaternionFor = rotation => new THREE.Quaternion().setFromEuler(new THREE.Euler(
  rotation.x * Math.PI / 180, rotation.y * Math.PI / 180, rotation.z * Math.PI / 180, 'XYZ'));
const checkContinuousRotation = (quaternion, reference, expected, message, epsilon = 1e-5) => {
  const actual = context.__localContinuousEuler(quaternion, reference);
  for (const axis of axes) assert.ok(Math.abs(actual[axis] - expected[axis]) < epsilon, `${message}.${axis}: ${actual[axis]} != ${expected[axis]}`);
  const rebuilt = quaternionFor(actual);
  assert.ok(1 - Math.abs(rebuilt.dot(quaternion)) < 1e-10, message + ' preserves exact orientation');
  return actual;
};
const equivalentReference = {x: 393, y: 89.9999999, z: -767};
const oppositeQuaternion = quaternionFor(equivalentReference);
oppositeQuaternion.set(-oppositeQuaternion.x, -oppositeQuaternion.y, -oppositeQuaternion.z, -oppositeQuaternion.w);
assert.deepEqual(plain(context.__localContinuousEuler(oppositeQuaternion, equivalentReference)), equivalentReference, 'Quaternion sign changes preserve authored reference exactly');
checkContinuousRotation(quaternionFor({x: 17.0001, y: -23, z: 31}), {x: 17, y: -23, z: 31}, {x: 17.0001, y: -23, z: 31}, 'Equivalent-rotation shortcut retains small real edits', 1e-7);
for (const axis of axes) for (const direction of [-1, 1]) {
  const start = {x: 17, y: -23, z: 31};
  let reference = start;
  for (let step = 0; step <= 216; step++) {
    const expected = {...start, [axis]: start[axis] + direction * step * 5};
    reference = checkContinuousRotation(quaternionFor(expected), reference, expected, axis + ' multi-turn step ' + step);
  }
}
for (const center of [90, -90, 270, -270, 450]) {
  const start = {x: 33, y: center - 5, z: -47};
  let reference = start;
  for (const offset of [-5, -1, -1e-5, -1e-7, 0, 1e-7, 1e-5, 1, 5]) {
    const expected = {...start, y: center + offset};
    reference = checkContinuousRotation(quaternionFor(expected), reference, expected, 'Y singularity ' + center + '/' + offset, 3e-5);
  }
}

const dragSnapshotsSource = hookCandidates.length && (() => {
  const candidates = [];
  traverse(ast, {FunctionExpression(node) {
    const code = source.slice(node.node.start - 1, node.node.end - 1);
    if (code.includes('snapshots:a.map(') && code.includes('pivotQuaternion:')) candidates.push(code);
  }});
  return candidates.sort((a, b) => a.length - b.length)[0];
})();
assert.ok(dragSnapshotsSource, 'Actual gizmo drag initializer must exist');
vm.runInContext('this.beginObjectDrag=' + dragSnapshotsSource, context);
for (const axis of axes) {
  const rotation = {x: 370, y: -20, z: -390};
  const object = makeObject('drag-object', transformWith(base, {rotation}));
  const root = new THREE.Group();
  root.position.set(4, 2, -6); root.scale.set(2, 3, 4); root.quaternion.copy(quaternionFor(rotation));
  const runtime = {objectId: object.id, root};
  const environment = {runtimes: new Map([[object.id, runtime]])};
  context.Ai = () => [{object, runtime}];
  const controls = {object: root, getMode: () => 'rotate'};
  context.beginObjectDrag(environment, {onObjectTransformsPreview() {}}, controls);
  const drag = environment.objectDrag;
  assert.deepEqual(plain(drag.snapshots[0].rotation), rotation, 'Gizmo starts with authored unwrapped angles');
  for (let step = 0; step <= 144; step++) {
    const expected = {...rotation, [axis]: rotation[axis] + step * 5};
    root.quaternion.copy(quaternionFor(expected));
    const preview = context.Ao(environment, drag)[object.id];
    assertVector(preview.rotation, expected, axis + ' actual gizmo preview ' + step);
    assertVector(drag.snapshots[0].rotation, expected, axis + ' snapshot advances for next drag event');
    assertVector(preview.position, {x: 4, y: 2, z: -6}, 'Rotation preview preserves position');
    assertVector(preview.scale, {x: 2, y: 3, z: 4}, 'Rotation preview preserves scale');
  }
  assertVector(context.Ao(environment, drag)[object.id].rotation, drag.snapshots[0].rotation, 'Final commit does not lose accumulated turns');
}
for (const yaw of [89.9, 89.9999, 89.999999, 89.9999999, 90, 90.0000001, -89.9999999, -90, -90.0000001, 449.9999999]) {
  for (const mode of ['translate', 'scale']) {
    const rotation = {x: 393, y: yaw, z: -767};
    const object = makeObject('stable-rotation', transformWith(base, {rotation}));
    const root = new THREE.Group(); root.quaternion.copy(quaternionFor(rotation));
    root.position.set(base.position.x, base.position.y, base.position.z);
    root.scale.set(base.scale.x, base.scale.y, base.scale.z);
    const runtime = {objectId: object.id, root};
    const environment = {runtimes: new Map([[object.id, runtime]])};
    context.Ai = () => [{object, runtime}];
    context.beginObjectDrag(environment, {}, {object: root, getMode: () => mode});
    if (mode === 'translate') root.position.set(8, 3, -2);
    else root.scale.set(2, 1.2, 3);
    const preview = context.Ao(environment, environment.objectDrag)[object.id];
    assertVector(preview.rotation, rotation, mode + ' preserves near-singular unmodified rotation ' + yaw);
    const result = commit(makeState([object]), {[object.id]: preview});
    for (const axis of axes) assert.equal(result.state.timeline.objectTracks[object.id]?.['rotation.' + axis], undefined, mode + ' cannot create spurious rotation keys');
    if (mode === 'translate') {
      assertVector(sample(result.state, 0, object.id).position, base.position, 'Gizmo translation preserves its initial position');
      assertVector(sample(result.state, 60, object.id).position, {x: 8, y: 3, z: -2}, 'Gizmo translation records the current frame automatically');
    }
  }
}

console.log('Transform auto-key tests passed: actual commit hook, position/rotation/scale baselines, spatial interpolation, multiple turns, frame-zero placement, same-frame replacement, partial tracks, static/no-change exclusions, multi-object movement, camera preservation, path-facing locks, quaternion equivalence, singularities, and actual gizmo snapshot accumulation.');
