import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import {createRequire} from 'node:module';

const require = createRequire(import.meta.url);
const factories = JSON.parse(await fs.readFile(new URL('../src/vendor/module-factories.json', import.meta.url), 'utf8'));
require('../src/patches/camera-cut-sequencer.cjs')(factories);
const source = factories['53401'];
const ast = require('@babel/parser').parse('(' + source + ')');
const jsx = (type, props, key) => ({type, props: props || {}, key});
const listeners = new Map();
const context = vm.createContext({i: {jsx, jsxs: jsx},
  mI: {A: 'delete-icon'}, mS: {A: 'add-icon'}, pR: {A: 'preview-icon'},
  oy: {A: 'close-icon'}, cj: {A: 'camera-icon'}, tC: 'scene-camera',
  document: {querySelector: () => null}, window: {innerWidth: 1280, innerHeight: 900,
    addEventListener: (type, listener) => listeners.set(type, listener),
    removeEventListener: (type, listener) => {if (listeners.get(type) === listener) listeners.delete(type);}}});
for (const node of ast.program.body[0].expression.body.body)
  if (node.type === 'FunctionDeclaration') vm.runInContext(source.slice(node.start - 1, node.end - 1), context);
const plain = value => JSON.parse(JSON.stringify(value));
const shot = (id, cameraId, startFrame, endFrame) => ({id, cameraId, startFrame, endFrame, createdAt: '2026-10-09T00:00:00.000Z'});
const clips = [shot('a', 'camera-a', 0, 60), shot('b', 'camera-b', 120, 180)];
const cameras = [{id: 'camera-a', name: '相机 1'}, {id: 'camera-b', name: '相机 2'}, {id: 'camera-c', name: '相机 3'}];
const elements = value => Array.isArray(value) ? value.flatMap(elements) :
  value && typeof value === 'object' ? [value, ...elements(value.props?.children)] : [];
const find = (tree, field, value) => elements(tree).find(node => node.props[field] === value);
const text = node => Array.isArray(node) ? node.map(text).join('') :
  node && typeof node === 'object' ? text(node.props?.children) : node == null || node === false ? '' : String(node);
const button = (tree, label) => elements(tree).find(node => node.type === 'button' && text(node) === label);
function component(name, props) {
  const state = [], refs = [], effects = [];
  let tree;
  const render = updates => {
    Object.assign(props, updates);
    let cursor = 0, refCursor = 0;
    context.n = {useMemo: callback => callback(), useCallback: callback => callback,
      useEffect: callback => effects.push(callback), useLayoutEffect: () => {}, useSyncExternalStore: (_subscribe, snapshot) => snapshot(),
      useState: initial => {const index = cursor++; if (!(index in state)) state[index] = typeof initial === 'function' ? initial() : initial;
        return [state[index], value => {state[index] = typeof value === 'function' ? value(state[index]) : value;}];},
      useRef: initial => refs[refCursor++] ?? (refs[refCursor - 1] = {current: initial})};
    tree = context[name](props); return tree;
  };
  render();
  return {render, state, refs, effects, get tree() {return tree;},
    input(label, value) {find(tree, 'aria-label', label).props.onChange({target: {value}}); return render();}};
}
const rect = {left: 180, right: 1200, top: 700};
const event = additions => ({button: 0, isPrimary: true, pointerId: 1, clientX: 200, clientY: 700,
  currentTarget: {getBoundingClientRect: () => rect, focus() {}}, preventDefault() {}, stopPropagation() {}, ...additions});
function trackFixture(trackClips = clips, extra = {}) {
  const changes = [], seeks = [], previews = [], selections = [];
  const props = {track: {version: 1, clips: trackClips}, cameras, boundaryKey: 'test',
    editable: true, scale: {displayFps: 30, pixelsPerFrame: 5, edgeGutterPx: 0, contentWidthPx: 4500}, scrollLeftPx: 0,
    clock: {subscribe: () => () => {}, getSnapshot: () => 0}, onChange: value => changes.push(plain(value)),
    onSeek: value => seeks.push(value), onSelectCamera: value => selections.push(value),
    onPreview: () => previews.push(true), ...extra};
  const ui = component('__LocalShotTrack', props);
  ui.refs[0].current = {getBoundingClientRect: () => rect};
  return {ui, changes, seeks, previews, selections};
}

// Find a usable slot without resetting the playhead or overlapping existing shots.
const contiguous = {clips: [shot('a', 'camera-a', 0, 60), shot('b', 'camera-b', 60, 120)]};
assert.deepEqual(plain(context.__localNextShotGap(contiguous, 0, 900)), {startFrame: 120, endFrame: 900});
assert.deepEqual(plain(context.__localNextShotGap({clips}, 30, 900)), {startFrame: 60, endFrame: 120});
assert.deepEqual(plain(context.__localNextShotGap({clips}, 899, 900)), {startFrame: 899, endFrame: 900});
assert.equal(context.__localNextShotGap({clips}, 900, 900), null);
assert.equal(context.__localNextShotGap({clips: [shot('late', 'camera-a', 1000, 1100)]}, 950, 900), null);

// Visible empty state, plus and right-click defaults use the same frame quantization.
const empty = trackFixture([]);
assert.equal(find(empty.ui.tree, 'aria-label', '预览镜头剪辑').props.disabled, true);
const emptyAdd = find(empty.ui.tree, 'data-testid', 'director-stage-shot-empty-add');
assert.match(text(emptyAdd), /设置开始和时长/);
emptyAdd.props.onClick(event()); empty.ui.render();
assert.equal(empty.ui.state[1].frame, 0);
assert.equal(empty.ui.state[1].durationFrames, 60);
const occupied = trackFixture();
find(occupied.ui.tree, 'data-testid', 'director-stage-storyboard-add').props.onClick(event()); occupied.ui.render();
assert.equal(occupied.ui.state[1].frame, 60);
assert.equal(occupied.ui.state[1].cameraId, 'camera-c', 'Prefer an unassigned camera for the next shot');
assert.equal(occupied.ui.state[1].durationFrames, 60);
const tail = trackFixture([], {clock: {subscribe: () => () => {}, getSnapshot: () => 899 / 30}});
find(tail.ui.tree, 'data-testid', 'director-stage-storyboard-add').props.onClick(event());
assert.equal(tail.ui.state[1].durationFrames, 1, 'A final one-frame slot remains usable');
const surface = elements(tail.ui.tree).find(node => node.props.onContextMenu && !node.props['data-testid']);
surface.props.onContextMenu(event({clientX: rect.left + 899 * 5}));
assert.equal(tail.ui.state[1].frame, 899);
assert.equal(tail.ui.state[1].durationFrames, 1, 'Right-click also limits the default duration to available space');

// Production pointer handlers: a click selects and previews; edges trim only that shot.
function gesture(mode, deltaFrames, cancel) {
  listeners.clear();
  const fixture = trackFixture();
  const clip = find(fixture.ui.tree, 'data-testid', 'director-stage-storyboard-clip-a');
  const target = mode === 'move' ? clip : find(clip, 'aria-label', (mode === 'start' ? '调整镜头开始 ' : '调整镜头结束 ') + '相机 1');
  target.props.onPointerDown(event());
  if (deltaFrames) listeners.get('pointermove')(event({clientX: 200 + deltaFrames * 5}));
  assert.equal(fixture.changes.length, 0, 'Dragging is transient until pointer-up');
  if (cancel) listeners.get(cancel)(event({key: 'Escape'}));
  else listeners.get('pointerup')(event({clientX: 200 + deltaFrames * 5}));
  fixture.ui.render();
  assert.equal(listeners.size, 0, 'Pointer and cancellation listeners are released');
  return fixture;
}
const clicked = gesture('move', 0);
assert.deepEqual(clicked.selections, ['camera-a']); assert.deepEqual(clicked.seeks, [0]);
assert.equal(clicked.previews.length, 1);
assert.ok(elements(clicked.ui.tree).some(node => node.type === context.__LocalShotTimingEditor), 'Selected shot exposes the duration editor');
const endTrim = gesture('end', 30);
assert.equal(endTrim.changes.length, 1);
assert.deepEqual(endTrim.changes[0].clips.map(clip => [clip.startFrame, clip.endFrame]), [[0, 90], [120, 180]]);
assert.equal(gesture('end', 200).changes[0].clips[0].endFrame, 120, 'End stops at the next shot');
assert.equal(gesture('start', 80).changes[0].clips[0].startFrame, 59, 'A trim retains one frame');
assert.deepEqual(gesture('move', 30).changes[0].clips.map(clip => [clip.startFrame, clip.endFrame]), [[30, 90], [120, 180]]);
for (const cancel of ['blur', 'pointercancel', 'keydown']) assert.equal(gesture('end', 30, cancel).changes.length, 0);

// Numeric edits operate on the selected shot alone, with actual input/button handlers.
const changes = [];
const editor = component('__LocalShotTimingEditor', {clip: clips[0], track: {clips}, cameras, fps: 30, maximumFrame: 900,
  editable: true, onChange: value => changes.push(plain(value)), onAppend() {}, onClose() {}});
editor.input('片段开始时间', '0.5'); editor.input('片段拍摄时长', '2.5');
button(editor.tree, '应用').props.onClick(); editor.render();
assert.deepEqual(changes[0].clips.map(clip => [clip.startFrame, clip.endFrame]), [[15, 90], [120, 180]]);
assert.deepEqual(changes[0].clips[1], clips[1]);
for (const [start, duration, label] of [['', '1', 'empty'], ['-0.0001', '1', 'small negative'], ['NaN', '1', 'not numeric'],
  ['0', '0', 'zero'], ['0', '-1', 'negative duration'], ['29', '2', 'past 30s'], ['0', '5', 'overlap']]) {
  editor.input('片段开始时间', start); editor.input('片段拍摄时长', duration);
  button(editor.tree, '应用').props.onClick(); editor.render();
  assert.equal(changes.length, 1, label + ' cannot commit');
  assert.ok(find(editor.tree, 'role', 'alert'), label + ' explains the rejected range');
}
editor.input('片段开始时间', '0.033333'); editor.input('片段拍摄时长', '1.016');
editor.tree.props.onKeyDown(event({key: 'Enter', target: {tagName: 'INPUT'}})); editor.render();
assert.equal(changes[1].clips[0].startFrame, 1); assert.equal(changes[1].clips[0].endFrame, 31);
editor.render({editable: false});
assert.equal(find(editor.tree, 'aria-label', '片段拍摄时长').props.disabled, true);
button(editor.tree, '应用').props.onClick(); assert.equal(changes.length, 2);

// The add/edit menu preserves camera identity, exact timing and enabled metadata.
const inserted = [], changed = [], closed = [];
const menu = component('__LocalShotMenu', {menu: {frame: 899, x: 300, y: 700, durationFrames: 1, cameraId: 'camera-b'},
  track: {clips: []}, cameras, fps: 30, maximumFrame: 900,
  onInsert: value => inserted.push(plain(value)), onChange: value => changed.push(plain(value)), onClose: () => closed.push(true)});
button(menu.tree, '添加拍摄片段').props.onClick();
assert.equal(inserted[0].startFrame, 899); assert.equal(inserted[0].durationFrames, 1); assert.equal(inserted[0].cameraId, 'camera-b');
assert.equal(closed.length, 1);
const editMenu = component('__LocalShotMenu', {menu: {clipId: 'a', frame: 0, x: 300, y: 700}, track: {clips}, cameras,
  fps: 30, maximumFrame: 900, onInsert() {}, onChange: value => changed.push(plain(value)), onClose() {}});
editMenu.input('镜头时长', '3'); button(editMenu.tree, '应用').props.onClick();
assert.equal(changed[0].clips[0].endFrame, 90); assert.deepEqual(changed[0].clips[1], clips[1]);
// Keyboard entry lands inside the menu, tabs cycle and closing restores its trigger.
const focusEvents = [];
const trigger = {isConnected: true, focus: () => {context.document.activeElement = trigger; focusEvents.push('trigger');}};
const firstControl = {focus: () => {context.document.activeElement = firstControl; focusEvents.push('first');}};
const lastControl = {focus: () => {context.document.activeElement = lastControl; focusEvents.push('last');}};
const controls = [firstControl, lastControl];
menu.refs[0].current = {querySelector: () => firstControl, querySelectorAll: () => controls, contains: node => controls.includes(node)};
context.document.activeElement = trigger;
const closeFocus = menu.effects[0]();
assert.equal(context.document.activeElement, firstControl);
let tabsPrevented = 0;
context.document.activeElement = lastControl;
menu.tree.props.onKeyDown(event({key: 'Tab', preventDefault: () => tabsPrevented++}));
assert.equal(context.document.activeElement, firstControl);
menu.tree.props.onKeyDown(event({key: 'Tab', shiftKey: true, preventDefault: () => tabsPrevented++}));
assert.equal(context.document.activeElement, lastControl);
assert.equal(tabsPrevented, 2);
closeFocus();
assert.equal(context.document.activeElement, trigger);
assert.equal(listeners.size, 0);
console.log('Shot timing UI passed: empty/add defaults, free slots, one-frame tail, pointer trim/move/cancel, per-shot numeric edits, overlap/30s validation, read-only state and menu routing.');
