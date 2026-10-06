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
require('../src/patches/camera-cut-sequencer.cjs')(factories);
require('../src/patches/empty-cameras.cjs')(factories);
const source = factories['53401'];
new vm.Script('(' + source + ')');
const ast = parser.parse('(' + source + ')');
let persistenceSource, deletionSource;
traverse(ast, {VariableDeclarator(path) {
  const code = source.slice(path.node.start - 1, path.node.end - 1);
  if (path.node.id.name === 'sQ' && code.includes('explicitCameraId')) persistenceSource = code.slice(code.indexOf('=') + 1);
  if (path.node.id.name === 'c4' && code.includes('__localDeleteCameraInState')) deletionSource = code.slice(code.indexOf('=') + 1);
}});
assert.ok(persistenceSource && deletionSource);
const axes = ['x', 'y', 'z'];
const positionChannels = axes.map(axis => 'position.' + axis);
const targetChannels = axes.map(axis => 'target.' + axis);
const channels = [...positionChannels, ...targetChannels, 'lens.fov', 'lens.roll'];
const transformChannels = ['position', 'rotation', 'scale'].flatMap(group => axes.map(axis => group + '.' + axis));
const context = vm.createContext({
  crypto: {randomUUID}, Date, structuredClone,
  n: {useCallback: callback => callback},
  eH: channels, eB: positionChannels, eG: targetChannels, e$: [positionChannels, targetChannels],
  tj: transformChannels, em: axes, ep: Math.PI / 180, eg: 180 / Math.PI,
  tC: 'scene-camera', tI: 'shot-camera::', tQ: 'Camera', tq: new Set(['scene-camera']),
  nt: 'staging-main', ag: {},
  so: {cj9: THREE.MathUtils, Pq0: THREE.Vector3, PTz: THREE.Quaternion, O9p: THREE.Euler},
});
for (const node of ast.program.body[0].expression.body.body) {
  if (node.type === 'FunctionDeclaration') vm.runInContext(source.slice(node.start - 1, node.end - 1), context);
  if (node.type === 'VariableDeclaration') for (const entry of node.declarations) {
    if (['ig', 'tv', 'tW', 'tK', 'kt', 'kr', 'ku', 'km', 'iI', 'iM', 'tw', 'kN'].includes(entry.id.name)) {
      vm.runInContext(source.slice(entry.start - 1, entry.end - 1), context);
    }
  }
}
vm.runInContext(`this.createCameraDeletion=function(bindings){
  const {R,iH,iK,id,ib,a7,a6,al,iT,Q}=bindings;
  const a_={current:null},a$={current:undefined};
  const sQ=${persistenceSource};
  return ${deletionSource};
}`, context);
const plain = value => JSON.parse(JSON.stringify(value));
const clone = value => structuredClone(plain(value));
const emptyDocument = {schemaVersion: 3, cameras: [], outputCameraId: ''};
const makeState = () => {
  const state = plain(context.iw());
  state.camera = {position: {x: 15, y: 12, z: 9}};
  const migrated = context.tZ({kind: 'legacy-singular', sceneCamera: state.sceneCamera, cameraTracks: state.timeline.cameraTracks});
  assert.equal(migrated.ok, true);
  const first = plain(migrated.document.cameras[0]);
  first.tracks['position.x'] = [{id: 'first-key', frame: 20, value: 9, interpolation: 'linear', createdAt: '2026-09-23'}];
  const second = {...clone(first), id: 'camera-second', name: 'Second camera'};
  second.transform.position = {x: 12, y: 4, z: -6};
  second.tracks['position.x'] = [{id: 'second-key', frame: 40, value: 25, interpolation: 'hold', createdAt: '2026-09-23'}];
  const third = {...clone(first), id: 'camera-third', name: 'Third camera'};
  third.transform.position = {x: -8, y: 5, z: 4};
  state.multiCamera = {...plain(migrated.document), cameras: [first, second, third]};
  state.timeline.cameraTracks = clone(first.tracks);
  state.timeline.cameraCutTrack = {version: 1, clips: [
    {id: 'cut-first', cameraId: first.id, startFrame: 0, endFrame: 30, createdAt: '2026-09-23'},
    {id: 'cut-second', cameraId: second.id, startFrame: 60, endFrame: 90, enabled: false, createdAt: '2026-09-23'},
    {id: 'cut-third', cameraId: third.id, startFrame: 120, endFrame: 150, createdAt: '2026-09-23'},
    {id: 'cut-first-again', cameraId: first.id, startFrame: 180, endFrame: 210, createdAt: '2026-09-23'},
  ]};
  state.selectionGroups = [
    {id: 'group-mixed', name: 'Mixed', objectIds: ['actor-a', 'actor-b', 'shot-camera::scene-camera']},
    {id: 'group-pair', name: 'Pair', objectIds: ['actor-a', 'shot-camera::scene-camera']},
    {id: 'group-other', name: 'Other', objectIds: ['actor-a', 'shot-camera::camera-second']},
  ];
  return state;
};

assert.deepEqual(plain(context.tX(JSON.stringify(emptyDocument))), {ok: true, document: emptyDocument});
assert.deepEqual(plain(context.tX({...emptyDocument, schemaVersion: 2})), {ok: true, document: emptyDocument});
for (const invalid of [{...emptyDocument, outputCameraId: 'missing'}, {...emptyDocument, cameras: null}, {...emptyDocument, outputCameraId: null}]) {
  assert.equal(context.tX(invalid).ok, false, 'An empty document has exactly one valid empty output identifier');
}
assert.equal(context.t_(emptyDocument).ok, true);
assert.equal(context.t_(emptyDocument, 'missing').ok, false);
assert.equal(context.t_(makeState().multiCamera, '').ok, false);
assert.deepEqual(plain(context.tZ({kind: 'canonical', document: emptyDocument}).initialSession), {schemaVersion: 1, activePreviewCameraId: ''});
const legacy = makeState();delete legacy.multiCamera;
assert.equal(context.oE(legacy).cameras.length, 1, 'Older singular-camera projects continue to migrate');
const emptyState = {...makeState(), multiCamera: emptyDocument};
assert.deepEqual(plain(context.oE(emptyState)), emptyDocument, 'An explicit empty collection never falls back to the legacy camera');
const projected = context.oH(emptyState, emptyDocument);
assert.ok(channels.every(channel => projected.timeline.cameraTracks[channel].length === 0));
assert.deepEqual(plain(projected.sceneCamera), emptyState.sceneCamera);
assert.deepEqual(plain(projected.camera), emptyState.camera, 'Free director navigation is independent of shot cameras');
for (const requested of [{kind: 'camera', cameraId: 'deleted'}, {kind: 'storyboard'}]) {
  const resolved = context.cr({document: emptyDocument, source: requested,
    storyboard: emptyState.timeline.cameraCutTrack, displayFps: 30, timelineDurationSec: 20});
  assert.equal(resolved.cameraAvailable, false);
  assert.equal(resolved.cameraId, '');
  assert.equal(resolved.storyboardAvailable, false);
  assert.equal(resolved.durationSec, 20);
}

function remove(input, ids, activeCameraId = input.multiCamera.outputCameraId) {
  let state = input;
  const history = [], notices = [];
  let session = {schemaVersion: 1, activePreviewCameraId: activeCameraId};
  let selection = [activeCameraId], part = 'camera', split;
  const current = {current: activeCameraId};
  const callback = context.createCameraDeletion({
    R(updater, reason) {history.push({before: state, reason});state = updater(state);},
    iH: current, iK: context.oO(input, context.oE(input), activeCameraId),
    id: next => {session = next;}, ib: updater => {split = updater(split);},
    a7: selection, a6: next => {selection = next;}, al: next => {part = next;},
    iT: notice => notices.push(notice), Q: {deleted: 'deleted'},
  });
  return {accepted: callback(ids), get state() {return state;}, history, notices,
    get session() {return session;}, get selection() {return selection;}, get part() {return part;},
    undo() {state = history.at(-1).before;}};
}
const original = makeState(), originalSnapshot = clone(original);
const removed = remove(original, 'scene-camera');
assert.equal(removed.accepted, true);
assert.deepEqual(plain(removed.state.multiCamera.cameras.map(camera => camera.id)), ['camera-second', 'camera-third']);
assert.equal(removed.state.multiCamera.outputCameraId, 'camera-second');
assert.deepEqual(plain(removed.state.timeline.cameraCutTrack.clips), original.timeline.cameraCutTrack.clips.slice(1, 3), 'Deleting a camera removes its cuts without shifting surviving gaps or enabled metadata');
assert.deepEqual(plain(removed.state.timeline.cameraTracks), original.multiCamera.cameras[1].tracks);
assert.deepEqual(plain(removed.state.selectionGroups), [
  {...original.selectionGroups[0], objectIds: ['actor-a', 'actor-b']}, original.selectionGroups[2],
]);
assert.deepEqual(plain(removed.state.multiCamera.cameras), original.multiCamera.cameras.slice(1));
assert.deepEqual(plain(original), originalSnapshot, 'Deleting cameras does not mutate the undo snapshot');
assert.deepEqual(removed.history.map(entry => entry.reason), ['director.multi-camera.delete']);
assert.equal(removed.session.activePreviewCameraId, 'camera-second');
removed.undo();
assert.equal(removed.state, original, 'One history step restores every camera, track, cut and group');

const secondaryActive = remove(original, 'camera-third', 'camera-second');
assert.deepEqual(plain(secondaryActive.state.multiCamera.cameras[1]), original.multiCamera.cameras[1], 'Deleting a third camera cannot replace the non-output active camera with the output pose');
assert.equal(secondaryActive.session.activePreviewCameraId, 'camera-second');
const locked = makeState();locked.multiCamera.cameras[1].authoring.cameraLocked = true;
const untouched = context.__localDeleteCameraInState(locked, 'camera-second');
assert.equal(untouched.ok, false);
assert.equal(untouched.reason, 'camera-locked');
assert.equal(untouched.state, locked);
assert.equal(context.__localDeleteCameraInState(locked, 'missing').state, locked);
const partial = remove(locked, locked.multiCamera.cameras.map(camera => camera.id));
assert.equal(partial.state.multiCamera.cameras.length, 1);
assert.equal(partial.state.multiCamera.cameras[0].id, 'camera-second');
assert.equal(remove(locked, 'camera-second').history.length, 0);

const allRemoved = remove(original, original.multiCamera.cameras.map(camera => camera.id));
assert.deepEqual(plain(allRemoved.state.multiCamera), emptyDocument);
assert.deepEqual(plain(allRemoved.state.timeline.cameraCutTrack), {version: 1, clips: []});
assert.ok(channels.every(channel => allRemoved.state.timeline.cameraTracks[channel].length === 0));
assert.deepEqual(plain(allRemoved.selection), []);
assert.equal(allRemoved.session.activePreviewCameraId, '');
assert.equal(allRemoved.part, undefined);
assert.deepEqual(plain(allRemoved.state.objects), original.objects);
assert.deepEqual(plain(allRemoved.state.camera), original.camera);
assert.deepEqual(plain(allRemoved.state.timeline.objectTracks), original.timeline.objectTracks);
assert.deepEqual(plain(allRemoved.state.timeline.clips), original.timeline.clips);
allRemoved.undo();assert.equal(allRemoved.state, original);

const stateToSave = context.__localDeleteCameraInState(original, original.multiCamera.cameras.map(camera => camera.id)).state;
const normalized = context.iS(JSON.parse(JSON.stringify(stateToSave)));
assert.deepEqual(plain(normalized.multiCamera), emptyDocument);
const workspace = context.no(normalized, {id: 'performance-empty', name: 'Empty', createdAt: '2026-09-23', updatedAt: '2026-09-23'});
const project = {version: 3, coordinateSystem: 'y-up', activeWorkspace: {kind: 'performance', id: workspace.id},
  stagingWorkspaces: [], performanceWorkspaces: [workspace], sharedLibrary: {poses: [], cameras: [], captures: []}, exports: []};
const reloaded = context.nf(JSON.parse(JSON.stringify(context.np(project))));
assert.deepEqual(plain(reloaded.multiCamera), emptyDocument, 'Production project serialization and workspace loading preserve zero cameras');
assert.ok(channels.every(channel => reloaded.timeline.cameraTracks[channel].length === 0));

const view = {...plain(context.tF()), position: {x: 5, y: 4, z: 8}, target: {x: 1, y: 2, z: 0}};
const first = context.t2(emptyDocument, {id: 'camera-added', name: 'Added camera', presetId: 'current-view', outputPolicy: 'preserve', currentView: view});
assert.equal(first.ok, true);
assert.equal(first.document.outputCameraId, 'camera-added');
assert.equal(context.tX(first.document).ok, true);
assert.equal(context.t_(first.document).session.activePreviewCameraId, 'camera-added');
const firstProjected = context.oH(reloaded, first.document);
assert.deepEqual(plain(firstProjected.sceneCamera.position), view.position);
const resolved = context.cr({document: first.document, source: {kind: 'camera', cameraId: 'camera-added'}, displayFps: 30, timelineDurationSec: 20});
assert.equal(resolved.cameraId, 'camera-added');
assert.deepEqual(plain(resolved.sceneCamera.position), view.position);
assert.notEqual(resolved.cameraAvailable, false);
const inserted = context.__localInsertShotInState(reloaded, {newCamera: true, newCameraId: 'camera-from-cut',
  id: 'cut-from-empty', createdAt: '2026-09-23', startFrame: 30, durationFrames: 60}, view);
assert.equal(inserted.ok, true);
assert.equal(inserted.state.multiCamera.outputCameraId, 'camera-from-cut');
assert.equal(inserted.state.timeline.cameraCutTrack.clips[0].startFrame, 30);
assert.equal(context.tX(inserted.state.multiCamera).ok, true);

for (const savedState of [stateToSave, firstProjected, original, legacy]) {
  const metadata = {name: 'Saved workspace', createdAt: '2026-09-23T00:00:00.000Z', updatedAt: '2026-09-23T00:00:00.000Z'};
  const staging = context.nn(savedState, {...metadata, id: 'saved-staging'});
  const performance = context.no(savedState, {...metadata, id: 'saved-performance'});
  const savedProject = {version: 3, coordinateSystem: 'y-up', activeWorkspace: {kind: 'performance', id: performance.id},
    stagingWorkspaces: [staging], performanceWorkspaces: [performance], sharedLibrary: {poses: [], cameras: [], captures: []}, exports: []};
  const encoded = context.ka({project: savedProject, documentId: 'saved-document', title: 'Saved cameras', dataVersion: 1});
  assert.equal(encoded.ok, true);
  assert.equal(context.ki(JSON.stringify(encoded.document)).ok, true, 'The production canonical validator accepts a saved empty or populated camera collection');
  const expected = context.oE(savedState);
  assert.deepEqual(plain(encoded.document.performance.cameras.cameras.map(camera => camera.id)), plain(expected.cameras.map(camera => camera.id)), 'Saving never adds a legacy main camera to a canonical collection');
  assert.equal(encoded.document.performance.cameras.outputCameraId, expected.outputCameraId);
  const decoded = context.ks(encoded.document.performance, () => undefined, true);
  assert.equal(decoded.ok, true);
  assert.deepEqual(plain(decoded.workspace.multiCamera.cameras.map(camera => camera.id)), plain(expected.cameras.map(camera => camera.id)), 'A single newly added camera keeps its identifier when reopening');
  assert.equal(decoded.workspace.multiCamera.outputCameraId, expected.outputCameraId);
  if (!expected.cameras.length) assert.ok(channels.every(channel => decoded.mainCameraTracks[channel].length === 0));
}

console.log('Empty camera tests passed: canonical/session validation, legacy migration, atomic camera/track/cut deletion, locks, undo snapshot, independent active cameras, zero-camera project round trip and adding the first camera.');
