import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import {createRequire} from 'node:module';

const require = createRequire(import.meta.url);
const bundle = {window: {}};
vm.runInNewContext(await fs.readFile(new URL('../web/vendor/modules.js', import.meta.url), 'utf8'), bundle);
const source = bundle.window.directorFactories['53401'].toString();
const ast = require('@babel/parser').parse('(' + source + ')');
const jsx = (type, props, key) => ({type, props: props || {}, key});
const context = vm.createContext({i: {jsx, jsxs: jsx, Fragment: 'fragment'},
  mI: {A: 'delete-icon'}, mS: {A: 'add-icon'}, pR: {A: 'preview-icon'}, tC: 'scene-camera'});
const extract = node => source.slice(node.start - 1, node.end - 1);
let captureSource;
require('@babel/traverse').default(ast, {
  FunctionDeclaration(path) {vm.runInContext(extract(path.node), context);},
  VariableDeclarator(path) {
    if (['gq', 'gQ', 'gJ'].includes(path.node.id.name) && path.node.init?.type === 'StringLiteral') {
      context[path.node.id.name] = path.node.init.value;
    }
  },
  ArrowFunctionExpression(path) {
    const callback = extract(path.node);
    if (callback.includes('if(!P&&g_(e)&&!gZ(e.target)&&e.target?.closest?.("[data-director-shot-keyboard]"))return;') &&
        (!captureSource || callback.length < captureSource.length)) captureSource = callback;
  },
});
assert.ok(captureSource, 'Build the camera deletion shortcut patch before testing');
const captureFactory = vm.runInContext('(function(config){const {document,f,t,r,a,i,o,s,l,u,c,p,d,m,g}=config;return ' + captureSource + '})', context);
const elements = value => Array.isArray(value) ? value.flatMap(elements) :
  value && typeof value === 'object' ? [value, ...elements(value.props?.children)] : [];

function fixture(options = {}) {
  const calls = [], selections = [], changes = [], deleted = [];
  const camera = {id: 'camera-a', name: 'Camera A', authoring: {cameraLocked: !!options.locked}};
  const cameras = [camera, {id: 'camera-b', name: 'Camera B', authoring: {cameraLocked: false}}];
  const clips = [
    {id: 'first', cameraId: camera.id, startFrame: 0, endFrame: 60, createdAt: '2026-09-24'},
    {id: 'other', cameraId: 'camera-b', startFrame: 90, endFrame: 150, createdAt: '2026-09-24'},
    {id: 'same-camera', cameraId: camera.id, startFrame: 180, endFrame: 240, createdAt: '2026-09-24'},
  ];
  let focus = options.target ?? 'shot';
  const document = {querySelector: () => options.modal ? {} : null};
  context.document = document;
  let stateIndex = 0;
  context.n = {
    useMemo: callback => callback(),
    useState: initial => {
      const index = stateIndex++;
      return [index === 1 && options.menu ? {clipId: 'first', x: 10, y: 10, frame: 0} : initial,
        value => {if (index === 2) selections.push(value);}];
    },
    useRef: initial => ({current: initial}), useCallback: callback => callback,
    useEffect: () => {}, useLayoutEffect: () => {}, useSyncExternalStore: (_subscribe, snapshot) => snapshot(),
  };
  const tree = context.__LocalShotTrack({track: {version: 1, clips}, cameras, boundaryKey: 'fixture',
    editable: options.editable !== false, scale: {displayFps: 30, pixelsPerFrame: 5, edgeGutterPx: 0,
      durationFrames: 900, contentWidthPx: 4500}, scrollLeftPx: 0,
    clock: {subscribe: () => () => {}, getSnapshot: () => 0},
    onChange: value => changes.push(value), onSelectCamera: () => {}, onSeek: () => {},
    onDeleteCamera: id => {deleted.push(id); return options.reject ? false : true;},
  });
  const nodes = elements(tree);
  const shot = nodes.find(node => node.props['data-testid'] === 'director-stage-storyboard-clip-first');
  const trash = nodes.find(node => node.props['data-testid'] === 'director-stage-shot-delete-camera-first');
  assert.ok(shot && trash, 'Exercise the production shot and trash handlers');
  const trackNode = {focus: () => {focus = 'track';}};
  const targetNode = kind => {
    const tagName = ['input', 'checkbox'].includes(kind) ? 'INPUT' : kind === 'textarea' ? 'TEXTAREA' :
      kind === 'select' ? 'SELECT' : kind === 'trash' ? 'BUTTON' : 'DIV';
    const native = ['input', 'checkbox', 'textarea', 'select', 'editable', 'spinbutton'].includes(kind);
    const node = {kind, tagName, isContentEditable: kind === 'editable',
      matches: selector => selector === context.gq && native,
      closest(selector) {
        if (selector === context.gq) return native ? node : null;
        if (selector === '[data-director-shot-keyboard]' || selector === '[data-testid="director-stage-storyboard-track"]') {
          return kind === 'outside' ? null : trackNode;
        }
        if (selector === context.gQ) return node;
        if (selector === 'button' || selector === 'button, summary') return tagName === 'BUTTON' ? node : null;
        return null;
      }};
    return node;
  };
  const capture = captureFactory({document,
    f: {cancelCameraGesture: () => calls.push('camera.cancel'), cancelTimelineTransient: () => false,
      dispatchTimelineCommand: command => calls.push(command.type), dispatchHistoryNavigation: command => calls.push(command),
      closeTransientUi: () => false, hasEditTarget: () => false},
    t: {current: {cameraGestureKeyDown: () => false, cancelCameraGesture: () => false}},
    r: 'timeline', a: {kind: 'motion-clips', clipIds: ['unrelated-motion']}, i: false, o: 30, s: true,
    l: false, u: 'performance', c: false, p: false, d: false,
    m: options.pose ? [{active: true, cancel: () => calls.push('pose.cancel')}] : [],
    g: () => calls.push('save'),
  });
  const event = (key, config = {}) => ({key, code: key, ctrlKey: false, metaKey: false, altKey: false,
    shiftKey: false, repeat: false, isComposing: false, defaultPrevented: false, stopped: false,
    target: targetNode(config.target ?? focus), currentTarget: null,
    preventDefault() {this.defaultPrevented = true;}, stopPropagation() {this.stopped = true;}, ...config});
  const dispatch = value => {
    capture(value);
    const kind = value.target.kind;
    if (!value.stopped && kind === 'trash') {value.currentTarget = value.target; trash.props.onKeyDown(value);}
    if (!value.stopped && kind !== 'track' && kind !== 'outside') {
      value.currentTarget = targetNode('shot'); shot.props.onKeyDown(value);
    }
    if (!value.stopped && kind !== 'outside') {value.currentTarget = trackNode; tree.props.onKeyDown(value);}
    return value;
  };
  return {capture, event, dispatch, calls, deleted, changes, selections, shot, trash, tree,
    get focus() {return focus;}};
}

for (const key of ['Delete', 'Backspace']) for (const target of ['shot', 'trash']) {
  const item = fixture({target});
  const captured = item.event(key);
  item.capture(captured);
  assert.equal(captured.defaultPrevented, false, 'Capture releases ' + key + ' to ' + target);
  assert.equal(captured.stopped, false);
  assert.deepEqual(item.calls, [], 'Shot focus cannot delete an unrelated timeline selection');
  const event = item.dispatch(item.event(key));
  assert.deepEqual(item.deleted, ['camera-a'], 'The shortcut uses the same camera deletion callback as the trash button');
  assert.deepEqual(item.changes, [], 'Keyboard deletion cannot silently remove only the shot interval');
  assert.equal(item.focus, 'track', 'Successful deletion transfers focus to the non-destructive track container');
  assert.deepEqual(item.selections, [null]);
  assert.ok(event.defaultPrevented && event.stopped);
  item.dispatch(item.event(key, {repeat: true}));
  item.dispatch(item.event(key));
  assert.deepEqual(item.deleted, ['camera-a'], 'Repeated deletion on the track cannot delete another camera');
  assert.deepEqual(item.calls, [], 'Track focus never falls back to deleting the scene or timeline selection');
  assert.equal(item.shot.props['aria-keyshortcuts'], 'Backspace Delete');
}

for (const key of ['Delete', 'Backspace']) {
  for (const target of ['input', 'checkbox', 'textarea', 'select', 'editable', 'spinbutton']) {
    const item = fixture({target});
    const event = item.dispatch(item.event(key));
    assert.deepEqual(item.deleted, [], target + ' retains native text/control editing');
    assert.deepEqual(item.calls, []);
    assert.equal(event.defaultPrevented, false);
    assert.equal(event.stopped, false);
  }
  for (const options of [{locked: true}, {editable: false}, {menu: true}, {modal: true}, {pose: true}]) {
    const item = fixture(options);
    const event = item.dispatch(item.event(key));
    assert.deepEqual(item.deleted, [], JSON.stringify(options) + ' prevents camera deletion');
    assert.deepEqual(item.changes, []);
    assert.deepEqual(item.calls, [], 'Protected camera focus cannot delete an unrelated timeline selection');
    assert.equal(item.focus, 'shot');
    assert.ok(event.defaultPrevented && event.stopped);
  }
  for (const config of [{repeat: true}, {ctrlKey: true}, {metaKey: true}, {altKey: true}, {shiftKey: true},
    {isComposing: true}, {defaultPrevented: true}]) {
    const item = fixture();
    item.dispatch(item.event(key, config));
    assert.deepEqual(item.deleted, [], JSON.stringify(config) + ' cannot delete a camera');
    assert.equal(item.focus, 'shot');
    assert.ok(!item.calls.includes('selection.delete'));
  }
  const rejected = fixture({reject: true});
  rejected.dispatch(rejected.event(key));
  assert.deepEqual(rejected.deleted, ['camera-a']);
  assert.equal(rejected.focus, 'shot', 'A rejected workspace deletion keeps the focused shot available');
  assert.deepEqual(rejected.selections, [], 'Rejected deletion preserves the selected shot');
  const ordinary = fixture({target: 'outside'});
  const ordinaryEvent = ordinary.dispatch(ordinary.event(key));
  assert.deepEqual(ordinary.calls, ['selection.delete'], 'Ordinary timeline deletion still uses its existing command');
  assert.ok(ordinaryEvent.defaultPrevented && ordinaryEvent.stopped);
}

for (const key of ['Enter', ' ', 'ArrowLeft', 'ArrowRight']) {
  const item = fixture({target: 'trash'});
  const event = item.event(key);
  item.trash.props.onKeyDown(event);
  assert.equal(event.stopped, true, 'Other trash-button keys cannot open or move the parent shot');
  assert.equal(event.defaultPrevented, false, 'Native button activation remains available');
}
const save = fixture();
save.dispatch(save.event('s', {ctrlKey: true}));
assert.deepEqual(save.calls, ['camera.cancel', 'save'], 'Global save shortcuts keep their precedence');
const escape = fixture({pose: true});
escape.dispatch(escape.event('Escape'));
assert.deepEqual(escape.calls, ['pose.cancel'], 'Pose cancellation is unchanged');

console.log('Shot deletion shortcuts passed: production capture and bubbling, Backspace/Delete, camera callback routing, focus retention, native controls, locked/read-only cameras, menus/dialogs, pose traps, repeat and ordinary timeline shortcuts.');
