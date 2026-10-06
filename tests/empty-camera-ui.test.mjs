import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import {createRequire} from 'node:module';

const require = createRequire(import.meta.url);
const bundle = {window: {}};
vm.runInNewContext(await fs.readFile(new URL('../web/vendor/modules.js', import.meta.url), 'utf8'), bundle);
const source = bundle.window.directorFactories[53401].toString();
const ast = require('@babel/parser').parse('(' + source + ')');
const extract = node => source.slice(node.start - 1, node.end - 1);
const found = {};
const keep = (key, node) => {
  assert.equal(found[key], undefined, key + ' must have a unique production anchor');
  found[key] = extract(node);
};
require('@babel/traverse').default(ast, {
  VariableDeclarator(path) {
    if (path.node.id.name === '__localEmptyCameraViewEffect') keep('emptyViewEffect', path.node.init.arguments[0]);
    if (path.node.id.name === 'm7' && extract(path.node).includes('async()=>')) keep('capture', path.node.init.arguments[0]);
  },
  ObjectProperty(path) {
    const node = path.node, code = extract(node.value);
    if (node.key.name === 'onExportVideo' && code.includes('il.cameras.length')) keep('openExport', node.value);
    if (node.key.name === 'onStart' && code.includes('if(il.cameras.length)sF()')) keep('startExport', node.value);
    if (node.key.name === 'exportDisabled' && code.includes('il.cameras.length')) keep('exportDisabled', node.value);
    if (node.key.name === 'open' && code.includes('sA&&il.cameras.length')) keep('exportOpen', node.value);
    if (node.key.name === 'onAddCamera' && code.includes('cI(')) keep('addCamera', node.value);
    if (node.key.name === 'disabled' && code.includes('__localNoCamera')) keep('captureDisabled', node.value);
    if (node.key.name === 'onDeleteStoryboardCamera' && node.value.type === 'ArrowFunctionExpression') keep('deleteCamera', node.value);
    if (node.key.name === 'onKeyDown' && code.includes('setMenu(') && code.includes('__localEditShot(')) keep('shotKeyDown', node.value);
  },
  AssignmentExpression(path) {
    const code = extract(path.node);
    if (code.startsWith('p.visible=') && code.includes('f.empty')) keep('monitorVisible', path.node.right);
    if (code.startsWith('r.cameraModel.visible=w||')) keep('cameraModelVisible', path.node.right);
  },
});
for (const key of ['emptyViewEffect', 'capture', 'openExport', 'startExport', 'exportDisabled', 'exportOpen',
  'addCamera', 'captureDisabled', 'deleteCamera', 'shotKeyDown', 'monitorVisible', 'cameraModelVisible']) assert.ok(found[key], key);
const evaluate = (key, bindings) => vm.runInNewContext('(' + found[key] + ')', bindings);
const plain = value => JSON.parse(JSON.stringify(value));
const document = count => ({cameras: Array.from({length: count}, (_, index) => ({id: 'camera-' + index}))});

function closeEmptyViews(count, initialSplit) {
  const events = [];
  let split = initialSplit;
  evaluate('emptyViewEffect', {il: document(count),
    ag: value => events.push(['cameraView', value]), ah: value => events.push(['cameraDraft', value]),
    aw: value => events.push(['collapsed', value]), rT: value => events.push(['assetPanel', value]),
    ib: updater => {split = updater(split);}})();
  return {events, split};
}
for (const assetPanelWasOpen of [false, true]) {
  const closed = closeEmptyViews(0, {selectedCameraId: 'deleted-camera', assetPanelWasOpen});
  assert.equal(closed.split, null, 'Undoing the creation of the last camera exits split preview');
  assert.deepEqual(closed.events, [['cameraView', false], ['cameraDraft', null], ['collapsed', false], ['assetPanel', assetPanelWasOpen]]);
}
assert.equal(closeEmptyViews(0, null).events.length, 3, 'An already closed split does not overwrite the asset panel preference');
const existingSplit = {selectedCameraId: 'camera-0', assetPanelWasOpen: true};
assert.deepEqual(closeEmptyViews(1, existingSplit), {events: [], split: existingSplit}, 'A nonempty camera collection preserves its active view');

let captureStarts = 0;
const captureContext = {il: document(0), aH: false, am: false, rz: false, ih: null, mU: () => captureStarts++};
await evaluate('capture', captureContext)();
assert.equal(captureStarts, 0, 'The keyboard capture callback cannot capture the internal navigation camera');
await evaluate('capture', {...captureContext, il: document(1)})();
assert.equal(captureStarts, 1, 'Capture remains available after adding a camera');
assert.equal(evaluate('captureDisabled', {l: false, a: false, __localNoCamera: true}), true);
assert.equal(evaluate('captureDisabled', {l: false, a: false, __localNoCamera: false}), false);

function openExport(count) {
  const events = [];
  evaluate('openExport', {il: document(count), B: () => events.push('event'), x: 'stage', ej: 'performance',
    oN: {clips: []}, rO: value => value, ci: value => {
      assert.ok(value.cameras.length, 'Export must not dereference a nonexistent output camera');
      return value.cameras[0];
    }, re: value => events.push(plain(value)), iK: {timeline: {displayFps: 30}}, sG: value => value,
    ro: value => events.push(value), rl: value => events.push(value), sz: () => events.push('open')})();
  return events;
}
assert.deepEqual(openExport(0), []);
assert.deepEqual(openExport(1), ['event', {kind: 'camera', cameraId: 'camera-0'}, 30, 1280, 'open']);
let started = 0;
evaluate('startExport', {il: document(0), sF: () => started++})();
assert.equal(started, 0, 'An existing export dialog cannot start after all cameras disappear');
evaluate('startExport', {il: document(1), sF: () => started++})();
assert.equal(started, 1);
assert.equal(evaluate('exportOpen', {sA: true, il: document(0)}), false);
assert.equal(evaluate('exportOpen', {sA: true, il: document(1)}), true);
assert.equal(evaluate('exportDisabled', {sC: false, il: document(0)}), true);
assert.equal(evaluate('exportDisabled', {sC: false, il: document(1)}), false);

for (const [editable, editing, choosing, accepted] of [[true, null, false, true], [false, null, false, false],
  [true, {}, false, false], [true, null, true, false]]) {
  const events = [];
  const bindings = {C: editable, rC: editing, cO: choosing, dN: () => events.push('stop'),
    cI: value => events.push(plain(value)), c4: id => {events.push(id);return true;}};
  const deleted = evaluate('deleteCamera', bindings)('camera-0');
  assert.equal(deleted, accepted);
  assert.deepEqual(events, accepted ? ['stop', 'camera-0'] : []);
  events.length = 0;
  evaluate('addCamera', bindings)();
  assert.deepEqual(events, accepted ? ['stop', {kind: 'current-view', presetId: 'current-view'}] : []);
}
for (const editable of [false, true]) {
  const opened = [];
  evaluate('shotKeyDown', {editable, clip: {id: 'cut-0', startFrame: 30}, setMenu: value => opened.push(plain(value))})({
    key: 'Enter', preventDefault() {}, stopPropagation() {},
    currentTarget: {getBoundingClientRect: () => ({left: 20, top: 40})},
  });
  assert.equal(opened.length, editable ? 1 : 0, 'Keyboard access cannot open an editable shot menu in a read-only timeline');
}

const monitorContext = {f: {visible: true, collapsed: false, empty: true}, t: {sceneCameraPreview: false, interactionMode: 'edit'},
  h: {monitorMode: 'authored'}, x: {}, e: {viewportWidth: 1280, viewportHeight: 720}};
assert.equal(evaluate('monitorVisible', monitorContext), false, 'The empty monitor never renders the internal fallback camera');
assert.equal(evaluate('monitorVisible', {...monitorContext, f: {...monitorContext.f, empty: false}}), true);
const modelContext = {w: false, c: false, A: {showCameraModel: true}, r: {cameraId: 'scene-camera'}, t: {shotCameras: []}};
assert.equal(evaluate('cameraModelVisible', modelContext), false, 'Zero cameras must hide the internal camera model even after navigating away from it');
assert.equal(evaluate('cameraModelVisible', {...modelContext, t: {shotCameras: [{id: 'scene-camera'}]}}), true);
assert.equal(evaluate('cameraModelVisible', {...modelContext, t: {}}), true, 'Legacy renderer inputs retain their authored camera');
assert.equal(evaluate('cameraModelVisible', {...modelContext, w: true}), true, 'A new preset can still display its placement preview');

console.log('Empty camera UI passed: camera/split lifecycle after undo, asset panel restoration, capture/export guards, first-camera creation, deletion guards and monitor/model rendering.');
