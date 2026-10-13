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
assert.equal(gesture('end', 200).changes[0].clips[0].endFrame, 260, 'End can overlap shots on other camera rows');
assert.equal(gesture('start', 80).changes[0].clips[0].startFrame, 59, 'A trim retains one frame');
assert.deepEqual(gesture('move', 30).changes[0].clips.map(clip => [clip.startFrame, clip.endFrame]), [[30, 90], [120, 180]]);
for (const cancel of ['blur', 'pointercancel', 'keydown']) assert.equal(gesture('end', 30, cancel).changes.length, 0);

// Numeric edits commit immediately. Feed committed props back through real hook
// effects so typing drafts are checked across the parent/child update boundary.
function liveEditorFixture() {
  const slots = [], changes = [];
  let tree, version = 0;
  const props = {clip: clips[0], track: {clips}, cameras, fps: 30, maximumFrame: 900,
    editable: true, onAppend() {}, onClose() {}, onChange(value) {
      const next = plain(value); changes.push(next);
      props.track = next; props.clip = next.clips.find(clip => clip.id === props.clip.id);
    }};
  const equalDeps = (a, b) => Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((value, index) => Object.is(value, b[index]));
  const render = updates => {
    Object.assign(props, updates);
    for (let pass = 0; pass < 8; pass++) {
      let cursor = 0;
      const effects = [];
      const effect = (callback, deps) => {
        const index = cursor++;
        if (!slots[index] || !equalDeps(slots[index].deps, deps)) effects.push(() => {
          slots[index]?.cleanup?.(); slots[index] = {deps, cleanup: callback()};
        });
      };
      context.n = {useEffect: effect, useLayoutEffect: effect,
        useState(initial) {
          const index = cursor++;
          if (!slots[index]) slots[index] = {value: typeof initial === 'function' ? initial() : initial};
          return [slots[index].value, update => {
            const next = typeof update === 'function' ? update(slots[index].value) : update;
            if (!Object.is(next, slots[index].value)) {slots[index].value = next; version++;}
          }];
        },
        useRef(initial) {
          const index = cursor++;
          return slots[index] ?? (slots[index] = {current: initial});
        }};
      tree = context.__LocalShotTimingEditor(props);
      const before = version; effects.forEach(callback => callback());
      if (version === before) return tree;
    }
    assert.fail('Live timing editor did not settle');
  };
  render();
  return {props, changes, render, get tree() {return tree;},
    input(label, value) {find(tree, 'aria-label', label).props.onChange({target: {value}}); return render();},
    blur(label) {find(tree, 'aria-label', label).props.onBlur(event()); return render();}};
}
const editor = liveEditorFixture();
assert.equal(button(editor.tree, '应用'), undefined, 'The bottom timing bar has no Apply button');
editor.input('片段开始时间', '0.5');
assert.deepEqual(editor.changes[0].clips.map(clip => [clip.startFrame, clip.endFrame]), [[15, 75], [120, 180]], 'A valid start edit is visible without another action');
editor.input('片段拍摄时长', '2.5');
assert.equal(editor.changes.length, 2);
assert.deepEqual(editor.changes.at(-1).clips.map(clip => [clip.startFrame, clip.endFrame]), [[15, 90], [120, 180]]);
assert.deepEqual(editor.changes.at(-1).clips[1], clips[1]);
for (const [field, value, label] of [['片段开始时间', '', 'empty'], ['片段开始时间', '-0.0001', 'small negative'],
  ['片段开始时间', 'NaN', 'not numeric'], ['片段拍摄时长', '0', 'zero'], ['片段拍摄时长', '-1', 'negative duration'],
  ['片段开始时间', '29', 'past 30s']]) {
  const invalid = liveEditorFixture();
  invalid.input(field, value);
  assert.equal(invalid.changes.length, 0, label + ' cannot commit');
  assert.deepEqual(invalid.props.track.clips, clips, label + ' preserves the last valid timeline');
  assert.ok(find(invalid.tree, 'role', 'alert'), label + ' explains the rejected range');
  invalid.blur(field);
  assert.equal(invalid.changes.length, 0, label + ' cannot commit on blur either');
}
const decimal = liveEditorFixture();
for (const raw of ['0.', '0.6', '0.66', '0.666']) {
  decimal.input('片段开始时间', raw);
  assert.equal(find(decimal.tree, 'aria-label', '片段开始时间').props.value, raw,
    'Own-commit prop synchronization preserves the decimal draft ' + raw);
}
assert.equal(decimal.props.clip.startFrame, 20);
assert.equal(decimal.changes.length, 2, 'Unchanged frame-rounded values do not create duplicate commits');
decimal.blur('片段开始时间');
assert.equal(find(decimal.tree, 'aria-label', '片段开始时间').props.value, '0.666667', 'Blur formats to the authored frame');
assert.equal(decimal.changes.length, 2);
decimal.input('片段拍摄时长', '1.016');
assert.equal(find(decimal.tree, 'aria-label', '片段拍摄时长').props.value, '1.016');
assert.equal(decimal.props.clip.endFrame, 50);
decimal.tree.props.onKeyDown(event({key: 'Enter', target: {tagName: 'INPUT'}})); decimal.render();
assert.equal(find(decimal.tree, 'aria-label', '片段拍摄时长').props.value, '1', 'Enter formats a valid draft');
assert.equal(decimal.changes.length, 3, 'Formatting does not commit unchanged timing again');
decimal.input('片段拍摄时长', '40');
assert.equal(decimal.changes.length, 3);
assert.ok(find(decimal.tree, 'role', 'alert'));
const externalTrack = {clips: [shot('a', 'camera-a', 90, 120), clips[1]]};
decimal.render({track: externalTrack, clip: externalTrack.clips[0]});
assert.equal(find(decimal.tree, 'aria-label', '片段开始时间').props.value, '3');
assert.equal(find(decimal.tree, 'aria-label', '片段拍摄时长').props.value, '1');
assert.equal(find(decimal.tree, 'role', 'alert'), undefined, 'External drag or history updates reset a stale invalid draft');
editor.render({editable: false});
assert.equal(find(editor.tree, 'aria-label', '片段拍摄时长').props.disabled, true);
editor.input('片段拍摄时长', '1'); editor.blur('片段拍摄时长');
assert.equal(editor.changes.length, 2, 'Read-only handler calls cannot change timing');
editor.render({editable: true});
editor.input('片段开始时间', '0'); editor.input('片段拍摄时长', '5');
assert.equal(editor.changes.at(-1).clips[0].endFrame, 150, 'Numeric editing allows another camera row to cover the same interval');
assert.deepEqual(editor.changes.at(-1).clips[1], clips[1], 'Cross-row overlap keeps the lower shot unchanged');
assert.equal(context.__localShotTiming({clips: [...clips, shot('same-camera', 'camera-a', 100, 200)]}, 'a', '0', '5', 30, 900).ok, false,
  'Two clips on the same row still cannot overlap');
assert.equal(context.__localShotTiming({clips}, 'a', '0', '5', 30, 900, 'camera-b').ok, false,
  'Changing a clip camera checks conflicts on its destination row');

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

// Empty-camera creation explains the next action and retains frame precision in compact seconds.
const emptyRequests = [], emptyClosed = [];
let insertionResult = {ok: false, reason: '请先完成或取消骨骼／姿势编辑，再添加镜头'};
const emptyMenu = component('__LocalShotMenu', {menu: {frame: 20, x: 300, y: 700},
  track: {clips: []}, cameras: [], fps: 30, maximumFrame: 900,
  onInsert: request => {emptyRequests.push(plain(request)); return insertionResult;},
  onClose: () => emptyClosed.push(true)});
assert.equal(find(emptyMenu.tree, 'aria-label', '镜头开始时间').props.value, '0.666667');
const emptySelect = find(emptyMenu.tree, 'aria-label', '镜头相机');
assert.equal(emptySelect.props.disabled, true);
assert.match(text(emptySelect), /暂无相机.*新建相机/);
assert.equal(button(emptyMenu.tree, '添加拍摄片段').props.disabled, true);
button(emptyMenu.tree, '新建相机').props.onClick(); emptyMenu.render();
assert.deepEqual(emptyRequests[0], {cameraId: '', startFrame: 20, durationFrames: 60, newCamera: true});
assert.equal(text(find(emptyMenu.tree, 'role', 'alert')), insertionResult.reason, 'Workspace failure is shown persistently inside the menu');
assert.equal(emptyClosed.length, 0, 'Rejected insertion keeps the timing fields available');
insertionResult = true;
button(emptyMenu.tree, '新建相机').props.onClick();
assert.equal(emptyClosed.length, 1, 'Successful retry closes the menu');
for (const fps of [24, 25, 30, 60, 120]) {
  const requests = [];
  const lastFrameMenu = component('__LocalShotMenu', {menu: {frame: fps * 30 - 1, durationFrames: 1, x: 0, y: 700},
    track: {clips: []}, cameras: [], fps, maximumFrame: fps * 30, onClose() {},
    onInsert: request => requests.push(plain(request))});
  button(lastFrameMenu.tree, '新建相机').props.onClick();
  assert.equal(requests[0].startFrame, fps * 30 - 1, 'Compact seconds preserve the final frame at ' + fps + ' FPS');
  assert.equal(requests[0].durationFrames, 1);
}
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
