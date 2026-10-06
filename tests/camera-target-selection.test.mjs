import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import {randomUUID} from 'node:crypto';
import {createRequire} from 'node:module';

const require = createRequire(import.meta.url);
const parser = require('@babel/parser');
const traverse = require('@babel/traverse').default;
const factories = JSON.parse(await fs.readFile(new URL('../src/vendor/module-factories.json', import.meta.url), 'utf8'));
require('../src/patches/patch-camera-target-selection.cjs')(factories);
const source = factories['53401'];
new vm.Script('(' + source + ')');
const ast = parser.parse('(' + source + ')');
const extract = node => source.slice(node.start - 1, node.end - 1);
const callbacks = new Map();
const candidates = [];
let targetPresets;
let selectedIds;
let displaySelection;
traverse(ast, {
  VariableDeclarator(path) {
    const {id, init} = path.node;
    if (id.name === 'tJ' && init?.type === 'ArrayExpression') targetPresets = extract(init);
    if (init?.type !== 'CallExpression') return;
    const code = extract(init);
    if ((id.name === 'dc' && code.includes('rC&&e.some')) ||
        (id.name === 'dd' && code.includes('rC.objectId!==e')) ||
        (id.name === 'du' && code.includes('dd(e,t),rx'))) {
      callbacks.set(id.name, {fn: extract(init.arguments[0]), deps: extract(init.arguments[1])});
    }
    if (id.name === 'c2' && code.includes('selectedObjectIds:cG?')) displaySelection = extract(init.arguments[0]);
  },
  FunctionExpression(path) {
    const code = extract(path.node);
    if (code.includes('objectPickActive:A,role:f,target:h')) candidates.push(code);
  },
  ObjectExpression(path) {
    const props = path.node.properties.filter(prop => prop.type === 'ObjectProperty');
    if (!props.some(prop => prop.key.name === 'onSelect' && prop.value.name === 'dd')) return;
    const prop = props.find(prop => prop.key.name === 'selectedIds');
    if (prop) selectedIds = extract(prop.value);
  },
});
assert.equal(callbacks.size, 3, 'The actual viewport, list, and timeline selection handlers must be extracted');
assert.ok(displaySelection && selectedIds && targetPresets);
for (const dependency of ['cO', 'cH', 'cq', 'cU']) {
  assert.match(callbacks.get('dc').deps, new RegExp('\\b' + dependency + '\\b'), 'Selection handler must see the latest picker state');
}
assert.match(callbacks.get('dd').deps, /\bcO\b/);
const hookSource = candidates.sort((a, b) => a.length - b.length)[0];
assert.ok(hookSource, 'Use the production camera subject picker');
const plain = value => JSON.parse(JSON.stringify(value));
const transform = {position: {x: 0, y: 0, z: 0}, rotation: {x: 0, y: 25, z: 0}, scale: {x: 1, y: 1, z: 1}};
const object = (id, extra = {}) => ({id, name: id, kind: 'model', visible: true, rigged: false, locked: false, transform, ...extra});
const objects = [
  object('child', {rigged: true, asset: {assetId: 'local-body-male-child', extension: '.glb'}}),
  object('locked-person', {rigged: true, locked: true}),
  object('prop'), object('hidden', {visible: false}),
  object('environment', {kind: 'environment'}), object('background', {kind: 'background'}),
];
const measuredTarget = {objectId: 'child', center: {x: 2, y: 0.56, z: 3}, height: 1.12, width: 0.42, yawDegrees: 25};

function makeHarness() {
  const slots = [];
  const effects = [];
  const events = {normalSelection: 0, environmentSelection: 0, writes: [], prepare: 0, focus: []};
  let cursor = 0;
  let dirty = true;
  let picker;
  let selection = {selectedObjectIds: ['prop'], mode: 'object', selectedJointId: undefined};
  const context = vm.createContext({
    crypto: {randomUUID}, cz: 'account-project-window-session-transient',
    n: {
      useState(initial) {
        const index = cursor++;
        if (!(index in slots)) slots[index] = {value: typeof initial === 'function' ? initial() : initial};
        return [slots[index].value, value => {
          const next = typeof value === 'function' ? value(slots[index].value) : value;
          if (!Object.is(next, slots[index].value)) {slots[index].value = next;dirty = true;}
        }];
      },
      useRef(initial) {const index = cursor++;return slots[index] ??= {current: initial};},
      useMemo: fn => fn(), useCallback: fn => fn,
      useEffect(fn, deps) {
        const index = cursor++;
        const previous = slots[index];
        if (!previous || deps.some((value, i) => !Object.is(value, previous.deps[i]))) {
          slots[index] = {deps};effects.push(fn);
        }
      },
    },
    A: {objects}, rC: null,
    eW() {}, al() {}, a6() {}, nB() {}, rk() {},
    rx: scope => events.focus.push(scope),
    iE(update) {selection = {...selection, ...(typeof update === 'function' ? update(selection) : update)};events.normalSelection++;},
    dl() {events.environmentSelection++;},
  });
  const helpers = new Set(['cF', 'cT', 'cN', 'cD', 'cL', 't5', 't3', 'rt', 'rs', 'ra', 'rl', 'rn', 'rc', 'w8', 'w9']);
  for (const node of ast.program.body[0].expression.body.body) {
    if (node.type === 'FunctionDeclaration' && helpers.has(node.id.name)) vm.runInContext(extract(node), context);
  }
  context.tJ = vm.runInContext(targetPresets, context);
  const createPicker = vm.runInContext('(' + hookSource + ')', context);
  const props = {scopeKey: 'project:node', workspace: 'performance', objects,
    getShotTarget: id => id === 'child' ? measuredTarget : undefined,
    preparePickerUi: () => events.prepare++,
    addShotCamera: intent => {events.writes.push(plain(intent));return true;},
  };
  function current() {
    let attempts = 0;
    while (dirty) {
      assert.ok(attempts++ < 10, 'Picker effects must settle');
      cursor = 0;dirty = false;picker = createPicker(props);
      while (effects.length) effects.shift()();
    }
    context.cO = picker.active;
    context.cH = picker.objectPickActive;
    context.cq = picker.selectObject;
    context.cU = picker.targets;
    context.cG = picker.target;
    context.iK = {...selection, objects};
    context.sp = context.iK;
    context.c2 = vm.runInContext('(' + displaySelection + ')()', context);
    for (const [name, callback] of callbacks) context[name] = vm.runInContext('(' + callback.fn + ')', context);
    return picker;
  }
  return {current, events,
    list(id, additive = false) {current();context.dd(id, additive);return current();},
    timeline(id, additive = false) {current();context.du(id, additive);return current();},
    select(ids, mode) {current();context.dc(ids, mode);return current();},
    normalIds() {return plain(selection.selectedObjectIds);},
    highlightedIds() {current();return plain(vm.runInContext(selectedIds, context));},
  };
}

const list = makeHarness();
list.current().begin({presetId: 'front-medium'});
assert.equal(list.current().confirm(), false, 'A preset alone never creates a camera');
assert.equal(list.events.writes.length, 0);
assert.deepEqual(list.highlightedIds(), [], 'The old ordinary selection is not presented as a chosen subject');
list.list('child');
assert.equal(list.current().target.objectId, 'child', 'Clicking the object list chooses the camera subject');
assert.deepEqual(list.highlightedIds(), ['child']);
assert.equal(list.events.normalSelection, 0, 'Choosing a subject must not mutate the editing selection');
assert.deepEqual(list.normalIds(), ['prop']);
assert.equal(list.current().confirm(), true);
assert.equal(list.events.writes.length, 1);
assert.deepEqual(list.events.writes[0], {kind: 'target-relative', presetId: 'front-medium', target: {
  objectId: 'child', center: measuredTarget.center, height: 1.12, yawDegrees: 25,
}}, 'Framing uses the measured height and center of the body preset');
assert.equal(list.current().active, false);
list.list('child');
assert.deepEqual(list.normalIds(), ['child'], 'Normal list selection resumes after confirming');
list.list('prop', true);
assert.deepEqual(list.normalIds(), ['child', 'prop'], 'Normal additive selection is preserved');
list.list('child', true);
assert.deepEqual(list.normalIds(), ['prop'], 'Normal toggle deselection is preserved');

const timeline = makeHarness();
timeline.current().begin({presetId: 'front-wide'});
timeline.timeline('locked-person', true);
assert.equal(timeline.current().target.objectId, 'locked-person', 'Locked characters remain valid subjects');
assert.deepEqual(timeline.highlightedIds(), ['locked-person']);
assert.equal(timeline.events.normalSelection, 0);
assert.equal(timeline.current().confirm(), true);
assert.equal(timeline.events.writes[0].target.objectId, 'locked-person');
timeline.current().begin({presetId: 'front-close-up'});
timeline.list('prop');
assert.equal(timeline.current().target.objectId, 'prop', 'Props remain valid camera subjects');
timeline.current().cancel();
timeline.timeline('child');
assert.deepEqual(timeline.normalIds(), ['child'], 'Timeline selection resumes after cancelling');
assert.equal(timeline.events.writes.length, 1, 'Cancellation writes no camera');

const invalid = makeHarness();
invalid.current().begin({presetId: 'front-medium'});
for (const id of ['missing', 'hidden', 'environment', 'background']) {
  invalid.list(id);
  assert.equal(invalid.current().target, undefined);
  assert.equal(invalid.current().confirm(), false);
}
assert.equal(invalid.events.normalSelection, 0);
assert.equal(invalid.events.environmentSelection, 0, 'An environment click cannot leave the subject picker');
assert.equal(invalid.events.writes.length, 0, 'Unsupported or absent subjects cannot write camera data');
invalid.select(['hidden', 'child', 'prop'], 'add');
assert.equal(invalid.current().target.objectId, 'child', 'A mixed selection chooses its first valid subject');
invalid.select([], 'replace');
assert.equal(invalid.current().target, undefined, 'Clearing a pick disables confirmation');

const shoulder = makeHarness();
shoulder.current().begin({presetId: 'over-shoulder'});
shoulder.timeline('locked-person');
assert.equal(shoulder.current().activeSession.phase, 'foreground-object');
assert.equal(shoulder.current().activeSession.selection.foregroundObjectId, 'locked-person');
shoulder.current().advance();
assert.equal(shoulder.current().activeSession.phase, 'target-ground');
assert.equal(shoulder.current().objectPickActive, false);
shoulder.list('child');
shoulder.timeline('prop');
shoulder.select(['child'], 'replace');
assert.equal(shoulder.current().activeSession.selection.foregroundObjectId, 'locked-person', 'Aim point placement cannot replace the foreground character');
assert.deepEqual(shoulder.normalIds(), ['prop']);
assert.equal(shoulder.events.normalSelection, 0, 'Aim point placement cannot edit the scene selection');
assert.equal(shoulder.current().confirm(), false);
assert.equal(shoulder.events.writes.length, 0);
shoulder.current().placeTargetPoint({groundHit: {point: {x: 2, y: 0, z: 4}, normal: {x: 0, y: 1, z: 0}}, target: {x: 2, y: 1, z: 4}});
assert.equal(shoulder.current().activeSession.phase, 'target-height');
shoulder.list('child');
assert.equal(shoulder.current().activeSession.selection.foregroundObjectId, 'locked-person');
assert.equal(shoulder.current().confirm(), true);
assert.equal(shoulder.events.writes[0].kind, 'over-shoulder');
assert.equal(shoulder.events.writes[0].foregroundTarget.objectId, 'locked-person');

console.log('Camera subject selection: object list, timeline, framing, cancellation, normal selection, and over-shoulder placement passed.');
