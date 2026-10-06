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
require('../src/patches/camera-position-autokey.cjs')(factories);
const source = factories['53401'];
new vm.Script('(' + source + ')');
const ast = parser.parse('(' + source + ')');
let commitSource, persistenceSource;
traverse(ast, {VariableDeclarator(path) {
  const code = source.slice(path.node.start - 1, path.node.end - 1);
  if (path.node.id.name === 'cx' && code.includes('timelineCameraSelectPart')) commitSource = code.slice(code.indexOf('=') + 1);
  if (path.node.id.name === 'sQ' && code.includes('explicitCameraId')) persistenceSource = code.slice(code.indexOf('=') + 1);
}});
assert.ok(commitSource && persistenceSource, 'The real camera commit and multi-camera persistence callbacks exist');
const axes = ['x', 'y', 'z'];
const positionChannels = axes.map(axis => 'position.' + axis);
const targetChannels = axes.map(axis => 'target.' + axis);
const channels = [...positionChannels, ...targetChannels, 'lens.fov', 'lens.roll'];
const context = vm.createContext({
  crypto: {randomUUID}, Date, structuredClone,
  n: {useCallback: callback => callback},
  eH: channels, eB: positionChannels, eG: targetChannels, e$: [positionChannels, targetChannels],
  l7: positionChannels, l6: targetChannels, em: axes, ep: Math.PI / 180, eg: 180 / Math.PI,
  tC: 'scene-camera', tI: 'shot-camera::', tQ: 'Camera', tq: new Set(['scene-camera']),
  so: {cj9: THREE.MathUtils, Pq0: THREE.Vector3, PTz: THREE.Quaternion, O9p: THREE.Euler},
});
for (const node of ast.program.body[0].expression.body.body) {
  if (node.type === 'FunctionDeclaration') vm.runInContext(source.slice(node.start - 1, node.end - 1), context);
}
vm.runInContext(`this.createCameraCommit=function(bindings){
  const {R,iH,a_,a$,Q,iT,od,ej,ek,iK,e$,tZ,sr}=bindings;
  const sQ=${persistenceSource};
  return ${commitSource};
}`, context);
const plain = value => JSON.parse(JSON.stringify(value));
const clone = value => structuredClone(plain(value));
const makeState = () => {
  const sceneCamera = plain(context.tF());
  const cameraTracks = plain(context.eU(sceneCamera));
  const migrated = context.tZ({kind: 'legacy-singular', sceneCamera, cameraTracks});
  assert.equal(migrated.ok, true);
  const first = plain(migrated.document.cameras[0]);
  const second = {...clone(first), id: 'camera-secondary', name: 'Second camera'};
  second.transform.position = {x: 12, y: 4, z: -6};
  return {
    objects: [], sceneCamera, camera: {position: {x: 15, y: 12, z: 9}},
    timeline: {displayFps: 30, durationSec: 20, clips: [], objectTracks: {}, cameraTracks},
    multiCamera: {...plain(migrated.document), cameras: [first, second]},
  };
};
function commit(input, changed, {frame = 60, reason = 'director.scene-camera.position', part = 'camera', workspace = 'performance', playing = false, activeCameraId = 'scene-camera', mounted = true} = {}) {
  let state = input;
  const events = {reasons: [], notices: []};
  const document = context.oE(input);
  const active = context.oO(input, document, activeCameraId);
  const displayed = context.eK(active.sceneCamera, active.timeline.cameraTracks).sample(frame);
  const commitCamera = context.createCameraCommit({
    R(updater, changeReason) {state = updater(state);events.reasons.push(changeReason);},
    iH: {current: activeCameraId}, a_: {current: null}, a$: {current: undefined},
    Q: {timelineCameraPlaybackLocked: 'playback-locked', timelineCameraSelectPart: 'select-camera-part'},
    iT: notice => events.notices.push(notice), od: part, ej: workspace,
    ek: {current: frame / input.timeline.displayFps}, iK: input,
    e$: {current: mounted}, tZ: {getSnapshot: () => playing}, sr: displayed,
  });
  const camera = {...plain(displayed), ...clone(changed)};
  const accepted = commitCamera(camera, reason);
  return {state, accepted, events};
}
const track = (state, cameraId = 'scene-camera') => state.multiCamera.cameras.find(camera => camera.id === cameraId).tracks;
const sample = (state, frame, cameraId = 'scene-camera') => {
  const selected = state.multiCamera.cameras.find(camera => camera.id === cameraId);
  return plain(context.eK(context.t0(selected), selected.tracks).sample(frame));
};
const baseline = makeState();
const destination = {x: 6, y: 3, z: -2};
const moved = commit(baseline, {position: destination});
assert.equal(moved.accepted, true);
assert.deepEqual(moved.events.reasons, ['director.scene-camera.position']);
for (const axis of axes) {
  assert.deepEqual(plain(track(moved.state)['position.' + axis].map(key => [key.frame, key.value])), [[0, baseline.sceneCamera.position[axis]], [60, destination[axis]]]);
  assert.deepEqual(plain(track(moved.state)['target.' + axis]), []);
}
assert.deepEqual(sample(moved.state, 0).position, baseline.sceneCamera.position);
assert.deepEqual(sample(moved.state, 60).position, destination);
assert.deepEqual(sample(moved.state, 30).position, {x: 3, y: 2.6, z: 2.5});
assert.deepEqual(plain(moved.state.camera), baseline.camera, 'Authoring a shot camera does not change free director navigation');
assert.deepEqual(plain(moved.state.multiCamera.cameras[1]), baseline.multiCamera.cameras[1]);

const replaced = commit(moved.state, {position: {x: 10, y: 5, z: -4}});
for (const channel of positionChannels) {
  const before = track(moved.state)[channel], after = track(replaced.state)[channel];
  assert.equal(after.length, 2);
  assert.equal(after[1].id, before[1].id);
  assert.equal(after[1].createdAt, before[1].createdAt);
  assert.deepEqual(plain(after[0]), plain(before[0]));
}
const later = commit(replaced.state, {position: {x: 20, y: 8, z: -7}}, {frame: 120});
assert.deepEqual(plain(track(later.state)['position.x'].map(key => key.frame)), [0, 60, 120]);
const target = commit(baseline, {target: {x: 2, y: 4, z: -3}}, {reason: 'director.scene-camera.target', part: 'target'});
for (const axis of axes) {
  assert.deepEqual(plain(track(target.state)['target.' + axis].map(key => key.frame)), [0, 60]);
  assert.deepEqual(plain(track(target.state)['position.' + axis]), []);
}
const view = commit(baseline, {position: destination, target: {x: 1, y: 2, z: -4}}, {reason: 'director.scene-camera.view', part: null});
assert.deepEqual(sample(view.state, 60).position, destination);
assert.deepEqual(sample(view.state, 60).target, {x: 1, y: 2, z: -4});
assert.equal(track(view.state)['lens.fov'].length, 0);

const atZero = commit(baseline, {position: destination}, {frame: 0});
assert.deepEqual(plain(atZero.state.sceneCamera.position), destination);
assert.ok(channels.every(channel => track(atZero.state)[channel].length === 0), 'Frame zero remains the initial composition until keys exist');
const zeroKey = commit(moved.state, {position: {x: -2, y: 3, z: 4}}, {frame: 0});
assert.deepEqual(sample(zeroKey.state, 0).position, {x: -2, y: 3, z: 4});
assert.deepEqual(plain(track(zeroKey.state)['position.x'].map(key => key.frame)), [0, 60]);
const staging = commit(baseline, {position: destination}, {workspace: 'staging'});
assert.deepEqual(plain(staging.state.sceneCamera.position), destination);
assert.ok(channels.every(channel => track(staging.state)[channel].length === 0));
for (const [reason, changed] of [['director.scene-camera.fov', {fov: 70}], ['director.scene-camera.roll', {roll: 20}]]) {
  const result = commit(baseline, changed, {reason});
  assert.ok(channels.every(channel => track(result.state)[channel].length === 0), 'Unkeyed lens changes retain their existing behavior');
  assert.equal(result.state.sceneCamera[Object.keys(changed)[0]], Object.values(changed)[0]);
}
const lensState = makeState();
lensState.multiCamera.cameras[0].tracks['lens.fov'] = [{id: 'lens-key', frame: 0, value: 50, interpolation: 'smooth', createdAt: '2026-09-22'}];
const lensChanged = commit(lensState, {fov: 75}, {reason: 'director.scene-camera.fov'});
assert.deepEqual(plain(track(lensChanged.state)['lens.fov'].map(key => [key.frame, key.value])), [[0, 50], [60, 75]], 'An existing lens track continues to key edits');
assert.deepEqual(plain(track(lensChanged.state)['position.x']), []);
const helperChanged = commit(baseline, {cameraHelperVisible: false}, {reason: 'director.scene-camera.helper'});
assert.equal(helperChanged.state.sceneCamera.cameraHelperVisible, false);
assert.ok(channels.every(channel => track(helperChanged.state)[channel].length === 0), 'Helper visibility does not create animation');
const unchanged = commit(moved.state, {}, {frame: 30});
assert.equal(unchanged.accepted, false);
assert.equal(unchanged.state, moved.state);
const noise = sample(moved.state, 30).position;noise.x += 1e-9;
assert.equal(commit(moved.state, {position: noise}, {frame: 30}).state, moved.state);
const locked = commit(baseline, {position: destination}, {playing: true});
assert.equal(locked.accepted, false);
assert.deepEqual(locked.events.notices, ['playback-locked']);
assert.equal(locked.state, baseline);
const noSelection = commit(baseline, {position: destination}, {part: null});
assert.equal(noSelection.accepted, false);
assert.deepEqual(noSelection.events.notices, ['select-camera-part']);
assert.equal(commit(baseline, {position: destination}, {mounted: false}).state, baseline);

const secondary = commit(baseline, {position: destination}, {activeCameraId: 'camera-secondary'});
assert.deepEqual(plain(secondary.state.multiCamera.cameras[0]), baseline.multiCamera.cameras[0], 'The output camera is preserved when authoring another camera');
assert.deepEqual(sample(secondary.state, 0, 'camera-secondary').position, {x: 12, y: 4, z: -6});
assert.deepEqual(sample(secondary.state, 60, 'camera-secondary').position, destination);
assert.deepEqual(plain(secondary.state.sceneCamera), baseline.sceneCamera, 'Legacy output projection remains on the output camera');

const partial = makeState();
partial.multiCamera.cameras[0].tracks['position.x'] = [{id: 'existing-x', frame: 15, value: 3, interpolation: 'hold', createdAt: '2026-09-22'}];
const partialResult = commit(partial, {position: destination});
assert.deepEqual(plain(track(partialResult.state)['position.x'].map(key => key.frame)), [15, 60]);
assert.equal(track(partialResult.state)['position.x'][0].id, 'existing-x');
for (const axis of ['y', 'z']) assert.deepEqual(plain(track(partialResult.state)['position.' + axis].map(key => key.frame)), [0, 60]);
const boundCamera = makeState();
boundCamera.multiCamera.cameras[0].binding = {
  kind: 'over-shoulder', presetId: 'over-shoulder', foregroundObjectId: 'actor-a', focusObjectId: 'actor-b', axisSide: 'right', invalidTargetPolicy: 'freeze-world',
};
const bindingMoved = commit(boundCamera, {position: destination});
assert.deepEqual(plain(bindingMoved.state.multiCamera.cameras[0].binding), boundCamera.multiCamera.cameras[0].binding, 'Preset binding survives the original multi-camera persistence path');
console.log('Camera position auto-key tests passed: real camera commit/persistence, initial and same-frame keys, interpolation, target/view movement, independent cameras, partial tracks, frame-zero placement, static editing, lens behavior, and playback/selection guards.');
