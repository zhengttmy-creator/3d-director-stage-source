import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import {createRequire} from 'node:module';

const require = createRequire(import.meta.url);
const factories = JSON.parse(await fs.readFile(new URL('../src/vendor/module-factories.json', import.meta.url), 'utf8'));
for (const name of ['limit-timeline', 'model-colors']) require('../src/patches/' + name + '.cjs')(factories);
factories['53401'] = require('../src/patches/motion-loader.cjs').patchMotionLoader(factories['53401']);
for (const name of ['patch-local-motion-library', 'motion-previews', 'pose-library', 'folder-models',
  'root-motion', 'transform-autokey', 'camera-position-autokey', 'body-presets', 'disable-scene-drafts',
  'patch-camera-target-selection', 'manual-timeline-keyframes', 'curve-easing', 'skeletal-keyframes',
  'pose-continuation-alignment', 'skeletal-playback', 'camera-cut-sequencer', 'empty-cameras',
  'empty-scene-startup', 'empty-camera-ui', 'background-upload', 'camera-track-export', 'camera-row-sequencer']) {
  require('../src/patches/' + name + '.cjs')(factories);
}
const source = factories['53401'];
new vm.Script('(' + source + ')');
const ast = require('@babel/parser').parse('(' + source + ')');
const extract = node => source.slice(node.start - 1, node.end - 1);
let timelineFunction, keyboardCaptureSource;
require('@babel/traverse').default(ast, {FunctionDeclaration(path) {
  if (path.node.id.name === 'hL') timelineFunction = path.node;
}, ArrowFunctionExpression(path) {
  const callback = extract(path.node);
  if (callback.includes('if(!P&&g_(e)&&!gZ(e.target)&&e.target?.closest?.("[data-director-shot-keyboard]"))return;') &&
      (!keyboardCaptureSource || callback.length < keyboardCaptureSource.length)) keyboardCaptureSource = callback;
}});
assert.ok(keyboardCaptureSource, 'Exercise the real window capture handler before bubbling into camera clips');
assert.ok(timelineFunction);
const timelineSource = extract(timelineFunction);
assert.equal((timelineSource.match(/__localUseCameraShotController\(/g) ?? []).length, 1,
  'All camera rows must share exactly one controller in the timeline, not create independent state');
assert.equal((timelineSource.match(/__LocalCameraShotLane/g) ?? []).length, 1,
  'The existing camera row renders its own camera lane');
assert.equal((timelineSource.match(/__LocalCameraShotFooter/g) ?? []).length, 1,
  'One footer owns the shared timing editor and menu');
assert.doesNotMatch(timelineSource, /\(hk,\{/,
  'The old separate shot lane must not duplicate the camera-root clips');
const jsx = (type, props, key) => ({type, props: props || {}, key});
const listeners = new Map();
let activeDialog = null;
const context = vm.createContext({i: {jsx, jsxs: jsx, Fragment: 'Fragment'},
  mI: {A: 'delete-icon'}, mS: {A: 'add-icon'}, pR: {A: 'preview-icon'},
  oy: {A: 'close-icon'}, cj: {A: 'camera-icon'}, tC: 'scene-camera',
  document: {querySelector: () => activeDialog}, window: {innerWidth: 1280, innerHeight: 900,
    addEventListener: (type, listener) => {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type).add(listener);
    },
    removeEventListener: (type, listener) => {
      listeners.get(type)?.delete(listener);
      if (!listeners.get(type)?.size) listeners.delete(type);
    }}});
for (const node of ast.program.body[0].expression.body.body)
  if (node.type === 'FunctionDeclaration') vm.runInContext(extract(node), context);
require('@babel/traverse').default(ast, {VariableDeclarator(path) {
  if (['gq', 'gQ', 'gJ'].includes(path.node.id.name) && path.node.init?.type === 'StringLiteral')
    context[path.node.id.name] = path.node.init.value;
}});
for (const name of ['__localUseCameraShotController', '__LocalCameraShotLane', '__LocalCameraShotFooter'])
  assert.equal(typeof context[name], 'function', name + ' must be integrated into the application factory');
const plain = value => JSON.parse(JSON.stringify(value));
const shot = (id, cameraId, startFrame, endFrame, enabled = true) => ({id, cameraId, startFrame, endFrame,
  ...(enabled ? {} : {enabled: false}), createdAt: '2026-10-10T00:00:00.000Z'});
const cameras = [{id: 'camera-a', name: '相机 1'}, {id: 'camera-b', name: '相机 2'}, {id: 'camera-c', name: '相机 3'}];
const clips = [shot('a', 'camera-a', 0, 30), shot('b', 'camera-b', 30, 60), shot('c', 'camera-c', 60, 90)];
const elements = value => Array.isArray(value) ? value.flatMap(elements) :
  value && typeof value === 'object' ? [value, ...elements(value.props?.children)] : [];
const find = (tree, field, value) => elements(tree).find(node => node.props[field] === value);
const text = node => Array.isArray(node) ? node.map(text).join('') :
  node && typeof node === 'object' ? text(node.props?.children) : node == null || node === false ? '' : String(node);
const button = (tree, label) => elements(tree).find(node => node.type === 'button' && text(node) === label);
const equalDeps = (a, b) => Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((value, index) => Object.is(value, b[index]));
function hookFixture(name, props) {
  const slots = [];
  let value, version = 0;
  const render = updates => {
    Object.assign(props, updates);
    for (let pass = 0; pass < 8; pass++) {
      let cursor = 0;
      const effects = [];
      const memo = (factory, deps) => {
        const index = cursor++;
        if (!slots[index] || !equalDeps(slots[index].deps, deps)) slots[index] = {value: factory(), deps};
        return slots[index].value;
      };
      const effect = (callback, deps) => {
        const index = cursor++;
        if (!slots[index] || !equalDeps(slots[index].deps, deps)) effects.push(() => {
          slots[index]?.cleanup?.();
          slots[index] = {deps, cleanup: callback()};
        });
      };
      context.n = {
        useMemo: memo, useCallback: (callback, deps) => memo(() => callback, deps),
        useEffect: effect, useLayoutEffect: effect,
        useSyncExternalStore: (_subscribe, snapshot) => snapshot(),
        useState: initial => {
          const index = cursor++;
          if (!slots[index]) slots[index] = {value: typeof initial === 'function' ? initial() : initial};
          return [slots[index].value, update => {
            const next = typeof update === 'function' ? update(slots[index].value) : update;
            if (!Object.is(next, slots[index].value)) {slots[index].value = next; version++;}
          }];
        },
        useRef: initial => {
          const index = cursor++;
          if (!slots[index]) slots[index] = {current: initial};
          return slots[index];
        },
      };
      value = context[name](props);
      const before = version;
      effects.forEach(callback => callback());
      if (version === before) return value;
    }
    assert.fail('Hook did not settle after effect updates');
  };
  const unmount = () => slots.forEach(slot => slot.cleanup?.());
  render();
  return {props, slots, render, unmount, get value() {return value;}};
}
const rect = {left: 180, right: 1200, top: 400};
const target = extra => ({getBoundingClientRect: () => rect, focus() {}, closest: () => null, ...extra});
const event = extra => ({button: 0, isPrimary: true, pointerId: 1, clientX: 250, clientY: 420,
  currentTarget: target(), preventDefault() {}, stopPropagation() {}, ...extra});
const dispatch = (type, values = {}) => {
  const callbacks = [...(listeners.get(type) ?? [])];
  assert.ok(callbacks.length, 'Expected a registered ' + type + ' handler');
  callbacks.forEach(callback => callback(event(values)));
};

// Assertions continue with the production controller and lane APIs below.
function fixture(trackClips = clips, extra = {}) {
  const changes = [], seeks = [], previews = [], selections = [], deleted = [], gestures = [];
  const scrollLeftPx = extra.scrollLeftPx ?? 0;
  const scrollRef = {current: {scrollLeft: scrollLeftPx, getBoundingClientRect: () => ({left: 0, right: 1280, top: 300})}};
  const surfaceRef = {current: {getBoundingClientRect: () => ({left: 180 - scrollRef.current.scrollLeft, right: 4680 - scrollRef.current.scrollLeft})}};
  const props = {track: {version: 1, clips: trackClips}, cameras, boundaryKey: 'test', editable: true,
    scale: {displayFps: 30, pixelsPerFrame: 5, edgeGutterPx: 8, durationFrames: 900, contentWidthPx: 4508}, scrollLeftPx,
    clock: {subscribe: () => () => {}, getSnapshot: () => 0}, scrollRef, surfaceRef,
    frameAtClientX: x => (x - surfaceRef.current.getBoundingClientRect().left - 8) / 5,
    onChange: value => changes.push(plain(value)), onSeek: value => seeks.push(value),
    onSelectCamera: value => selections.push(value), onPreview: () => previews.push(true),
    onDeleteCamera: id => {deleted.push(id); return true;},
    onScrollLeftChange: value => {scrollRef.current.scrollLeft = value; return value;},
    onGestureCancelChange: value => gestures.push(value), ...extra};
  const ui = hookFixture('__localUseCameraShotController', props);
  return {ui, changes, seeks, previews, selections, deleted, gestures,
    lane: cameraId => context.__LocalCameraShotLane({controller: ui.value, cameraId}),
    footer: () => context.__LocalCameraShotFooter({controller: ui.value}),
    get model() {return ui.value;},
    render: update => ui.render(update), unmount: ui.unmount};
}
const clipElement = (test, id, cameraId) => find(test.lane(cameraId), 'data-testid', 'director-stage-storyboard-clip-' + id);
const footerEditor = test => elements(test.footer()).find(node => node.type === context.__LocalShotTimingEditor);
const footerMenu = test => elements(test.footer()).find(node => node.type === context.__LocalShotMenu);
const focusClip = (test, id, cameraId) => {
  const currentTarget = target();
  clipElement(test, id, cameraId).props.onFocus(event({target: currentTarget, currentTarget}));
  test.render();
};
const keyboardTarget = (kind = 'clip', owner = null) => {
  const native = ['input', 'textarea', 'select', 'editable'].includes(kind);
  const node = {tagName: kind === 'input' ? 'INPUT' : kind === 'textarea' ? 'TEXTAREA' : kind === 'select' ? 'SELECT' : 'DIV',
    isContentEditable: kind === 'editable',
    matches: selector => selector === context.gq && native,
    closest(selector) {
      if (selector === context.gq) return native ? node : null;
      if (selector === '[data-director-shot-keyboard]') return owner;
      if (selector === context.gQ) return node;
      return null;
    }, ...target()};
  // Keep the editable-control lookup above; target() provides only geometry/focus here.
  node.closest = selector => selector === context.gq ? native ? node : null :
    selector === '[data-director-shot-keyboard]' ? owner : selector === context.gQ ? node : null;
  return node;
};

// Every existing camera row owns only its cuts. Native scroll is applied by the parent once.
for (const scrollLeftPx of [0, 125, 400]) {
  const test = fixture(clips, {scrollLeftPx});
  cameras.forEach((camera, index) => {
    const lane = test.lane(camera.id);
    const own = elements(lane).filter(node => node.props['data-camera-shot']);
    assert.equal(own.length, 1, camera.id + ' must not render another camera’s shots');
    assert.equal(own[0].props['data-testid'], 'director-stage-storyboard-clip-' + clips[index].id);
    assert.equal(own[0].props['data-camera-id'], camera.id);
    const position = plain(context.fy(test.model.scale, clips[index].startFrame, clips[index].endFrame));
    assert.equal(own[0].props.style.left, position.left, 'Shot left is in content coordinates, without subtracting horizontal scroll again');
    assert.equal(own[0].props.style.width, position.width);
    assert.equal(lane.props.style.transform, undefined, 'Lane must not double-translate the native scroll container');
    const empty = fixture([], {scrollLeftPx});
    const emptyLane = empty.lane(camera.id);
    assert.equal(find(emptyLane, 'data-testid', 'director-stage-camera-shot-add-' + camera.id).props.style.left, 8, 'Empty-row add button stays in timeline content coordinates');
    empty.unmount();
    assert.equal(own[0].props.style.transform, undefined);
  });
  assert.equal(elements(test.footer()).filter(node => node.props['data-camera-shot']).length, 0,
    'The footer has controls only, never duplicate shot rectangles');
  const x = 180 - scrollLeftPx + 8 + 45 * 5;
  assert.equal(test.model.atPointer(event({clientX: x})), 45, 'Right-click position must include parent scroll exactly once');
  test.unmount();
}
const boundary = fixture(clips, {clock: {subscribe: () => () => {}, getSnapshot: () => 1}});
assert.equal(clipElement(boundary, 'a', 'camera-a').props['aria-current'], undefined);
assert.equal(clipElement(boundary, 'b', 'camera-b').props['aria-current'], 'true', 'Adjacent camera rows change active state at the exact common boundary');
assert.equal(clipElement(boundary, 'c', 'camera-c').props['aria-current'], undefined);
boundary.unmount();

// Selection and the single timing editor are shared across rows, with no stale previous-row selection.
const shared = fixture();
focusClip(shared, 'a', 'camera-a');
assert.equal(footerEditor(shared).props.clip.id, 'a');
assert.equal(clipElement(shared, 'a', 'camera-a').props['aria-selected'], true);
focusClip(shared, 'b', 'camera-b');
assert.equal(footerEditor(shared).props.clip.id, 'b');
assert.equal(clipElement(shared, 'a', 'camera-a').props['aria-selected'], false);
assert.equal(clipElement(shared, 'b', 'camera-b').props['aria-selected'], true);
assert.equal(elements(shared.footer()).filter(node => node.type === context.__LocalShotTimingEditor).length, 1);
const editorProps = footerEditor(shared).props;
assert.equal(editorProps.track, shared.model.normalized, 'Timing edits operate on the shared full track, preserving other camera rows');
assert.equal(editorProps.onChange, shared.ui.props.onChange);
assert.equal(editorProps.maximumFrame, 900);
editorProps.onClose(); shared.render();
assert.equal(footerEditor(shared), undefined);
assert.equal(shared.model.selected, null);
shared.unmount();

// Clicking a cut still previews its camera and seeks; Enter does the same without changing authored timing.
const clicked = fixture();
clipElement(clicked, 'b', 'camera-b').props.onPointerDown(event({clientX: 500}));
dispatch('pointerup', {clientX: 500}); clicked.render();
assert.deepEqual(clicked.selections, ['camera-b']); assert.deepEqual(clicked.seeks, [1]);
assert.equal(clicked.previews.length, 1); assert.equal(clicked.changes.length, 0);
assert.equal(footerEditor(clicked).props.clip.id, 'b');
clipElement(clicked, 'c', 'camera-c').props.onKeyDown(event({key: 'Enter', target: keyboardTarget()})); clicked.render();
assert.deepEqual(clicked.selections, ['camera-b', 'camera-c']);
assert.deepEqual(clicked.seeks, [1, 2]); assert.equal(clicked.previews.length, 2);
assert.equal(footerEditor(clicked).props.clip.id, 'c');
assert.equal(listeners.size, 0); clicked.unmount();

// Empty-row actions retain the clicked camera and can start over another camera's shot.
const emptyRow = fixture([clips[0]]);
const addSecond = find(emptyRow.lane('camera-b'), 'data-testid', 'director-stage-camera-shot-add-camera-b');
assert.ok(addSecond); addSecond.props.onClick(event()); emptyRow.render();
assert.equal(emptyRow.model.menu.cameraId, 'camera-b');
assert.equal(emptyRow.model.menu.frame, 0, 'Other camera layers cannot displace the selected row start time');
assert.equal(emptyRow.model.menu.durationFrames, 60);
assert.equal(footerMenu(emptyRow).props.menu, emptyRow.model.menu, 'All lane menus are rendered by the one shared footer');
emptyRow.model.closeMenu(); emptyRow.render();
emptyRow.lane('camera-c').props.onContextMenu(event({clientX: 180 + 8 + 120 * 5})); emptyRow.render();
assert.equal(emptyRow.model.menu.cameraId, 'camera-c');
assert.equal(emptyRow.model.menu.frame, 120);
assert.equal(footerMenu(emptyRow).props.track, emptyRow.model.normalized);
emptyRow.unmount();
const tail = fixture([], {clock: {subscribe: () => () => {}, getSnapshot: () => 899 / 30}});
find(tail.lane('camera-b'), 'data-testid', 'director-stage-camera-shot-add-camera-b').props.onClick(event()); tail.render();
assert.equal(tail.model.menu.frame, 899); assert.equal(tail.model.menu.durationFrames, 1);
tail.unmount();
const noCameras = fixture([], {cameras: []});
assert.equal(noCameras.lane('camera-a'), null);
assert.equal(find(noCameras.footer(), 'aria-label', '预览镜头剪辑').props.disabled, true);
assert.match(text(find(noCameras.footer(), 'data-testid', 'director-stage-storyboard-add')), /添加相机/);
noCameras.unmount();

// Draft drag state is shared by lane and footer until a single pointer-up commit.
const gapped = [shot('a', 'camera-a', 0, 30), shot('b', 'camera-b', 60, 90), shot('c', 'camera-c', 120, 150)];
function startGesture(mode, {delta = 10, extra = {}, cameraId = 'camera-b', id = 'b'} = {}) {
  const test = fixture(gapped, extra);
  const clip = clipElement(test, id, cameraId);
  const handle = mode === 'move' ? clip : find(clip, 'aria-label', (mode === 'start' ? '调整镜头开始 ' : '调整镜头结束 ') + '相机 2');
  handle.props.onPointerDown(event({clientX: 500}));
  dispatch('pointermove', {clientX: 500 + delta * 5}); test.render();
  assert.equal(test.changes.length, 0);
  assert.equal(test.model.selected, id);
  return test;
}
for (const [mode, expectedStart, expectedEnd] of [['move', 70, 100], ['start', 70, 90], ['end', 60, 100]]) {
  const test = startGesture(mode);
  const preview = clipElement(test, 'b', 'camera-b');
  assert.equal(preview.props['data-start-frame'], expectedStart);
  assert.equal(preview.props['data-end-frame'], expectedEnd);
  assert.equal(footerEditor(test).props.clip.startFrame, expectedStart);
  assert.equal(footerEditor(test).props.clip.endFrame, expectedEnd);
  assert.equal(clipElement(test, 'a', 'camera-a').props['data-start-frame'], 0);
  assert.equal(clipElement(test, 'c', 'camera-c').props['data-end-frame'], 150);
  dispatch('pointerup', {clientX: 550}); test.render();
  assert.equal(test.changes.length, 1);
  assert.deepEqual(test.changes[0].clips.map(clip => [clip.startFrame, clip.endFrame]), [[0, 30], [expectedStart, expectedEnd], [120, 150]]);
  assert.equal(test.gestures.at(-1), null);
  assert.equal(listeners.size, 0);
  test.unmount();
}
for (const cancel of ['blur', 'pointercancel', 'keydown']) {
  const test = startGesture('end');
  dispatch(cancel, {key: 'Escape'}); test.render();
  assert.equal(test.changes.length, 0);
  assert.equal(clipElement(test, 'b', 'camera-b').props['data-end-frame'], 90);
  assert.equal(listeners.size, 0);
  test.unmount();
}
for (const update of [{editable: false}, {boundaryKey: 'new-document'}, {scale: {displayFps: 60, pixelsPerFrame: 5, edgeGutterPx: 8, contentWidthPx: 4508}}]) {
  const test = startGesture('move');
  test.render(update);
  assert.equal(listeners.size, 0, 'Changing edit context cancels a live camera drag');
  assert.equal(test.changes.length, 0);
  assert.equal(test.model.shown.clips[1].startFrame, 60);
  test.unmount();
}
const unmounted = startGesture('end'); unmounted.unmount();
assert.equal(listeners.size, 0, 'Unmount releases all window-level drag handlers');
assert.equal(unmounted.changes.length, 0);

// Scroll while dragging contributes only the actual scroll delta, not another copy of the initial offset.
const scrolled = startGesture('move', {extra: {scrollLeftPx: 125}});
assert.equal(scrolled.model.selectedClip.startFrame, 70);
scrolled.ui.props.scrollRef.current.scrollLeft = 150;
dispatch('pointermove', {clientX: 550}); scrolled.render();
assert.equal(scrolled.model.selectedClip.startFrame, 75);
dispatch('pointerup', {clientX: 550});
assert.equal(scrolled.changes[0].clips[1].startFrame, 75);
scrolled.unmount();

// Existing timing editor updates only the selected camera’s cut, despite sharing state across all rows.
const numerical = fixture(gapped);
focusClip(numerical, 'b', 'camera-b');
const numericalEditor = hookFixture('__LocalShotTimingEditor', {...footerEditor(numerical).props});
assert.equal(button(numericalEditor.value, '应用'), undefined, 'The shared footer timing editor has no Apply button');
find(numericalEditor.value, 'aria-label', '片段开始时间').props.onChange({target: {value: '2.1'}});
assert.equal(numerical.changes.length, 1);
assert.deepEqual(numerical.changes[0].clips.map(clip => [clip.startFrame, clip.endFrame]), [[0, 30], [63, 93], [120, 150]]);
numerical.render({track: numerical.changes.at(-1)});
numericalEditor.render({...footerEditor(numerical).props});
assert.equal(clipElement(numerical, 'b', 'camera-b').props['data-start-frame'], 63, 'Live start edits update the corresponding camera row');
find(numericalEditor.value, 'aria-label', '片段拍摄时长').props.onChange({target: {value: '1.2'}});
assert.equal(numerical.changes.length, 2);
numerical.render({track: numerical.changes.at(-1)});
numericalEditor.render({...footerEditor(numerical).props});
assert.equal(clipElement(numerical, 'b', 'camera-b').props['data-end-frame'], 99, 'Live duration edits update the corresponding camera row');
assert.deepEqual(numerical.changes.at(-1).clips.map(clip => [clip.startFrame, clip.endFrame]), [[0, 30], [63, 99], [120, 150]]);
assert.deepEqual(numerical.changes.at(-1).clips[0], gapped[0]);
assert.deepEqual(numerical.changes.at(-1).clips[2], gapped[2]);
find(numericalEditor.value, 'aria-label', '片段拍摄时长').props.onChange({target: {value: '40'}}); numericalEditor.render();
assert.equal(numerical.changes.length, 2, 'An invalid live edit cannot overwrite the shared track');
assert.equal(clipElement(numerical, 'b', 'camera-b').props['data-end-frame'], 99);
numericalEditor.unmount(); numerical.unmount();

// Read-only lanes never mutate timing or open an editable menu; they remain usable for preview.
const readonly = fixture(gapped, {editable: false});
const readonlyClip = clipElement(readonly, 'b', 'camera-b');
readonlyClip.props.onPointerDown(event());
readonlyClip.props.onContextMenu(event()); readonly.render();
readonlyClip.props.onKeyDown(event({key: 'ArrowRight', target: keyboardTarget()}));
readonlyClip.props.onKeyDown(event({key: 'Delete', target: keyboardTarget(), currentTarget: keyboardTarget()}));
assert.equal(listeners.size, 0); assert.equal(readonly.model.menu, null);
assert.deepEqual(readonly.changes, []); assert.deepEqual(readonly.deleted, []);
assert.equal(find(readonlyClip, 'aria-label', '调整镜头结束 相机 2'), undefined);
assert.equal(find(readonlyClip, 'aria-label', '启用镜头 相机 2').props.disabled, true);
assert.equal(find(readonly.footer(), 'data-testid', 'director-stage-storyboard-add').props.disabled, true);
readonlyClip.props.onKeyDown(event({key: 'Enter', target: keyboardTarget()})); readonly.render();
assert.deepEqual(readonly.selections, ['camera-b']);
assert.equal(footerEditor(readonly).props.editable, false);
readonly.unmount();

// Delete/Backspace are owned by the focused camera clip, with native-input, lock, modal and modifier guards.
for (const key of ['Delete', 'Backspace']) {
  let focus = 'clip';
  const owner = {focus: () => {focus = 'lane';}};
  const normal = fixture();
  focusClip(normal, 'b', 'camera-b');
  const node = keyboardTarget('clip', owner);
  clipElement(normal, 'b', 'camera-b').props.onKeyDown(event({key, target: node, currentTarget: node})); normal.render();
  assert.deepEqual(normal.deleted, ['camera-b']); assert.equal(normal.model.selected, null);
  assert.equal(focus, 'lane'); assert.equal(normal.changes.length, 0, 'The documented shortcut deletes the camera through its canonical callback');
  normal.unmount();
  for (const [name, options, keyOptions, menu] of [
    ['read-only', {editable: false}, {}, false],
    ['locked', {cameras: cameras.map(camera => camera.id === 'camera-b' ? {...camera, authoring: {cameraLocked: true}} : camera)}, {}, false],
    ['repeat', {}, {repeat: true}, false], ['control', {}, {ctrlKey: true}, false],
    ['meta', {}, {metaKey: true}, false], ['shift', {}, {shiftKey: true}, false],
    ['alt', {}, {altKey: true}, false], ['composition', {}, {isComposing: true}, false],
    ['prevented', {}, {defaultPrevented: true}, false], ['open menu', {}, {}, true],
  ]) {
    const guarded = fixture(clips, options);
    if (menu) {guarded.model.addMenu(target(), 'camera-b'); guarded.render();}
    clipElement(guarded, 'b', 'camera-b').props.onKeyDown(event({key, target: keyboardTarget(), currentTarget: keyboardTarget(), ...keyOptions}));
    assert.deepEqual(guarded.deleted, [], name + ' prevents destructive keyboard handling');
    assert.equal(guarded.changes.length, 0); guarded.unmount();
  }
  for (const native of ['input', 'textarea', 'select', 'editable']) {
    const control = fixture();
    let prevented = false;
    clipElement(control, 'b', 'camera-b').props.onKeyDown(event({key, target: keyboardTarget(native),
      preventDefault() {prevented = true;}}));
    assert.deepEqual(control.deleted, []); assert.equal(prevented, false, native + ' keeps native text editing');
    control.unmount();
  }
  activeDialog = {};
  const modal = fixture();
  clipElement(modal, 'b', 'camera-b').props.onKeyDown(event({key, target: keyboardTarget()}));
  assert.deepEqual(modal.deleted, []); modal.unmount(); activeDialog = null;
}

// Run the production window capture before the row handler. Direct handler tests alone miss capture-phase ownership.
const captureFactory = vm.runInContext('(function(config){const {document,f,t,r,a,i,o,s,l,u,c,p,d,m,g}=config;return ' + keyboardCaptureSource + '})', context);
function keyboardChain({editable = true, kind = 'clip', menu = false, pose = false} = {}) {
  const test = fixture(gapped, {editable});
  if (menu) {test.model.addMenu(target(), 'camera-b'); test.render();}
  const clip = clipElement(test, 'b', 'camera-b');
  assert.equal(clip.props['data-shot-editable'], editable, 'Capture can identify editable shot bodies without matching child controls');
  const commands = [], otherActions = [];
  const owner = {focus() {}};
  const clipNode = keyboardTarget('clip', owner);
  const baseClipClosest = clipNode.closest;
  clipNode.matches = selector => selector === '[data-camera-shot][data-shot-editable="true"]' ? editable : false;
  clipNode.closest = selector => selector === '[data-camera-shot]' ? clipNode : baseClipClosest(selector);
  const native = ['input', 'textarea', 'select', 'editable'].includes(kind);
  const targetNode = kind === 'clip' ? clipNode : keyboardTarget(native ? kind : 'clip', owner);
  if (kind !== 'clip') {
    targetNode.tagName = kind === 'button' ? 'BUTTON' : kind === 'span' ? 'SPAN' : targetNode.tagName;
    const baseMatches = targetNode.matches, baseClosest = targetNode.closest;
    targetNode.matches = selector => selector === '[data-camera-shot][data-shot-editable="true"]' ? false : baseMatches(selector);
    targetNode.closest = selector => {
      if (selector === '[data-camera-shot]') return clipNode;
      if (selector === 'button' || selector === 'button, summary') return kind === 'button' ? targetNode : null;
      return baseClosest(selector);
    };
  }
  const capture = captureFactory({document: context.document,
    f: {cancelCameraGesture: () => otherActions.push('camera.cancel'), cancelTimelineTransient: () => false,
      dispatchTimelineCommand: command => commands.push(plain(command)),
      dispatchHistoryNavigation: command => otherActions.push(command), closeTransientUi: () => false, hasEditTarget: () => false},
    t: {current: {cameraGestureKeyDown: () => false, cancelCameraGesture: () => false}},
    r: 'timeline', a: {kind: 'none'}, i: false, o: 30, s: true, l: false,
    u: 'performance', c: false, p: false, d: false,
    m: pose ? [{active: true, cancel() {}}] : [], g: () => otherActions.push('save')});
  const send = (key, options = {}) => {
    const value = {key, code: key, ctrlKey: false, metaKey: false, altKey: false, shiftKey: false,
      isComposing: false, defaultPrevented: false, repeat: false, stopped: false,
      target: targetNode, currentTarget: null,
      preventDefault() {this.defaultPrevented = true;}, stopPropagation() {this.stopped = true;}, ...options};
    capture(value);
    const captureResult = {prevented: value.defaultPrevented, stopped: value.stopped, commands: commands.slice()};
    if (!value.stopped) {
      if (kind === 'button') {
        const trash = find(clip, 'data-testid', 'director-stage-shot-delete-camera-b');
        assert.ok(trash);
        value.currentTarget = targetNode; trash.props.onKeyDown(value);
      }
      if (!value.stopped) {value.currentTarget = clipNode; clip.props.onKeyDown(value);}
      if (!value.stopped) {value.currentTarget = owner; test.lane('camera-b').props.onKeyDown(value);}
    }
    return {event: value, capture: captureResult};
  };
  return {...test, commands, otherActions, send};
}
for (const [key, sign] of [['ArrowLeft', -1], ['ArrowRight', 1]]) {
  for (const [options, frames] of [[{}, 1], [{shiftKey: true}, 10], [{repeat: true}, 1]]) {
    const chain = keyboardChain();
    const result = chain.send(key, options);
    assert.deepEqual(result.capture, {prevented: false, stopped: false, commands: []}, 'Window capture releases only an editable shot body for per-clip nudging');
    assert.equal(chain.changes.length, 1);
    assert.deepEqual(chain.changes[0].clips.map(clip => [clip.startFrame, clip.endFrame]), [[0, 30], [60 + sign * frames, 90 + sign * frames], [120, 150]]);
    assert.deepEqual(chain.commands, [], 'Moving a camera cut never also steps the global playhead');
    assert.ok(result.event.defaultPrevented && result.event.stopped);
    chain.unmount();
  }
  for (const kind of ['input', 'textarea', 'select', 'editable']) {
    const chain = keyboardChain({kind});
    const result = chain.send(key);
    assert.deepEqual(result.capture, {prevented: false, stopped: false, commands: []});
    assert.equal(chain.changes.length, 0, kind + ' never moves the containing cut');
    assert.equal(result.event.defaultPrevented, false, 'Native caret/control navigation is retained');
    chain.unmount();
  }
  for (const kind of ['button', 'span']) {
    const chain = keyboardChain({kind});
    const result = chain.send(key);
    assert.deepEqual(chain.commands, [{type: 'playhead.step', deltaFrames: sign}], 'A nonbody child retains the original timeline shortcut owner');
    assert.equal(chain.changes.length, 0);
    assert.ok(result.capture.prevented && result.capture.stopped);
    chain.unmount();
  }
  for (const [options, command] of [[{ctrlKey: true}, {type: sign < 0 ? 'playhead.previous-edit' : 'playhead.next-edit'}],
    [{metaKey: true}, {type: sign < 0 ? 'playhead.previous-edit' : 'playhead.next-edit'}],
    [{altKey: true}, {type: 'playhead.step', deltaFrames: sign * 30}]]) {
    const chain = keyboardChain();
    const result = chain.send(key, options);
    assert.deepEqual(chain.commands, [command], 'Modified arrow keys preserve the preexisting timeline command');
    assert.deepEqual(chain.otherActions, ['camera.cancel']);
    assert.equal(chain.changes.length, 0);
    assert.ok(result.capture.prevented && result.capture.stopped);
    chain.unmount();
  }
  for (const options of [{isComposing: true}, {defaultPrevented: true}]) {
    const chain = keyboardChain(); chain.send(key, options);
    assert.equal(chain.changes.length, 0, 'Consumed or IME keyboard events cannot edit a cut');
    assert.deepEqual(chain.commands, []); chain.unmount();
  }
  const readonlyChain = keyboardChain({editable: false});
  readonlyChain.send(key);
  assert.deepEqual(readonlyChain.commands, [{type: 'playhead.step', deltaFrames: sign}], 'Read-only camera rows preserve playhead navigation');
  assert.equal(readonlyChain.changes.length, 0); readonlyChain.unmount();
  const menuChain = keyboardChain({menu: true}); menuChain.send(key);
  assert.equal(menuChain.changes.length, 0); assert.deepEqual(menuChain.commands, []); menuChain.unmount();
  activeDialog = {};
  const dialogChain = keyboardChain(); dialogChain.send(key);
  assert.equal(dialogChain.changes.length, 0); assert.deepEqual(dialogChain.commands, []); dialogChain.unmount();
  activeDialog = null;
  const poseChain = keyboardChain({pose: true});
  const poseResult = poseChain.send(key);
  assert.equal(poseChain.changes.length, 0); assert.deepEqual(poseChain.commands, []);
  assert.ok(poseResult.capture.prevented && poseResult.capture.stopped, 'Pose editing keeps its existing keyboard trap');
  poseChain.unmount();
}
assert.equal(listeners.size, 0);
console.log('Camera-row sequencer passed: existing-row integration, camera filtering, shared controller/selection/drafts, native scroll coordinates, fixed-camera insertion, one footer, timing edits, pointer cancellation, readonly/deletion guards and production capture-to-bubble arrow key ownership.');
