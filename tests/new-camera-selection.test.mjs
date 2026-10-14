import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import {randomUUID} from 'node:crypto';
import {createRequire} from 'node:module';

const require = createRequire(import.meta.url);
const factories = JSON.parse(await fs.readFile(new URL('../src/vendor/module-factories.json', import.meta.url), 'utf8'));
for (const name of ['camera-cut-sequencer', 'empty-cameras', 'new-camera-selection']) require('../src/patches/' + name + '.cjs')(factories);
const source = factories['53401'];
new vm.Script('(' + source + ')');
const ast = require('@babel/parser').parse('(' + source + ')');
const extract = node => source.slice(node.start - 1, node.end - 1);
const callbacks = {};
let insertSource, presets;
require('@babel/traverse').default(ast, {
  ObjectProperty(path) {
    if (path.node.key.name === 'onInsertStoryboardClip' && path.node.value.type === 'ArrowFunctionExpression') insertSource = extract(path.node.value);
  },
  VariableDeclarator(path) {
    const name = path.node.id.name, code = extract(path.node.init || path.node);
    if (['ny', 'sQ', 'sq', 'cI'].includes(name) && code.startsWith('(0,n.useCallback)')) {
      assert.equal(callbacks[name], undefined); callbacks[name] = code;
    }
    if (name === 'tJ' && path.node.init?.type === 'ArrayExpression') presets = extract(path.node.init);
  },
});
for (const name of ['ny', 'sQ', 'sq', 'cI']) assert.ok(callbacks[name]);
assert.ok(insertSource && presets);
const axes = ['x', 'y', 'z'];
const position = axes.map(axis => 'position.' + axis), target = axes.map(axis => 'target.' + axis);
const channels = [...position, ...target, 'lens.fov', 'lens.roll'];
const context = vm.createContext({crypto: {randomUUID}, Date, structuredClone, n: {useCallback: fn => fn},
  eH: channels, eB: position, eG: target, e$: [position, target],
  em: axes, ep: Math.PI / 180, eg: 180 / Math.PI, tW: axes,
  tj: ['position', 'rotation', 'scale'].flatMap(group => axes.map(axis => group + '.' + axis)),
  tC: 'scene-camera', tI: 'shot-camera::', tQ: 'Camera', tq: new Set(['scene-camera']), lH: Object.freeze({})});
for (const node of ast.program.body[0].expression.body.body)
  if (node.type === 'FunctionDeclaration') vm.runInContext(extract(node), context);
context.tJ = vm.runInContext(presets, context);
vm.runInContext(`this.createWorkspace = bindings => {
  const {C,rC,cO,ii,a2,iK,cQ,dN,nP,rr,re,iT,iH,id,ib,al,de,cP,R,a_,a$,iE,a6,Q}=bindings;
  const il=oE(iK);
  const ny=${callbacks.ny}, sQ=${callbacks.sQ}, sq=${callbacks.sq}, cI=${callbacks.cI};
  return {insert:${insertSource}, addPreset:cI, commit:sQ};
};`, context);
const plain = value => JSON.parse(JSON.stringify(value));
const clone = value => structuredClone(plain(value));
const createdAt = '2026-10-13T01:00:00.000Z';
const makeState = (empty = false) => {
  const sceneCamera = plain(context.tF()), cameraTracks = plain(context.eU(sceneCamera));
  const document = plain(context.tZ({kind: 'legacy-singular', sceneCamera, cameraTracks}).document);
  if (empty) {document.cameras = []; document.outputCameraId = '';}
  else for (const channel of channels) document.cameras[0].tracks[channel] = [
    {id: 'old-' + channel + '-0', frame: 0, value: context.eZ(sceneCamera, channel), interpolation: 'linear', createdAt},
    {id: 'old-' + channel + '-120', frame: 120, value: context.eZ(sceneCamera, channel) + 1, interpolation: 'linear', createdAt},
  ];
  return {sceneCamera, objects: [{id: 'actor', name: 'Actor'}], multiCamera: document,
    timeline: {displayFps: 30, durationSec: 20, clips: [], objectTracks: {}, cameraTracks,
      cameraCutTrack: {version: 1, clips: empty ? [] : [{id: 'old-shot', cameraId: 'scene-camera', startFrame: 0, endFrame: 157, createdAt}]}}};
};
function workspace(input, overrides = {}) {
  let state = input, preview = {kind: 'storyboard'}, output = {kind: 'storyboard'}, session = {activePreviewCameraId: input.multiCamera.outputCameraId};
  let controlled = false, objectSelection = ['actor'], cameraSelection = [], selectedPart;
  const events = [], notices = [], reasons = [];
  const iH = {current: session.activePreviewCameraId};
  const api = context.createWorkspace({C: true, rC: null, cO: false,
    ii: {x: 8, y: 4, z: 6, yaw: -35, pitch: -18, fov: 50}, a2: '16:9', iK: state,
    cQ() {events.push('cancel-picker');}, dN() {events.push('stop');},
    nP(time) {events.push(['seek', time]);},
    rr(value) {preview = plain(value); events.push(['preview', preview]);}, re(value) {output = plain(value);}, iT(value) {notices.push(value);},
    iH, id(value) {session = plain(value);}, ib(update) {update(null);}, al(value) {selectedPart = value;},
    de(value) {selectedPart = value; objectSelection = []; cameraSelection = [iH.current]; events.push(['select-part', value, iH.current]);},
    cP() {controlled = true; events.push(['control', iH.current]);},
    R(update, reason) {state = update(state); reasons.push(reason);}, a_: {current: null}, a$: {current: undefined},
    iE(value) {objectSelection = [...value.selectedObjectIds];}, a6(value) {cameraSelection = [...value];},
    Q: {multiCameraGeneratedCameraName: 'Camera', cameraShotPresetLabels: {'current-view': 'Current view', 'front-medium': 'Front medium', 'over-shoulder': 'Over shoulder'}},
    ...overrides,
  });
  return {api, events, notices, reasons, iH,
    get state() {return state;}, get preview() {return preview;}, get output() {return output;},
    get controlled() {return controlled;}, get session() {return session;},
    get objectSelection() {return objectSelection;}, get cameraSelection() {return cameraSelection;}, get selectedPart() {return selectedPart;}};
}
const request = {newCamera: true, startFrame: 71, durationFrames: 60};
for (const empty of [false, true]) {
  const before = makeState(empty), snapshot = clone(before), view = workspace(before, {cO: true});
  assert.equal(view.api.insert(request), true);
  const added = view.state.multiCamera.cameras.find(camera => !before.multiCamera.cameras.some(old => old.id === camera.id));
  assert.ok(added);
  assert.deepEqual(view.preview, {kind: 'camera', cameraId: added.id}, 'Creating a camera previews that camera, even beneath an overlapping upper shot');
  assert.deepEqual(view.output, {kind: 'storyboard'}, 'Editing a new camera must not change export to a single camera');
  assert.equal(view.session.activePreviewCameraId, added.id);
  assert.equal(view.iH.current, added.id, 'Immediate authoring targets the new camera before the next React render');
  assert.equal(view.controlled, true);
  assert.equal(view.selectedPart, 'camera');
  assert.deepEqual(view.objectSelection, []);
  assert.deepEqual(view.cameraSelection, [added.id]);
  assert.deepEqual(view.events.find(event => Array.isArray(event) && event[0] === 'seek'), ['seek', 71 / 30]);
  assert.ok(channels.every(channel => added.tracks[channel].length === 0), 'New cameras do not inherit an existing camera animation');
  assert.deepEqual(plain(added.transform.position), {x: 8, y: 4, z: 6});
  if (!empty) {
    assert.deepEqual(plain(view.state.multiCamera.cameras[0]), before.multiCamera.cameras[0], 'Creation preserves the old camera pose and every manual key');
    assert.equal(context.__localActiveLayerShot(view.state.timeline.cameraCutTrack, view.state.multiCamera.cameras.map(camera => camera.id), 71).cameraId,
      'scene-camera', 'The regression reproduces an upper camera covering the new shot in the exported sequence');
  }
  const resolved = context.cr({source: view.preview, document: view.state.multiCamera, storyboard: view.state.timeline.cameraCutTrack,
    timelineDurationSec: 20, displayFps: 30});
  assert.equal(resolved.cameraId, added.id, 'The actual preview resolver bypasses the covered storyboard camera while editing');
  view.api.commit(projected => ({...projected, sceneCamera: {...projected.sceneCamera, position: {x: 17, y: 5, z: 4}}}), 'test.adjust-created-camera');
  assert.deepEqual(plain(view.state.multiCamera.cameras.find(camera => camera.id === added.id).transform.position), {x: 17, y: 5, z: 4});
  if (!empty) assert.deepEqual(plain(view.state.multiCamera.cameras[0]), before.multiCamera.cameras[0], 'The next default authoring commit cannot alter the old selected camera');
  assert.deepEqual(before, snapshot, 'Creating/editing a new camera never mutates the preceding history snapshot');
}

for (const preset of [
  {kind: 'current-view', presetId: 'current-view'},
  {kind: 'target', presetId: 'front-medium', target: {objectId: 'actor', center: {x: 1, y: 1, z: 2}, height: 1.8, yawDegrees: 0}},
  {kind: 'over-shoulder', presetId: 'over-shoulder', foregroundTarget: {objectId: 'actor', center: {x: 0, y: .9, z: 0}, height: 1.8, yawDegrees: 0}, targetPoint: {x: 0, y: .9, z: 4}},
]) {
  const before = makeState(), view = workspace(before);
  assert.equal(view.api.addPreset(preset), true, preset.presetId + ' creation succeeds');
  const added = view.state.multiCamera.cameras.at(-1);
  assert.deepEqual(view.preview, {kind: 'camera', cameraId: added.id});
  assert.deepEqual(view.output, {kind: 'storyboard'});
  assert.equal(view.controlled, true, 'The asset/preset creation entrance also enters the new camera control view');
  assert.deepEqual(view.objectSelection, []);
  assert.deepEqual(view.cameraSelection, [added.id]);
  assert.ok(channels.every(channel => added.tracks[channel].length === 0));
  assert.deepEqual(plain(view.state.multiCamera.cameras[0]), before.multiCamera.cameras[0]);
}
for (const options of [{C: false}, {rC: {kind: 'pose'}}]) {
  const before = makeState(), view = workspace(before, options);
  assert.equal(view.api.insert(request).ok, false);
  assert.equal(view.state, before); assert.equal(view.controlled, false); assert.deepEqual(view.events, []);
}
const invalid = workspace(makeState(), {cO: true});
assert.equal(invalid.api.insert({...request, startFrame: 900}).ok, false);
assert.equal(invalid.controlled, false); assert.deepEqual(invalid.events, []);
const existing = workspace(makeState());
assert.equal(existing.api.insert({cameraId: 'scene-camera', startFrame: 180, durationFrames: 30}), true);
assert.deepEqual(existing.preview, {kind: 'storyboard'}, 'Existing-camera shot insertion retains its established sequence preview behavior');
assert.equal(existing.state.multiCamera.cameras.length, 1);

console.log('New camera selection passed: overlapping shot editing, first camera, asset/preset entrances, distinct empty tracks, immediate authoring identity, unchanged export sequence and guarded failures.');
