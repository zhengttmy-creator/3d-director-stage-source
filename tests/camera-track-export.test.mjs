import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import {randomUUID} from 'node:crypto';
import {createRequire} from 'node:module';

const require = createRequire(import.meta.url);
const parser = require('@babel/parser');
const traverse = require('@babel/traverse').default;
const factories = JSON.parse(await fs.readFile(new URL('../src/vendor/module-factories.json', import.meta.url), 'utf8'));
// Reproduce the production patch order in memory. No generated bundles or assets are written.
for (const name of ['limit-timeline', 'model-colors']) require('../src/patches/' + name + '.cjs')(factories);
factories['53401'] = require('../src/patches/motion-loader.cjs').patchMotionLoader(factories['53401']);
for (const name of ['patch-local-motion-library', 'motion-previews', 'pose-library', 'folder-models',
  'root-motion', 'transform-autokey', 'camera-position-autokey', 'body-presets', 'disable-scene-drafts',
  'patch-camera-target-selection', 'manual-timeline-keyframes', 'curve-easing', 'skeletal-keyframes',
  'pose-continuation-alignment', 'skeletal-playback', 'camera-cut-sequencer', 'empty-cameras',
  'empty-scene-startup', 'empty-camera-ui', 'background-upload', 'camera-track-export']) {
  require('../src/patches/' + name + '.cjs')(factories);
}
const source = factories['53401'];
new vm.Script('(' + source + ')');
const ast = parser.parse('(' + source + ')');
const extract = node => source.slice(node.start - 1, node.end - 1);
const found = {};
const capture = (name, node) => {
  assert.equal(found[name], undefined, name + ' must have a unique production anchor');
  found[name] = extract(node);
};
traverse(ast, {
  VariableDeclarator(path) {
    const node = path.node;
    if (node.id.name === 'oJ' && node.init?.type === 'CallExpression' && extract(node.init).includes('name:"镜头轨道"')) capture('previewOptions', node.init);
    if (node.id.name === 'oL' && node.init?.type === 'CallExpression' && extract(node.init).includes('__localCameraTrackExportPlan')) capture('exportPlan', node.init);
    if (node.id.name === 'o$' && node.init?.type === 'CallExpression' && extract(node.init).includes('oL.cameraCutTrack')) capture('exportEvaluator', node.init);
    if (node.id.name === 'sy' && node.init?.type === 'CallExpression' && extract(node.init).includes('__localSampleCameraTrackExportFrame')) capture('renderFrame', node.init);
  },
  ObjectProperty(path) {
    const node = path.node, value = extract(node.value);
    if (node.key.name === 'onExportVideo' && value.includes('if(!il.cameras.length)')) capture('openExport', node.value);
    if (node.key.name === 'onStart' && value.includes('oL.exportReady')) capture('startExport', node.value);
    if (node.key.name === 'exportDisabled' && value.includes('il.cameras.length')) capture('exportDisabled', node.value);
    if (node.key.name === 'plan' && value === 'oL') capture('encoderPlan', node.value);
  },
});
for (const name of ['exportPlan', 'exportEvaluator', 'renderFrame', 'openExport', 'startExport', 'exportDisabled', 'encoderPlan']) assert.ok(found[name], name);
assert.doesNotMatch(found.exportPlan, /\bt6\b|source:|timelineDurationSec/,
  'Editor camera selection and the default project duration must not influence exported cuts');
assert.match(found.exportEvaluator, /cameraCutTrack:oL\.cameraCutTrack/);
assert.match(found.exportEvaluator, /timeline:iX\.timeline/);

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
  lH: Object.freeze({}), s9: '__director_stage_custom_pose__',
});
for (const node of ast.program.body[0].expression.body.body) {
  if (node.type === 'FunctionDeclaration') vm.runInContext(extract(node), context);
}
const plain = value => JSON.parse(JSON.stringify(value));
const clone = value => structuredClone(plain(value));
const shot = (id, cameraId, startFrame, endFrame, enabled = true) => ({id, cameraId, startFrame, endFrame,
  enabled, createdAt: '2026-10-09T00:00:00.000Z'});
const camera = plain(context.tF());
const tracks = plain(context.eU(camera));
const migration = context.tZ({kind: 'legacy-singular', sceneCamera: camera, cameraTracks: tracks});
assert.equal(migration.ok, true);
const document = plain(migration.document);
const first = document.cameras[0];
const second = {...clone(first), id: 'camera-second', name: '相机 2'};
second.transform.position.x = 10;
const third = {...clone(first), id: 'camera-third', name: '手动选中的相机'};
third.transform.position.x = 80;
document.cameras.push(second, third);
const plan = (clips, overrides = {}) => context.__localCameraTrackExportPlan({document,
  storyboard: {version: 1, clips}, displayFps: 30, timelineDurationSec: 20,
  source: {kind: 'camera', cameraId: third.id}, ...overrides});
const single = plan([shot('single', first.id, 0, 45)]);
assert.equal(single.exportReady, true);
assert.equal(single.durationSec, 1.5, 'One shot exports only its authored duration');
assert.equal(single.source.kind, 'storyboard', 'Even one camera is exported from the track');
assert.equal(single.shotCount, 1);
const clips = [shot('first', first.id, 0, 60), shot('second', second.id, 60, 150)];
const multi = plan(clips);
assert.equal(multi.exportReady, true);
assert.equal(multi.durationSec, 5, 'Do not render the unused 15-second project tail');
assert.equal(multi.endFrame, 150);
assert.equal(multi.shotCount, 2);
assert.equal(plan([shot('long', second.id, 0, 900)]).durationSec, 30,
  'An authored track longer than the default project duration must not be truncated');
const disabledTail = plan([...clips, shot('disabled-tail', third.id, 150, 600, false)]);
assert.equal(disabledTail.durationSec, 5);
assert.equal(disabledTail.shotCount, 2);
assert.deepEqual(plain(disabledTail.cameraCutTrack.clips.map(clip => clip.id)), ['first', 'second']);

// Different camera rows may overlap. A short upper layer does not shorten or
// split the authored lower clip, and export duration follows the latest end.
const layeredClips = [shot('lower-bed', second.id, 0, 180), shot('upper-cut', first.id, 30, 60),
  shot('lowest-cut', third.id, 90, 120)];
const layered = plan(layeredClips);
assert.equal(layered.exportReady, true, 'Nested coverage is continuous even after a shorter clip ends');
assert.equal(layered.durationSec, 6);
assert.equal(layered.endFrame, 180, 'The last chronological start need not have the latest end');
assert.equal(layered.cameraId, second.id, 'Initial render camera is the active layer at frame zero');
assert.deepEqual(plain(layered.cameraCutTrack.clips.map(clip => [clip.id, clip.startFrame, clip.endFrame])),
  layeredClips.map(clip => [clip.id, clip.startFrame, clip.endFrame]), 'Planning preserves all overlapping source clips');
const fullyCovered = plan([shot('underneath', second.id, 0, 60), shot('cover', first.id, 0, 120)]);
assert.equal(fullyCovered.exportReady, true);
assert.equal(fullyCovered.cameraId, first.id, 'Same-time cuts use document row order, not clip input order');
assert.equal(fullyCovered.shotCount, 2, 'Covered clips remain authored and become available when upper layers change');
const reversedRows = {...clone(document), cameras: [clone(second), clone(first), clone(third)]};
const lowerNowAbove = plan(layeredClips, {document: reversedRows});
assert.equal(lowerNowAbove.exportReady, true);
assert.equal(lowerNowAbove.durationSec, 6);
const disabledUpper = plan([shot('disabled-upper', first.id, 0, 300, false), shot('enabled-lower', second.id, 0, 90)]);
assert.equal(disabledUpper.cameraId, second.id);
assert.equal(disabledUpper.durationSec, 3, 'A disabled highest row neither wins nor extends export');

const empty = plan([]);
assert.equal(empty.exportReady, false);
assert.equal(empty.durationSec, 0);
assert.equal(empty.exportErrorCode, 'no-shots');
assert.match(empty.exportError, /添加并启用/);
assert.equal(plan([shot('off', first.id, 0, 60, false)]).exportErrorCode, 'no-shots');
assert.equal(plan([shot('zero', first.id, 0, 0)]).exportReady, false);
assert.equal(plan([], {document: {cameras: [], outputCameraId: ''}}).exportErrorCode, 'no-camera');
assert.equal(plan([shot('missing', 'not-a-camera', 0, 30)]).exportErrorCode, 'missing-camera');
const initialGap = plan([shot('late', first.id, 30, 90)]);
assert.equal(initialGap.exportReady, false);
assert.deepEqual(plain(initialGap.gap), {startFrame: 0, endFrame: 30});
assert.match(initialGap.exportError, /0–1 秒/);
const middleGap = plan([shot('a', first.id, 0, 30), shot('b', second.id, 60, 90)]);
assert.deepEqual(plain(middleGap.gap), {startFrame: 30, endFrame: 60});
assert.match(middleGap.exportError, /1–2 秒/);
const disabledMiddle = plan([shot('a', first.id, 0, 30), shot('off', second.id, 30, 60, false), shot('b', first.id, 60, 90)]);
assert.equal(disabledMiddle.exportReady, false, 'Disabled clips do not cover a render gap');
assert.deepEqual(plain(disabledMiddle.gap), {startFrame: 30, endFrame: 60});
const nestedGap = plan([shot('lower-cover', second.id, 0, 120), shot('nested', first.id, 30, 60),
  shot('after-gap', third.id, 150, 180)]);
assert.equal(nestedGap.exportReady, false);
assert.deepEqual(plain(nestedGap.gap), {startFrame: 120, endFrame: 150},
  'Union coverage reports the real gap, not the covered region after a nested cut');
assert.deepEqual(clips.map(clip => [clip.startFrame, clip.endFrame]), [[0, 60], [60, 150]], 'Planning never changes authored timing');

const timeline = {keyframeModelVersion: 3, displayFps: 30, durationSec: 20, loop: true,
  clips: [], objectTracks: {}, cameraTracks: tracks, cameraCutTrack: {version: 1, clips}};
const createEvaluator = (activeCameraId, selectedPlan = multi) => context.lB({
  sceneCamera: selectedPlan.sceneCamera, sceneObjects: [], timeline,
  savedMotions: [], catalogMotions: [], multiCamera: document,
  cameraCutTrack: selectedPlan.cameraCutTrack, activeCameraId,
});
for (const activeId of [first.id, second.id, third.id]) {
  const evaluator = createEvaluator(activeId);
  for (const [frame, id, x] of [[0, first.id, first.transform.position.x], [59, first.id, first.transform.position.x],
    [60, second.id, 10], [149, second.id, 10]]) {
    const value = evaluator.sampleFrame(frame);
    assert.equal(value.activeCameraId, id, 'Playback follows authored cuts, regardless of the manually selected camera');
    assert.equal(value.sceneCamera.position.x, x);
  }
  for (const [time, id] of [[0, first.id], [1.999, first.id], [2, second.id], [4.999, second.id], [5, second.id]]) {
    assert.equal(context.__localSampleCameraTrackExportFrame(evaluator, multi, time).activeCameraId, id,
      'Export changes at exact shot boundaries and never falls back at the exclusive end');
  }
}
for (const activeId of [first.id, second.id, third.id]) {
  const evaluator = createEvaluator(activeId, layered);
  for (const [frame, id] of [[0, second.id], [29, second.id], [30, first.id], [59, first.id],
    [60, second.id], [90, second.id], [120, second.id], [179, second.id]]) {
    assert.equal(context.__localSampleCameraTrackExportFrame(evaluator, layered, frame / 30).activeCameraId, id,
      'Export uses the highest active camera row and resumes the lower row at the upper end');
  }
}
const reorderedEvaluator = context.lB({sceneCamera: lowerNowAbove.sceneCamera, sceneObjects: [], timeline,
  savedMotions: [], catalogMotions: [], multiCamera: reversedRows,
  cameraCutTrack: lowerNowAbove.cameraCutTrack, activeCameraId: third.id});
assert.equal(context.__localSampleCameraTrackExportFrame(reorderedEvaluator, lowerNowAbove, 1.5).activeCameraId, second.id,
  'Camera document order, rather than clip start order, controls visible export layers');
const animatedDocument = clone(document);
animatedDocument.cameras[1].tracks['position.x'] = [
  {id: 'moving-start', frame: 0, value: 0, interpolation: 'linear', createdAt: '2026-10-13'},
  {id: 'moving-end', frame: 180, value: 180, interpolation: 'linear', createdAt: '2026-10-13'},
];
const animatedPlan = plan(layeredClips, {document: animatedDocument});
const animatedEvaluator = context.lB({sceneCamera: animatedPlan.sceneCamera, sceneObjects: [], timeline,
  savedMotions: [], catalogMotions: [], multiCamera: animatedDocument,
  cameraCutTrack: animatedPlan.cameraCutTrack, activeCameraId: third.id});
const resumed = context.__localSampleCameraTrackExportFrame(animatedEvaluator, animatedPlan, 2);
assert.equal(resumed.activeCameraId, second.id);
assert.equal(resumed.sceneCamera.position.x, 60, 'Resumed lower camera samples global frame 60 instead of restarting its motion');
const disabledUpperEvaluator = createEvaluator(first.id, disabledUpper);
assert.equal(context.__localSampleCameraTrackExportFrame(disabledUpperEvaluator, disabledUpper, 1).activeCameraId, second.id);
assert.throws(() => context.__localSampleCameraTrackExportFrame(createEvaluator(third.id), middleGap, 1.5), /1–2 秒/);
assert.throws(() => context.__localSampleCameraTrackExportFrame(createEvaluator(third.id), empty, 0), /添加并启用/);
const decodedTimeline = context.iE(JSON.parse(JSON.stringify(timeline)), [], camera);
assert.deepEqual(plain(context.iB(decodedTimeline).cameraCutTrack), plain(context.rO(timeline.cameraCutTrack)),
  'Project import/cloning preserve authored shot duration and camera references');

const evaluate = (name, bindings) => vm.runInNewContext('(' + found[name] + ')', bindings);
const hooks = {useMemo: callback => callback(), useCallback: callback => callback};
const productionPlan = evaluate('exportPlan', {n: hooks, il: document, iK: {timeline}, oR: timeline,
  __localCameraTrackExportPlan: context.__localCameraTrackExportPlan});
assert.deepEqual(plain(productionPlan), plain(multi));
let startCount = 0;
const notices = [];
for (const candidate of [empty, initialGap, middleGap, disabledMiddle]) {
  evaluate('startExport', {il: document, oL: candidate, iT: message => notices.push(message), sF: () => startCount++})();
}
assert.equal(startCount, 0);
assert.equal(notices.length, 4);
evaluate('startExport', {il: document, oL: multi, iT: assert.fail, sF: () => startCount++})();
assert.equal(startCount, 1);
evaluate('startExport', {il: {cameras: []}, oL: multi, iT: assert.fail, sF: () => startCount++})();
assert.equal(startCount, 1, 'Deleting all cameras cannot render from an already-open dialog');
assert.equal(evaluate('exportDisabled', {sC: false, il: {cameras: []}}), true);
const openEvents = [];
const openBindings = {il: document, B: undefined, re: value => openEvents.push(plain(value)),
  ro: () => {}, rl: () => {}, sz: () => openEvents.push('open'), sG: value => value, iK: {timeline}};
evaluate('openExport', openBindings)();
assert.deepEqual(openEvents, [{kind: 'storyboard'}, 'open']);
openEvents.length = 0;
evaluate('openExport', {...openBindings, il: {cameras: []}})();
assert.deepEqual(openEvents, []);

const frames = [];
const exportEvaluator = createEvaluator(third.id);
const render = evaluate('renderFrame', {n: hooks, o$: exportEvaluator, oL: multi, rc: false,
  __localSampleCameraTrackExportFrame: context.__localSampleCameraTrackExportFrame,
  il: document, iX: {objects: [], timeline}, sj: () => undefined,
  $: {current: {renderVideoFrame: request => {frames.push(request); return 'rendered';}}}});
for (const time of [0, 1.999, 2, 4.999, 5]) assert.equal(await render(0, time, 1280, 720), 'rendered');
assert.deepEqual(frames.map(frame => frame.state.sceneCamera.position.x), [first.transform.position.x, first.transform.position.x, 10, 10, 10]);
const invalidRender = evaluate('renderFrame', {n: hooks, o$: exportEvaluator, oL: middleGap, rc: false,
  __localSampleCameraTrackExportFrame: context.__localSampleCameraTrackExportFrame,
  il: document, iX: {}, $: {current: {renderVideoFrame: assert.fail}}});
await assert.rejects(() => invalidRender(0, 1.5, 1280, 720), /1–2 秒/);

const jsx = (type, props) => ({type, props});
Object.assign(context, {i: {jsx, jsxs: jsx, Fragment: 'Fragment'}, w: () => ({t: key => key}), ct: 'storyboard',
  md: 'select', hq: 'summary', hW: {A: 'warning'}, l: {Sc0: 'checkbox'}, sH: [1280, 1920], sO: [30, 60]});
const findNodes = (value, test, nodes = []) => {
  if (!value || typeof value !== 'object') return nodes;
  if (test(value)) nodes.push(value);
  for (const child of Object.values(value)) {
    if (Array.isArray(child)) child.forEach(item => findNodes(item, test, nodes));
    else if (child && typeof child === 'object') findNodes(child, test, nodes);
  }
  return nodes;
};
const settings = context.hQ({durationSec: 5, fps: 30, aspectLabel: '16:9', outputWidth: 1280, outputHeight: 720,
  longEdge: 1280, source: multi.source, cameras: document.cameras, trackShotCount: 2, trackExportError: middleGap.exportError});
const field = findNodes(settings, node => node.props?.['data-testid'] === 'director-stage-video-export-source')[0];
assert.equal(field.type, 'div');
assert.equal(field.props['aria-label'], '导出来源：镜头轨道');
assert.equal(field.props.children[0].props.children, '镜头轨道');
assert.equal(field.props.children[1].props.children, '2 个启用片段');
assert.equal(findNodes(settings, node => node.props?.onValueChange && node.props?.value === 'storyboard').length, 0,
  'The export dialog cannot switch away from the authored camera track');
assert.equal(findNodes(settings, node => node.props?.role === 'alert').length, 1);
assert.match(JSON.stringify(settings), /1–2 秒/);
Object.assign(context, {oj: 'dialog', oI: 'panel', oM: 'header', oz: 'title', oF: 'description', pR: {A: 'movie'}});
for (const error of [undefined, empty.exportError, middleGap.exportError]) {
  const dialog = context.hK({open: true, durationSec: error ? 0 : 5, fps: 30, longEdge: 1280,
    aspectLabel: '16:9', outputWidth: 1280, outputHeight: 720, source: multi.source,
    cameras: document.cameras, status: 'idle', trackExportError: error, trackShotCount: error ? 0 : 2});
  const startButton = findNodes(dialog, node => node.props?.['data-writeback-action'] === 'start-video-export')[0];
  assert.ok(startButton);
  assert.equal(startButton.props.disabled, !!error, 'The visible render action is disabled until the camera track is complete');
  assert.equal(startButton.props.title, error);
}
// Main viewport names its actual preview source and offers camera-track selection.
const previewOptions = evaluate('previewOptions', {n: hooks, il: document, oN: {clips}, ct: 'storyboard', nC: context.nC});
assert.equal(previewOptions[0].name, '镜头轨道');
assert.equal(previewOptions[0].disabled, false);
for (const hiddenClips of [[], clips.map(clip => ({...clip, enabled: false}))]) {
  const options = evaluate('previewOptions', {n: hooks, il: document, oN: {clips: hiddenClips}, ct: 'storyboard', nC: context.nC});
  assert.equal(options[0].disabled, true);
}
Object.assign(context, {cf: {rI: 'menu-root', ty: 'trigger', _2: 'item'}, mf: {A: 'free-view'},
  cj: {A: 'camera'}, ug: {A: 'chevron'}, ui: {A: 'check'}, mh: 'menu', oS: {transientPortal: 'portal'}, oP: '',
  ok: (...values) => values.filter(Boolean).join(' ')});
const chosen = [];
const switcher = context.my({open: false, mode: 'camera', cameras: previewOptions, selectedCameraId: 'storyboard',
  freeViewLabel: '导演视角', cameraViewLabel: '机位视角', onCameraSelect: id => chosen.push(id)});
const switcherButton = findNodes(switcher, node => node.props?.['data-testid'] === 'director-stage-camera-view-switcher')[0];
assert.equal(switcherButton.props['aria-label'], '机位视角 · 镜头轨道');
const chooseTrack = findNodes(switcher, node => node.props?.['data-testid'] === 'director-stage-camera-view-storyboard')[0];
chooseTrack.props.onSelect();
assert.deepEqual(chosen, ['storyboard']);
assert.match(source, /\(my,\{open:ab,mode:av,cameras:oJ,selectedCameraId:oK,/,
  'The main viewport uses the resolved preview source instead of an unrelated selected camera');
console.log('Camera track export passed: layered row priority, nested/covered clips, maximum authored end, union coverage, disabled layers, global-time resumption, manual-view independence, persistence, real render callback and fixed track source UI.');
