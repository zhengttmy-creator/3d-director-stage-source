import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import {randomUUID} from 'node:crypto';
import {createRequire} from 'node:module';
import * as THREE from 'three';

const require = createRequire(import.meta.url);
const factories = JSON.parse(await fs.readFile(new URL('../src/vendor/module-factories.json', import.meta.url), 'utf8'));
require('../src/patches/camera-cut-sequencer.cjs')(factories);
require('../src/patches/empty-cameras.cjs')(factories);
const source = factories['53401'];
new vm.Script('(' + source + ')');
const ast = require('@babel/parser').parse('(' + source + ')');
const axes = ['x', 'y', 'z'];
const positions = axes.map(axis => 'position.' + axis);
const targets = axes.map(axis => 'target.' + axis);
const channels = [...positions, ...targets, 'lens.fov', 'lens.roll'];
const context = vm.createContext({
  crypto: {randomUUID}, Date, structuredClone,
  eH: channels, eB: positions, eG: targets, e$: [positions, targets],
  em: axes, ep: Math.PI / 180, eg: 180 / Math.PI, tW: axes,
  tj: ['position', 'rotation', 'scale'].flatMap(group => axes.map(axis => group + '.' + axis)),
  tC: 'scene-camera', tI: 'shot-camera::', tQ: 'Camera', tq: new Set(['scene-camera']),
  nt: 'staging-main', ag: {}, lH: Object.freeze({}),
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
const plain = value => JSON.parse(JSON.stringify(value));
const createdAt = '2026-10-13T00:00:00.000Z';
const shot = (id, cameraId, startFrame, endFrame, enabled = true) =>
  ({id, cameraId, startFrame, endFrame, createdAt, enabled});
const state = plain(context.iw());
const migrated = context.tZ({kind: 'legacy-singular', sceneCamera: state.sceneCamera, cameraTracks: state.timeline.cameraTracks});
assert.equal(migrated.ok, true);
const top = {...plain(migrated.document.cameras[0]), name: 'Upper camera'};
const lower = {...structuredClone(top), id: 'lower', name: 'Lower camera'};
const middle = {...structuredClone(top), id: 'middle', name: 'Middle camera'};
lower.tracks['position.x'] = [
  {id: 'lower-x-start', frame: 0, value: 0, interpolation: 'linear', createdAt},
  {id: 'lower-x-end', frame: 120, value: 120, interpolation: 'linear', createdAt},
];
const document = {...plain(migrated.document), cameras: [top, lower], outputCameraId: top.id};
const clips = [shot('upper-cut', top.id, 30, 60), shot('lower-cut', lower.id, 0, 120)];
const track = {version: 1, clips};
const ranges = value => plain(value.clips.map(clip => [clip.id, clip.startFrame, clip.endFrame])).sort((a, b) => a[0].localeCompare(b[0]));
const expectedRanges = ranges(track);
const evaluate = (cameraDocument = document, cameraTrack = track, timeline = state.timeline) => context.lB({
  sceneCamera: state.sceneCamera, sceneObjects: [], timeline,
  savedMotions: [], catalogMotions: [], multiCamera: cameraDocument,
  cameraCutTrack: cameraTrack, activeCameraId: top.id,
});

assert.deepEqual(ranges(context.rO(track)), expectedRanges, 'Normalization preserves overlapping camera ranges');
assert.deepEqual(ranges(context.rV([...clips].reverse())), expectedRanges, 'Input/creation order cannot flatten camera layers');
assert.equal(context.rU(track), 120, 'Covered lower camera determines the complete timeline end');
const evaluator = evaluate();
assert.deepEqual([0, 29, 30, 59, 60, 119].map(frame => evaluator.sampleActiveCameraId(frame)),
  [lower.id, lower.id, top.id, top.id, lower.id, lower.id], 'Upper camera overrides only while its interval is active');
assert.equal(evaluator.sampleFrame(60).sceneCamera.position.x, 60, 'Lower camera resumes its animated transform at global frame 60');
assert.equal(evaluator.sampleActiveCameraId(120), top.id, 'A fully uncovered frame uses the configured fallback');
assert.equal(evaluate({...document, cameras: [lower, top]}).sampleActiveCameraId(40), lower.id,
  'The first camera row wins regardless of clip start or creation ordering');
const disabledTop = {version: 1, clips: [{...clips[0], enabled: false}, clips[1]]};
assert.equal(evaluate(document, disabledTop).sampleActiveCameraId(40), lower.id, 'Disabled upper clips reveal lower camera');

const threeDocument = {...document, cameras: [top, middle, lower]};
const threeTrack = {version: 1, clips: [...clips, shot('middle-cut', middle.id, 10, 100)]};
assert.deepEqual([0, 10, 30, 60, 100, 119].map(frame => evaluate(threeDocument, threeTrack).sampleActiveCameraId(frame)),
  [lower.id, middle.id, top.id, middle.id, lower.id, lower.id], 'Nested three-layer coverage follows row priority and exact exclusive ends');
assert.equal(evaluate(threeDocument, {version: 1, clips: threeTrack.clips.map(clip => clip.cameraId === top.id || clip.cameraId === middle.id ? {...clip, enabled: false} : clip)}).sampleActiveCameraId(40), lower.id);
assert.equal(evaluate(document, {version: 1, clips: [...clips, shot('missing-cut', 'missing-camera', 0, 900)]}).sampleActiveCameraId(40), top.id,
  'Missing camera clips never obscure valid rows');

state.multiCamera = document;
state.timeline = {...state.timeline, displayFps: 30, durationSec: 1, cameraCutTrack: track};
const imported = context.iE(JSON.parse(JSON.stringify(state.timeline)), [], state.sceneCamera);
assert.deepEqual(ranges(imported.cameraCutTrack), expectedRanges, 'Project import keeps original layered intervals');
assert.equal(imported.durationSec, 4, 'Project import keeps a covered lower tail in the duration');
assert.equal(context.rX(state.timeline), 4, 'Minimum timeline duration is maximum layer end, not last start-sorted clip end');
assert.deepEqual(ranges(context.iB(imported).cameraCutTrack), expectedRanges, 'Cloning preserves layers');
const converted = context.rY(imported, 60);
assert.deepEqual(ranges(converted.cameraCutTrack), [['lower-cut', 0, 240], ['upper-cut', 60, 120]],
  'FPS conversion scales both ends without resolving cross-camera overlap');
assert.equal(converted.durationSec, 4);
assert.deepEqual([0, 59, 60, 119, 120, 239].map(frame => evaluate(document, converted.cameraCutTrack, converted).sampleActiveCameraId(frame)),
  [lower.id, lower.id, top.id, top.id, lower.id, lower.id]);
const restored = context.iS(JSON.parse(JSON.stringify(state)));
assert.deepEqual(ranges(restored.timeline.cameraCutTrack), expectedRanges, 'Full workspace save/load preserves coverage');
assert.deepEqual(plain(restored.multiCamera.cameras.map(camera => camera.id)), [top.id, lower.id]);
assert.deepEqual([0, 30, 60].map(frame => evaluate(restored.multiCamera, restored.timeline.cameraCutTrack, restored.timeline).sampleActiveCameraId(frame)),
  [lower.id, top.id, lower.id]);

const metadata = {name: 'Layer test', createdAt, updatedAt: createdAt};
const staging = context.nn(state, {...metadata, id: 'staging'});
const performance = context.no(state, {...metadata, id: 'performance'});
const project = {version: 3, coordinateSystem: 'y-up', activeWorkspace: {kind: 'performance', id: performance.id},
  stagingWorkspaces: [staging], performanceWorkspaces: [performance], sharedLibrary: {poses: [], cameras: [], captures: []}, exports: []};
const encoded = context.ka({project, documentId: 'layer-document', title: 'Layered cameras', dataVersion: 1});
assert.equal(encoded.ok, true);
assert.equal(context.ki(JSON.stringify(encoded.document)).ok, true, 'Canonical project validation accepts layered ranges');
assert.deepEqual(ranges(encoded.document.performance.timeline.cameraCutTrack), expectedRanges);
assert.deepEqual(plain(encoded.document.performance.cameras.cameras.map(camera => camera.id)), [top.id, lower.id], 'Serialized camera row priority is stable');
const decoded = context.ks(encoded.document.performance, () => undefined, true);
assert.equal(decoded.ok, true);
const decodedTimeline = context.iE({...imported, cameraCutTrack: encoded.document.performance.timeline.cameraCutTrack}, [], decoded.workspace.sceneCamera);
assert.deepEqual([0, 30, 60].map(frame => evaluate(decoded.workspace.multiCamera, decodedTimeline.cameraCutTrack, decodedTimeline).sampleActiveCameraId(frame)),
  [lower.id, top.id, lower.id], 'Canonical camera decode and imported timeline preserve visible layers');

console.log('Camera layer priority passed: two/three rows, disabled/missing cameras, exact boundaries, global-time resumption, max duration, import/save/load and FPS conversion.');
