import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import {randomUUID} from 'node:crypto';
import {createRequire} from 'node:module';

const require = createRequire(import.meta.url);
const factories = JSON.parse(await fs.readFile(new URL('../src/vendor/module-factories.json', import.meta.url), 'utf8'));
require('../src/patches/camera-cut-sequencer.cjs')(factories);
const source = factories['53401'];
new vm.Script('(' + source + ')');
const ast = require('@babel/parser').parse('(' + source + ')');
const axes = ['x', 'y', 'z'];
const positions = axes.map(axis => 'position.' + axis);
const targets = axes.map(axis => 'target.' + axis);
const channels = [...positions, ...targets, 'lens.fov', 'lens.roll'];
const context = vm.createContext({crypto: {randomUUID}, Date, structuredClone,
  eH: channels, eB: positions, eG: targets, e$: [positions, targets],
  em: axes, ep: Math.PI / 180, eg: 180 / Math.PI, tW: axes,
  tj: ['position', 'rotation', 'scale'].flatMap(group => axes.map(axis => group + '.' + axis)),
  tC: 'scene-camera', tI: 'shot-camera::', tQ: 'Camera', tq: new Set(['scene-camera']),
  lH: Object.freeze({})});
for (const node of ast.program.body[0].expression.body.body) {
  if (node.type === 'FunctionDeclaration') vm.runInContext(source.slice(node.start - 1, node.end - 1), context);
}
const plain = value => JSON.parse(JSON.stringify(value));
const createdAt = '2026-09-23T00:00:00.000Z';
const shot = (id, cameraId, startFrame, endFrame, enabled = true) => ({id, cameraId, startFrame, endFrame, createdAt, enabled});
const raw = {version: 1, clips: [shot('a', 'scene-camera', 30, 90), shot('b', 'second', 150, 210), shot('c', 'scene-camera', 270, 300, false)]};
const track = context.rO(raw);
assert.deepEqual(plain(track.clips.map(clip => [clip.startFrame, clip.endFrame])), [[30, 90], [150, 210], [270, 300]], 'Normalization preserves deliberate gaps');
assert.equal(track.clips[2].enabled, false);
assert.deepEqual(plain(context.rG(track, 'b').clips.map(clip => clip.startFrame)), [30, 270], 'Deleting a cut preserves later placement');
assert.deepEqual(plain(context.rO(raw, ['scene-camera']).clips.map(clip => clip.id)), ['a', 'c']);

const edited = context.__localEditShot(track, 'b', {moveFrame: 110}, 900);
assert.equal(edited.clips[1].startFrame, 110);
assert.equal(edited.clips[1].endFrame, 170);
assert.equal(context.__localEditShot(track, 'b', {moveFrame: 0}, 900).clips[1].startFrame, 90, 'Moves stop at preceding cut');
assert.equal(context.__localEditShot(track, 'b', {moveFrame: 890}, 900).clips[1].endFrame, 270, 'Moves stop at next cut');
assert.equal(context.__localEditShot(track, 'b', {endFrame: 400}, 900).clips[1].endFrame, 270, 'End trim cannot overlap next cut');
assert.equal(context.__localEditShot(track, 'b', {startFrame: 0}, 900).clips[1].startFrame, 90, 'Start trim cannot overlap previous cut');
assert.equal(context.__localEditShot(track, 'b', {endFrame: 100}, 900).clips[1].endFrame, 151, 'At least one frame survives a trim');
const disabled = context.__localEditShot(track, 'b', {enabled: false}, 900);
assert.equal(disabled.clips[1].enabled, false);
assert.equal(context.hx(track, disabled), false, 'Enabled status participates in change detection');

const insertion = {id: 'new', cameraId: 'second', startFrame: 100, durationFrames: 90, createdAt};
const inserted = context.__localInsertShot(track, insertion, 900);
assert.deepEqual(plain(inserted.clips.find(clip => clip.id === 'new')),
  {id: 'new', cameraId: 'second', startFrame: 100, endFrame: 150, createdAt}, 'Insertion trims into the available empty interval');
assert.equal(context.__localInsertShot(track, {...insertion, startFrame: 30}, 900), null, 'Occupied intervals reject insertion');
assert.equal(context.__localInsertShot(track, {...insertion, startFrame: 900}, 900), null, 'Insertion respects the maximum duration');
assert.equal(context.__localInsertShot(track, {...insertion, startFrame: 899}, 900).clips.at(-1).endFrame, 900);

const camera = plain(context.tF());
const cameraTracks = plain(context.eU(camera));
const migrated = context.tZ({kind: 'legacy-singular', sceneCamera: camera, cameraTracks});
assert.equal(migrated.ok, true);
const document = plain(migrated.document);
const second = structuredClone(document.cameras[0]);
second.id = 'second'; second.name = 'Second'; second.transform.position.x = 10;
document.cameras.push(second);
const state = {sceneCamera: camera, objects: [], multiCamera: document,
  timeline: {keyframeModelVersion: 3, displayFps: 30, durationSec: 20, loop: true,
    clips: [], objectTracks: {}, cameraTracks, cameraCutTrack: plain(track)}};
const previewSource = context.cr({source: {kind: 'storyboard'}, document,
  storyboard: {version: 1, clips: [shot('disabled-first', 'second', 30, 90, false)]},
  timelineDurationSec: 20, displayFps: 30});
assert.equal(previewSource.cameraId, document.outputCameraId, 'Gaps use the project output camera even when the first shot is disabled');
assert.equal(previewSource.durationSec, 20, 'A short cut sequence does not truncate playback of a longer animation');
const normalizedTimeline = context.iE(JSON.parse(JSON.stringify(state.timeline)), [], camera);
assert.deepEqual(plain(normalizedTimeline.cameraCutTrack), plain(track), 'Import normalizer preserves frame gaps and disabled shots');
const clonedTimeline = context.iB(normalizedTimeline);
assert.deepEqual(plain(clonedTimeline.cameraCutTrack), plain(track), 'Project cloning preserves cut metadata');
const converted = context.rY(normalizedTimeline, 60);
assert.deepEqual(plain(converted.cameraCutTrack.clips.map(clip => [clip.startFrame, clip.endFrame])), [[60, 180], [300, 420], [540, 600]], 'Changing FPS scales start and end times without collapsing gaps');
assert.equal(converted.cameraCutTrack.clips[2].enabled, false);

const evaluation = context.lB({sceneCamera: camera, sceneObjects: [], timeline: state.timeline,
  savedMotions: [], catalogMotions: [], multiCamera: document, cameraCutTrack: disabled, activeCameraId: 'scene-camera'});
assert.equal(evaluation.sampleActiveCameraId(40), 'scene-camera');
assert.equal(evaluation.sampleActiveCameraId(160), 'scene-camera', 'Disabled cut falls back to the output camera');
const activeEvaluation = context.lB({sceneCamera: camera, sceneObjects: [], timeline: state.timeline,
  savedMotions: [], catalogMotions: [], multiCamera: document, cameraCutTrack: track, activeCameraId: 'scene-camera'});
assert.equal(activeEvaluation.sampleActiveCameraId(149), 'scene-camera', 'Gap uses the existing output camera');
assert.equal(activeEvaluation.sampleActiveCameraId(150), 'second', 'Camera changes exactly at the start frame');
assert.equal(activeEvaluation.sampleActiveCameraId(209), 'second');
assert.equal(activeEvaluation.sampleActiveCameraId(210), 'scene-camera', 'End frame is exclusive');
assert.equal(activeEvaluation.sampleFrame(160).sceneCamera.position.x, 10, 'Frame evaluator resolves the selected camera transform');

const existing = context.__localInsertShotInState(state, insertion, camera);
assert.equal(existing.ok, true);
assert.equal(existing.state.multiCamera.cameras.length, 2);
const created = context.__localInsertShotInState(state, {...insertion, newCamera: true, newCameraId: 'new-camera'}, camera);
assert.equal(created.ok, true);
assert.equal(created.state.multiCamera.cameras.length, 3, 'New camera and cut are committed together');
assert.equal(created.state.timeline.cameraCutTrack.clips.find(clip => clip.id === 'new').cameraId, 'new-camera');
assert.equal(created.state.multiCamera.outputCameraId, state.multiCamera.outputCameraId, 'Creating a cut preserves the fallback output camera');
assert.equal(context.__localInsertShotInState(state, {...insertion, newCamera: true, newCameraId: 'bad', startFrame: 30}, camera).ok, false);
assert.equal(state.multiCamera.cameras.length, 2, 'Rejected insertion does not leak a camera into the document');

console.log('Camera cut sequencer: gaps, trimming, enabled state, import, FPS conversion, playback and atomic camera insertion passed.');
