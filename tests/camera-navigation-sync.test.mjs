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
require('../src/patches/camera-navigation-sync.cjs')(factories);
const source = factories['53401'];
new vm.Script('(' + source + ')');
const ast = parser.parse('(' + source + ')');
const callbacks = {};
let livePreviewSource;
traverse(ast, {VariableDeclarator(path) {
  if (!['cA', 'cw', 'cx', 'sQ'].includes(path.node.id.name) || path.node.init?.type !== 'CallExpression') return;
  const code = source.slice(path.node.init.start - 1, path.node.init.end - 1);
  if (!code.startsWith('(0,n.useCallback)')) return;
  assert.equal(callbacks[path.node.id.name], undefined, 'One production callback for ' + path.node.id.name);
  callbacks[path.node.id.name] = code;
}, ObjectProperty(path) {
  if (path.node.key.name === 'onSceneCameraNavigationPreview' && path.node.value.type === 'ArrowFunctionExpression') {
    assert.equal(livePreviewSource, undefined);
    livePreviewSource = source.slice(path.node.value.start - 1, path.node.value.end - 1);
  }
}});
assert.ok(livePreviewSource);
for (const name of ['cA', 'cw', 'cx', 'sQ']) assert.ok(callbacks[name], 'Extract the real ' + name + ' callback');
const axes = ['x', 'y', 'z'];
const positionChannels = axes.map(axis => 'position.' + axis);
const targetChannels = axes.map(axis => 'target.' + axis);
const spatialChannels = [...positionChannels, ...targetChannels];
const channels = [...spatialChannels, 'lens.fov', 'lens.roll'];
const context = vm.createContext({
  crypto: {randomUUID}, Date, structuredClone,
  i: {jsx: (type, props) => ({type, props})},
  n: {useCallback: callback => callback, useSyncExternalStore: (_subscribe, snapshot) => snapshot()},
  eH: channels, eB: positionChannels, eG: targetChannels, e$: [positionChannels, targetChannels],
  l7: positionChannels, l6: targetChannels, em: axes, ep: Math.PI / 180, eg: 180 / Math.PI,
  oL: (value, minimum, maximum) => Math.max(minimum, Math.min(maximum, value)),
  tC: 'scene-camera', tI: 'shot-camera::', tQ: 'Camera', tq: new Set(['scene-camera']),
  so: {cj9: THREE.MathUtils, Pq0: THREE.Vector3, PTz: THREE.Quaternion, O9p: THREE.Euler},
});
for (const node of ast.program.body[0].expression.body.body)
  if (node.type === 'FunctionDeclaration') vm.runInContext(source.slice(node.start - 1, node.end - 1), context);
vm.runInContext(`this.createCameraNavigation = function(bindings) {
  const {R,iH,a_,a$,Q,iT,od,ej,ek,iK,e$,tZ,sr,C,am,rC,il,o3,iO,t8,ah,sa,sn,cO,__localNavigationPreview}=bindings;
  const sQ=${callbacks.sQ};
  const cx=${callbacks.cx};
  const cA=${callbacks.cA};
  const cw=${callbacks.cw};
  return {settle:cA, fov:cw, commit:cx, preview:${livePreviewSource}};
};`, context);
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
  second.target.position = {x: 3, y: 1, z: 2};
  return {objects: [], sceneCamera, camera: {position: {x: 15, y: 12, z: 9}},
    timeline: {displayFps: 30, durationSec: 20, clips: [], objectTracks: {}, cameraTracks},
    multiCamera: {...plain(migrated.document), cameras: [first, second]}};
};
const selectedCamera = (state, id = 'scene-camera') => state.multiCamera.cameras.find(camera => camera.id === id);
const tracks = (state, id) => selectedCamera(state, id).tracks;
const sample = (state, frame, id = 'scene-camera') => {
  const camera = selectedCamera(state, id);
  return plain(context.eK(context.t0(camera), camera.tracks).sample(frame));
};
function navigation(input, options = {}) {
  let state = input, playing = options.playing ?? false, draft = {dirty: true};
  const frame = options.frame ?? 60;
  const selectedId = options.selectedId ?? 'scene-camera';
  const visibleId = options.visibleId === undefined ? selectedId : options.visibleId;
  const document = context.oE(input);
  const displayed = options.displayed ?? sample(input, frame, visibleId || selectedId);
  const reasons = [], notices = [], stops = [], drafts = [];
  const previewStore = context.__localCreateCameraNavigationPreviewStore();
  const api = context.createCameraNavigation({
    R(updater, reason) {state = updater(state); reasons.push(reason);},
    iH: {current: selectedId}, a_: {current: null}, a$: {current: undefined},
    Q: {timelineCameraPlaybackLocked: 'playback-locked', timelineCameraSelectPart: 'select-camera-part'},
    iT: notice => notices.push(notice), od: null, ej: options.workspace ?? 'performance',
    ek: {current: frame / input.timeline.displayFps}, iK: input,
    e$: {current: options.mounted ?? true}, tZ: {getSnapshot: () => playing}, sr: displayed,
    C: options.editable ?? true, am: options.preview ?? true, rC: options.pose ?? null,
    il: options.empty ? {...document, cameras: [], outputCameraId: ''} : document,
    o3: {activeCameraId: visibleId}, iO: selectedId,
    t8(active) {playing = active; stops.push(active);},
    ah(update) {draft = typeof update === 'function' ? update(draft) : update; drafts.push(draft);},
    sa: 'test-camera-owner', sn: displayed, cO: options.picker ?? false,
    __localNavigationPreview: previewStore,
  });
  return {api, reasons, notices, stops, drafts, displayed, previewStore,
    get state() {return state;}, get draft() {return draft;},
    settle(patch = {}) {return api.settle({...clone(displayed), ...clone(patch)});}};
}
const baseline = makeState();
const baselineSnapshot = clone(baseline);
const destination = {x: 6, y: 3, z: -2};
const aimedAt = {x: 2, y: 4, z: -7};

const initial = navigation(baseline, {frame: 0});
initial.settle({position: destination, target: aimedAt});
assert.deepEqual(sample(initial.state, 0).position, destination);
assert.deepEqual(sample(initial.state, 0).target, aimedAt);
assert.ok(channels.every(channel => tracks(initial.state)[channel].length === 0), 'Unkeyed frame zero changes the initial camera composition');
assert.deepEqual(initial.reasons, ['director.scene-camera.view']);
assert.equal(initial.draft, null, 'A persisted gesture clears the obsolete draft');
assert.deepEqual(plain(initial.state.camera), baseline.camera, 'Shot authoring never changes free director navigation');

const moving = navigation(baseline, {frame: 60, playing: true});
moving.settle({position: destination, target: aimedAt});
assert.deepEqual(moving.stops, [false], 'Gesture completion stops playback before writing the camera');
assert.deepEqual(moving.notices, []);
assert.deepEqual(moving.reasons, ['director.scene-camera.view'], 'One settled navigation gesture is one undo entry');
for (const channel of spatialChannels) {
  const [group, axis] = channel.split('.');
  assert.deepEqual(plain(tracks(moving.state)[channel].map(key => [key.frame, key.value])),
    [[0, baseline.sceneCamera[group][axis]], [60, (group === 'position' ? destination : aimedAt)[axis]]]);
}
assert.deepEqual(sample(moving.state, 0).position, baseline.sceneCamera.position);
assert.deepEqual(sample(moving.state, 60).position, destination);
assert.deepEqual(sample(moving.state, 60).target, aimedAt);
assert.deepEqual(sample(moving.state, 90).target, aimedAt, 'The authored angle holds after the final key');
assert.deepEqual(baseline, baselineSnapshot, 'Camera navigation does not mutate the undo snapshot');

const sameFrame = navigation(moving.state, {frame: 60});
sameFrame.settle({position: {x: 8, y: 5, z: -4}, target: {x: -1, y: 3, z: -8}});
for (const channel of spatialChannels) {
  const before = tracks(moving.state)[channel], after = tracks(sameFrame.state)[channel];
  assert.equal(after.length, 2);
  assert.equal(after[1].id, before[1].id);
  assert.equal(after[1].createdAt, before[1].createdAt);
  assert.deepEqual(plain(after[0]), plain(before[0]));
}
const yawPitch = navigation(baseline);
const gestureView = {...plain(context.oN(yawPitch.displayed)), x: 7, y: 5, z: 2, yaw: 42, pitch: -12};
yawPitch.api.settle(context.oD(yawPitch.displayed, gestureView));
const savedView = context.oN(sample(yawPitch.state, 60));
assert.ok(Math.abs(savedView.yaw - 42) < 1e-7 && Math.abs(savedView.pitch + 12) < 1e-7,
  'The gesture position and mouse yaw/pitch survive conversion through authored target coordinates');

const visible = navigation(baseline, {selectedId: 'scene-camera', visibleId: 'camera-secondary'});
visible.settle({position: destination, target: aimedAt});
assert.deepEqual(plain(selectedCamera(visible.state)), selectedCamera(baseline), 'A visible layered camera cannot overwrite the separately selected camera');
assert.deepEqual(sample(visible.state, 0, 'camera-secondary').position, {x: 12, y: 4, z: -6});
assert.deepEqual(sample(visible.state, 60, 'camera-secondary').position, destination);
assert.deepEqual(sample(visible.state, 60, 'camera-secondary').target, aimedAt);
assert.deepEqual(plain(visible.state.sceneCamera), baseline.sceneCamera, 'The output-camera legacy projection stays on the original output camera');
const fallback = navigation(baseline, {selectedId: 'camera-secondary', visibleId: null});
fallback.settle({position: destination});
assert.deepEqual(sample(fallback.state, 60, 'camera-secondary').position, destination, 'A missing sampled ID falls back to the selected camera');

for (const [lock, lockedGroup, movingGroup] of [['cameraLocked', 'position', 'target'], ['targetLocked', 'target', 'position']]) {
  const input = makeState();
  selectedCamera(input).authoring[lock] = true;
  const locked = navigation(input);
  locked.settle({position: destination, target: aimedAt, cameraLocked: false, targetLocked: false,
    aspectRatio: '1:1', cameraHelperVisible: false, targetHelperVisible: false});
  assert.deepEqual(sample(locked.state, 60)[lockedGroup], sample(input, 60)[lockedGroup], lock + ' protects its authored coordinates');
  assert.deepEqual(sample(locked.state, 60)[movingGroup], movingGroup === 'position' ? destination : aimedAt);
  assert.ok(axes.every(axis => tracks(locked.state)[lockedGroup + '.' + axis].length === 0));
  assert.equal(selectedCamera(locked.state).authoring[lock], true, 'Gesture payloads cannot remove authoring locks');
  assert.equal(selectedCamera(locked.state).lens.aspectRatio, selectedCamera(input).lens.aspectRatio);
  assert.equal(selectedCamera(locked.state).authoring.cameraHelperVisible, selectedCamera(input).authoring.cameraHelperVisible);
  assert.equal(selectedCamera(locked.state).authoring.targetHelperVisible, selectedCamera(input).authoring.targetHelperVisible);
}

for (const [label, options] of [
  ['free director view', {preview: false}], ['read-only project', {editable: false}],
  ['pose edit session', {pose: {objectId: 'actor'}}], ['no cameras', {empty: true}],
  ['unmounted editor', {mounted: false}],
  ['deleted sampled camera', {visibleId: 'missing-camera', displayed: sample(baseline, 60)}],
]) {
  const denied = navigation(baseline, options);
  denied.settle({position: destination, target: aimedAt});
  assert.equal(denied.state, baseline, label + ' cannot write camera state');
  assert.deepEqual(denied.reasons, []);
}
const unchanged = navigation(moving.state);
unchanged.settle();
assert.deepEqual(unchanged.reasons, [], 'A no-op gesture creates no history entry');

const lens = navigation(baseline);
lens.api.fov(70);
assert.equal(sample(lens.state, 60).fov, 70, 'The camera overlay FOV control uses the same persisted route');
assert.ok(channels.every(channel => tracks(lens.state)[channel].length === 0), 'Unkeyed lens settings retain their static behavior');
const keyedLens = makeState();
tracks(keyedLens)['lens.fov'] = [{id: 'fov-baseline', frame: 0, value: 50, interpolation: 'linear', createdAt: '2026-10-13'}];
const animatedLens = navigation(keyedLens);
animatedLens.api.fov(75);
assert.deepEqual(plain(tracks(animatedLens.state)['lens.fov'].map(key => [key.frame, key.value])), [[0, 50], [60, 75]]);
assert.ok(spatialChannels.every(channel => tracks(animatedLens.state)[channel].length === 0));

// The explicit destination survives every branch of the existing commit callback.
const staging = navigation(baseline, {workspace: 'staging', selectedId: 'scene-camera', visibleId: 'camera-secondary'});
staging.settle({position: destination});
assert.deepEqual(sample(staging.state, 0, 'camera-secondary').position, destination);
assert.ok(channels.every(channel => tracks(staging.state, 'camera-secondary')[channel].length === 0));
assert.deepEqual(plain(selectedCamera(staging.state)), selectedCamera(baseline));
const helper = navigation(baseline, {visibleId: 'camera-secondary'});
helper.api.commit({...clone(helper.displayed), cameraHelperVisible: false}, 'director.scene-camera.helper', 'camera-secondary');
assert.equal(selectedCamera(helper.state, 'camera-secondary').authoring.cameraHelperVisible, false);
assert.deepEqual(plain(selectedCamera(helper.state)), selectedCamera(baseline));

// The live store drives only the inspector. It must not replace the viewport's
// canonical state, which would cancel a held navigation gesture on every frame.
const store = context.__localCreateCameraNavigationPreviewStore();
assert.equal(store.getSnapshot(), null);
const notifications = [];
const unsubscribe = store.subscribe(() => notifications.push(store.getSnapshot()));
const snapshot = {ownerKey: 'owner-a', cameraId: 'camera-secondary', camera: {...sample(baseline, 60, 'camera-secondary'), position: destination}};
store.publish(snapshot);
assert.equal(store.getSnapshot(), snapshot);
assert.deepEqual(notifications, [snapshot]);
store.publish(snapshot);
assert.equal(notifications.length, 1, 'Publishing the identical snapshot creates no redundant inspector render');
const inspectorState = {sceneCamera: sample(baseline, 60), objects: baseline.objects, timeline: baseline.timeline};
const inspectorProps = {state: inspectorState, selectedSceneCameraPart: 'camera', cameraReconciliationOwner: 'canonical-owner',
  onChange() {}, navigationPreview: {store, ownerKey: 'owner-a', cameraId: 'camera-secondary', active: true}};
const inspector = context.__LocalCameraNavigationInspector(inspectorProps);
assert.equal(inspector.type, context.pg, 'The wrapper keeps the production inspector');
assert.equal(inspector.props.state.sceneCamera, snapshot.camera, 'The property panel displays the live gesture camera');
assert.equal(inspector.props.state.objects, inspectorState.objects);
assert.equal(inspector.props.state.timeline, inspectorState.timeline);
assert.equal(inspector.props.onChange, inspectorProps.onChange);
assert.notEqual(inspector.props.state, inspectorState);
assert.deepEqual(inspectorState.sceneCamera, sample(baseline, 60), 'Live property values never mutate the canonical viewport state');
for (const override of [{active: false}, {ownerKey: 'other-frame-or-workspace'}, {cameraId: 'scene-camera'}]) {
  const stale = context.__LocalCameraNavigationInspector({...inspectorProps,
    navigationPreview: {...inspectorProps.navigationPreview, ...override}});
  assert.equal(stale.props.state, inspectorState, 'Inactive or stale camera snapshots cannot leak into another inspector');
}
store.clear();
assert.equal(store.getSnapshot(), null);
assert.equal(notifications.length, 2);
assert.equal(context.__LocalCameraNavigationInspector(inspectorProps).props.state, inspectorState);
store.clear(); assert.equal(notifications.length, 2);
unsubscribe(); store.publish(snapshot);
assert.equal(notifications.length, 2, 'Unmounted subscribers receive no later camera updates');

const live = navigation(baseline, {visibleId: 'camera-secondary'});
const liveCamera = {...clone(live.displayed), position: destination, target: aimedAt};
live.api.preview(liveCamera);
assert.equal(live.state, baseline);
assert.deepEqual(live.reasons, [], 'Held WASD/mouse preview creates no history entries or keyframes');
assert.deepEqual(live.stops, []);
assert.equal(live.previewStore.getSnapshot().cameraId, 'camera-secondary');
assert.deepEqual(plain(live.previewStore.getSnapshot().camera.position), destination);
live.api.settle(liveCamera);
assert.equal(live.reasons.length, 1, 'Only gesture completion commits a camera history entry');
assert.equal(live.previewStore.getSnapshot(), null, 'Committed camera values replace and clear the transient inspector snapshot');
for (const options of [{preview: false}, {editable: false}, {pose: {}}, {picker: true}, {empty: true}]) {
  const denied = navigation(baseline, options);
  denied.api.preview({...clone(denied.displayed), position: destination});
  assert.equal(denied.previewStore.getSnapshot(), null, 'Restricted contexts cannot publish misleading live camera values');
}
const lockedPreviewState = makeState();
selectedCamera(lockedPreviewState).authoring.cameraLocked = true;
selectedCamera(lockedPreviewState).authoring.targetLocked = true;
const lockedPreview = navigation(lockedPreviewState);
lockedPreview.api.preview({...clone(lockedPreview.displayed), position: destination, target: aimedAt});
assert.deepEqual(plain(lockedPreview.previewStore.getSnapshot().camera.position), lockedPreview.displayed.position);
assert.deepEqual(plain(lockedPreview.previewStore.getSnapshot().camera.target), lockedPreview.displayed.target);

console.log('Camera navigation sync passed: actual settled callback/persistence, frame-zero composition, auto-keys, yaw/pitch, stable key IDs, visible-camera targeting, locks, guards, FOV, explicit camera routing and isolated live inspector previews.');
