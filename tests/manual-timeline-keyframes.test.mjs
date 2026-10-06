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
for (const name of ['patch-local-motion-library', 'motion-previews', 'pose-library', 'folder-models', 'root-motion', 'transform-autokey', 'camera-position-autokey', 'manual-timeline-keyframes']) {
  require('../src/patches/' + name + '.cjs')(factories);
}
const source = factories['53401'];
new vm.Script('(' + source + ')');
const ast = parser.parse('(' + source + ')');
const extract = node => source.slice(node.start - 1, node.end - 1);
const hookCandidates = [];
let persistenceSource;
traverse(ast, {
  FunctionExpression(path) {
    const code = extract(path.node);
    if (code.includes('commitObjectTransforms:m')) hookCandidates.push(code);
  },
  VariableDeclarator(path) {
    const code = extract(path.node);
    if (path.node.id.name === 'sQ' && code.includes('explicitCameraId')) persistenceSource = extract(path.node.init);
  },
});
const hookSource = hookCandidates.sort((a, b) => a.length - b.length)[0];
assert.ok(hookSource && persistenceSource);
const axes = ['x', 'y', 'z'];
const positionChannels = axes.map(axis => 'position.' + axis);
const targetChannels = axes.map(axis => 'target.' + axis);
const cameraChannels = [...positionChannels, ...targetChannels, 'lens.fov', 'lens.roll'];
const context = vm.createContext({
  crypto: {randomUUID}, Date, structuredClone,
  n: {useCallback: fn => fn, useSyncExternalStore: (_subscribe, read) => read()},
  so: {cj9: THREE.MathUtils, Pq0: THREE.Vector3, PTz: THREE.Quaternion, O9p: THREE.Euler},
  em: axes, ep: Math.PI / 180, eg: 180 / Math.PI, bz: 180 / Math.PI, bT: {x: 0, y: 0, z: 0},
  tW: axes, tK: ['position', 'rotation', 'scale'],
  tj: ['position', 'rotation', 'scale'].flatMap(group => axes.map(axis => group + '.' + axis)),
  eH: cameraChannels, eB: positionChannels, eG: targetChannels, e$: [positionChannels, targetChannels],
  tC: 'scene-camera', tI: 'shot-camera::', tQ: 'Camera', tq: new Set(['scene-camera']),
});
for (const node of ast.program.body[0].expression.body.body) {
  if (node.type === 'FunctionDeclaration') vm.runInContext(extract(node), context);
}
const createAuthoring = vm.runInContext('(' + hookSource + ')', context);
const createPersistence = vm.runInContext(`(function(bindings){const {R,iH,a_,a$}=bindings;return ${persistenceSource};})`, context);
const plain = value => JSON.parse(JSON.stringify(value));
const clone = value => structuredClone(plain(value));
const base = {position: {x: 1, y: 2, z: 3}, rotation: {x: 10, y: 740, z: -20}, scale: {x: 1, y: 1.5, z: 0.75}};
const person = {id: 'person', name: 'Person', kind: 'model', locked: false, transform: base};
const makeState = () => {
  const sceneCamera = plain(context.tF());
  const cameraTracks = plain(context.eU(sceneCamera));
  const migrated = context.tZ({kind: 'legacy-singular', sceneCamera, cameraTracks});
  assert.equal(migrated.ok, true);
  const first = plain(migrated.document.cameras[0]);
  const second = {...clone(first), id: 'camera-secondary', name: 'Secondary'};
  second.transform.position = {x: 12, y: 4, z: -6};
  return {objects: [clone(person)], sceneCamera,
    timeline: {displayFps: 30, durationSec: 20, clips: [], objectTracks: {}, cameraTracks},
    multiCamera: {...plain(migrated.document), cameras: [first, second]},
  };
};
function recordObject(input, group, {frame = 60, recordOnly = true, id = 'person', workspace = 'performance', pathLocked = false} = {}) {
  let state = input;
  const events = {writes: 0, refs: [], deleted: [], notices: []};
  context.lT = () => ({sampleFacing: () => undefined});
  context.lL = () => pathLocked;
  const authoring = createAuthoring({workspace, stageState: state, displaySceneCamera: state.sceneCamera,
    readTimelineTimeSec: () => frame / state.timeline.displayFps, readActivePreviewCameraId: () => 'scene-camera',
    copy: {pathFacingRotationLocked: 'path-rotation-locked'},
    persistence: {commitObjectPositionAuthoringChange(update) {state = update(state);events.writes++;return true;}},
    selection: {replaceKeyframeRefs(refs) {events.refs = plain(refs);}, removeKeyframeRefs(ids) {events.deleted = [...ids];}},
    ui: {openTimeline() {}, stopPlayback() {}, showNotice(value) {events.notices.push(value);}},
  });
  authoring.toggleObjectTransformKeyframe(id, group, recordOnly);
  return {state, events};
}
const objectTrack = state => state.timeline.objectTracks.person;
let keyed = makeState();
for (const group of ['position', 'rotation', 'scale']) {
  const result = recordObject(keyed, group);
  keyed = result.state;
  assert.equal(result.events.refs.length, 3);
  for (const axis of axes) {
    const channel = group + '.' + axis;
    assert.deepEqual(plain(objectTrack(keyed)[channel].map(key => [key.frame, key.value])), [[60, base[group][axis]]], 'An unchanged transform can be recorded without adding a frame-zero key');
  }
  assert.deepEqual(plain(keyed.objects[0].transform), base, 'Manual recording preserves base transforms');
  const again = recordObject(keyed, group);
  assert.deepEqual(plain(objectTrack(again.state)), plain(objectTrack(keyed)), 'Repeated manual recording preserves IDs, timestamps, values, and key count');
  assert.deepEqual(again.events.deleted, []);
  keyed = again.state;
}
const removed = recordObject(keyed, 'position', {recordOnly: false});
assert.equal(objectTrack(removed.state)['position.x'], undefined, 'The existing inspector toggle still removes a keyed group');
assert.equal(removed.events.deleted.length, 3);
assert.deepEqual(plain(objectTrack(removed.state)['rotation.y']), plain(objectTrack(keyed)['rotation.y']));

let interpolated = makeState();
for (const group of ['position', 'rotation', 'scale']) {
  let track = context.tN(undefined, group, 0, base[group]).track;
  const end = Object.fromEntries(axes.map(axis => [axis, base[group][axis] + (group === 'rotation' ? 360 : 2)]));
  track = context.tN(track, group, 120, end).track;
  interpolated.timeline.objectTracks.person = {...interpolated.timeline.objectTracks.person, ...plain(track)};
}
for (const group of ['position', 'rotation', 'scale']) {
  const result = recordObject(interpolated, group);
  for (const axis of axes) {
    const channel = group + '.' + axis;
    const keys = objectTrack(result.state)[channel];
    assert.deepEqual(plain(keys.map(key => key.frame)), [0, 60, 120]);
    assert.ok(Math.abs(keys[1].value - (base[group][axis] + (group === 'rotation' ? 180 : 1))) < 1e-7, 'Record the evaluated playhead value rather than the base transform');
    assert.deepEqual(plain([keys[0], keys[2]]), interpolated.timeline.objectTracks.person[channel]);
  }
}
for (const change of [{locked: true}, {kind: 'environment'}, {kind: 'world'}]) {
  const input = makeState();input.objects[0] = {...input.objects[0], ...change};
  const result = recordObject(input, 'position');
  assert.equal(result.state, input);
  assert.equal(result.events.writes, 0, 'Locked and non-transform objects reject recording before persistence');
}
const absent = makeState();
assert.equal(recordObject(absent, 'position', {id: 'missing'}).state, absent);
assert.equal(recordObject(absent, 'position', {workspace: 'staging'}).state, absent);
const pathLocked = recordObject(absent, 'rotation', {pathLocked: true});
assert.equal(pathLocked.events.writes, 0);
assert.deepEqual(pathLocked.events.notices, ['path-rotation-locked']);

const cameraRow = (group, id = 'scene-camera') => ({id: 'camera:' + id + ':' + group, kind: 'camera-group', cameraId: id, label: group, curve: {kind: 'camera-group', cameraId: id, group}});
const lensRow = channel => ({id: 'camera:scene-camera:' + channel, kind: 'camera-channel', cameraId: 'scene-camera', label: channel, cameraTrack: channel});
function recordCamera(input, row, frame = 60) {
  let state = input;
  let refs;
  const persist = createPersistence({R(update) {state = update(state);}, iH: {current: 'scene-camera'}, a_: {current: null}, a$: {current: undefined}});
  persist(projected => {
    const result = context.__localRecordCameraRowKeyframe(projected, row, frame);
    refs = result.refs;
    return result.state;
  }, 'test.manual-camera', row.cameraId);
  return {state, refs: plain(refs)};
}
const camTrack = (state, id = 'scene-camera') => state.multiCamera.cameras.find(camera => camera.id === id).tracks;
for (const row of [cameraRow('position'), cameraRow('target'), lensRow('lens.fov'), lensRow('lens.roll')]) {
  const input = makeState();
  const channels = plain(context.__localCameraRowChannels(row));
  assert.equal(channels.length, row.kind === 'camera-group' ? 3 : 1);
  const recorded = recordCamera(input, row);
  assert.equal(recorded.refs.length, channels.length);
  for (const channel of channels) {
    assert.deepEqual(plain(camTrack(recorded.state)[channel].map(key => key.frame)), [60]);
    assert.equal(recorded.refs.find(ref => ref.channel === channel).cameraId, 'scene-camera');
  }
  const repeated = recordCamera(recorded.state, row);
  assert.deepEqual(plain(camTrack(repeated.state)), plain(camTrack(recorded.state)), 'Repeated camera recording keeps existing key metadata');
  const untouched = cameraChannels.filter(channel => !channels.includes(channel));
  assert.ok(untouched.every(channel => camTrack(repeated.state)[channel].length === 0));
}
const secondaryBase = makeState();
const secondary = recordCamera(secondaryBase, cameraRow('position', 'camera-secondary'));
assert.deepEqual(plain(secondary.state.multiCamera.cameras[0]), secondaryBase.multiCamera.cameras[0], 'Recording an inactive camera cannot change the active output camera');
for (const axis of axes) assert.equal(camTrack(secondary.state, 'camera-secondary')['position.' + axis][0].value, secondaryBase.multiCamera.cameras[1].transform.position[axis]);
assert.ok(secondary.refs.every(ref => ref.cameraId === 'camera-secondary'));
assert.deepEqual(plain(secondary.state.sceneCamera), secondaryBase.sceneCamera);

for (const [field, row] of [['cameraLocked', cameraRow('position')], ['targetLocked', cameraRow('target')], ['cameraLocked', lensRow('lens.fov')]]) {
  const input = makeState();input.sceneCamera[field] = true;
  const result = context.__localRecordCameraRowKeyframe(input, row, 60);
  assert.equal(result.state, input);
  assert.deepEqual(plain(result.refs), []);
}
const cameraAnimated = makeState();
for (const [frame, value] of [[0, {x: 0, y: 2, z: 4}], [120, {x: 8, y: 6, z: 0}]]) {
  const values = Object.fromEntries(axes.map(axis => ['position.' + axis, value[axis]]));
  const result = context.eJ(cameraAnimated.sceneCamera, cameraAnimated.timeline.cameraTracks, frame, values);
  cameraAnimated.sceneCamera = result.camera;cameraAnimated.timeline.cameraTracks = result.tracks;
}
const cameraMid = context.__localRecordCameraRowKeyframe(cameraAnimated, cameraRow('position'), 60);
assert.deepEqual(plain(positionChannels.map(channel => cameraMid.state.timeline.cameraTracks[channel].find(key => key.frame === 60).value)), [4, 4, 2]);
assert.deepEqual(plain(context.__localCameraRowChannels({kind: 'object-action'})), []);

// Render the small button with the actual clock subscription and invoke its UI command.
context.i = {jsx: (type, props) => ({type, props}), jsxs: (type, props) => ({type, props})};
context.ok = (...values) => values.filter(Boolean).join(' ');
context.fO = {A: 'Diamond'};
context.lL = ({object}) => object?.id === 'path-controlled';
const clock = {subscribe() {}, getSnapshot: () => 2};
const playback = {subscribe() {}, getSnapshot: () => false};
const props = {row: {id: 'object:person:position', kind: 'object-group', object: person, objectGroup: 'position', label: 'Position'},
  clock, playback, editable: true, fps: 30, tracks: keyed.timeline.objectTracks, clips: [], onRecord() {}};
const findButton = node => !node ? undefined : node.type === 'button' ? node : Array.isArray(node) ? node.map(findButton).find(Boolean) : findButton(node.props?.children);
function button(overrides = {}) {
  return findButton(context.__LocalTimelineKeyButton({...props, ...overrides}));
}
const control = button();
assert.ok(control);
assert.equal(control.props['aria-pressed'], true);
assert.ok(control.props['aria-label'].includes('Person') && control.props['aria-label'].includes('Position'));
assert.equal(button({clock: {...clock, getSnapshot: () => 1}}).props['aria-pressed'], false, 'The key indicator follows the playhead');
assert.equal(button({editable: false}).props.disabled, true);
assert.equal(button({playback: {...playback, getSnapshot: () => true}}).props.disabled, true);
assert.equal(button({row: {...props.row, object: {...person, locked: true}}}).props.disabled, true);
assert.equal(button({row: {...props.row, objectGroup: 'rotation', object: {...person, id: 'path-controlled'}}}).props.disabled, true);
let calls = 0;
button({onRecord() {calls++;}}).props.onClick({preventDefault() {}, stopPropagation() {}});
assert.equal(calls, 1, 'The row button invokes a single manual recording command');
assert.equal(button({row: {kind: 'object-action'}}), undefined);
console.log('Manual timeline keyframes passed: evaluated object/camera keys, idempotent recording, metadata, existing toggle behavior, locks, inactive cameras, and clock-aware row controls.');
