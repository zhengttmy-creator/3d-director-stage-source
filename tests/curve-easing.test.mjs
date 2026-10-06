import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {createRequire} from 'node:module';
import vm from 'node:vm';

const require = createRequire(import.meta.url);
const factories = JSON.parse(await fs.readFile(new URL('../src/vendor/module-factories.json', import.meta.url), 'utf8'));
const original = factories['53401'];
require('../src/patches/curve-easing.cjs')(factories);
const source = factories['53401'];
const parser = require('@babel/parser');
const ast = parser.parse('(' + source + ')');
const extract = node => source.slice(node.start - 1, node.end - 1);

class TestNode {
  constructor(parent) { this.parent = parent; }
  contains(target) {
    for (let node = target; node; node = node.parent) if (node === this) return true;
    return false;
  }
}
class TestElement extends TestNode {
  constructor(parent, attrs = {}) { super(parent); this.attrs = attrs; this.isConnected = true; }
  closest(selector) {
    for (let node = this; node; node = node.parent) {
      if (selector === '[data-director-stage-curve-preset-menu="true"]' && node.attrs?.preset) return node;
    }
    return null;
  }
  focus() { this.focused = true; }
}
const effects = [];
const refs = [];
const listeners = new Map();
const jsx = (type, props) => ({type, props});
const context = vm.createContext({
  Node: TestNode, Element: TestElement,
  document: {body: new TestElement()},
  window: {addEventListener: (name, fn) => listeners.set(name, fn), removeEventListener: name => listeners.delete(name)},
  n: {memo: fn => fn, useRef: value => {const ref = {current: value}; refs.push(ref); return ref;},
    useState: value => [value, () => {}], useMemo: fn => fn(), useEffect: fn => effects.push(fn),
    useLayoutEffect: () => {}, useSyncExternalStore: (_subscribe, read) => read()},
  i: {jsx, jsxs: jsx}, o: {createPortal: content => content},
  cf: {wF: 'select'}, oy: {A: 'close-icon'}, fE: {A: 'curve-icon'}, fX: 'curve-graph', ok: (...args) => args.filter(Boolean).join(' '),
});
for (const node of ast.program.body[0].expression.body.body) {
  if (node.type === 'FunctionDeclaration') vm.runInContext(extract(node), context);
  if (node.type === 'VariableDeclaration') {
    for (const entry of node.declarations) {
      if (['md', 'gN', 'gD', 'gL'].includes(entry.id.name)) vm.runInContext('var ' + extract(entry), context);
    }
  }
}
context.ok = (...args) => args.filter(Boolean).join(' ');
const segment = {startFrame: 9, endFrame: 47, frameSpan: 38, startIndex: 0,
  keyframes: [{id: 'start', frame: 0, value: 0, interpolation: 'linear'}, {id: 'end', frame: 1, value: 1, interpolation: 'linear'}], samples: []};
const anchor = new TestElement();
const panel = new TestElement();
let closeCount = 0;
const tree = context.he({anchor, clock: {subscribe() {}, getSnapshot: () => 25 / 30}, displayFps: 30,
  segment, keyframes: segment.keyframes, label: 'Position', copy: {title: () => 'Curve', presetLabels: {}},
  onClose() { closeCount++; }});
refs[0].current = panel;
const cleanups = effects.map(fn => fn());
assert.equal(typeof listeners.get('pointerdown'), 'function');
function find(node, predicate) {
  if (!node || typeof node !== 'object') return;
  if (predicate(node)) return node;
  for (const child of [node.props?.children].flat()) { const found = find(child, predicate); if (found) return found; }
}
const menuComponent = find(tree, node => node.type === context.md);
assert.ok(menuComponent, 'The actual curve popover renders the preset select');
const select = context.md(menuComponent.props);
assert.equal(select.props.contentProps['data-director-stage-curve-preset-menu'], 'true');
assert.equal(select.props.contentProps['data-director-stage-portal-layer'], true);
const menu = new TestElement(null, {preset: true});
const optionLabel = new TestElement(new TestElement(menu));
for (const target of [panel, new TestElement(panel), anchor, new TestElement(anchor), optionLabel]) {
  listeners.get('pointerdown')({target});
  assert.equal(closeCount, 0, 'Panel, anchor, and portaled preset items stay inside the curve editor');
}
listeners.get('pointerdown')({target: new TestElement(null, {unrelatedPortal: true})});
assert.equal(closeCount, 1, 'Unrelated portals still dismiss the curve editor');
listeners.get('keydown')({defaultPrevented: true, key: 'Escape'});
assert.equal(closeCount, 1, 'A menu-handled Escape does not close its parent');
listeners.get('keydown')({defaultPrevented: false, key: 'Escape', preventDefault() {}, stopPropagation() {}});
assert.equal(closeCount, 2);
assert.equal(anchor.focused, true);
for (const cleanup of cleanups) cleanup?.();
assert.equal(listeners.size, 0);

// Preserve the existing normalized timing representation throughout authoring and sampling.
const scalarKeys = [{...segment.keyframes[0], frame: 9, value: 2}, {...segment.keyframes[1], frame: 47, value: 12}];
const expected = {linear: [0.25, 0.5, 0.75], 'ease-in': [0.015625, 0.125, 0.421875],
  'ease-out': [0.578125, 0.875, 0.984375], 'ease-in-out': [0.0707966, 0.5, 0.9292034]};
for (const [preset, values] of Object.entries(expected)) {
  const edited = context.gO(segment, context.gD[preset]);
  const actual = context.gE(scalarKeys, segment, edited);
  for (const [index, frame] of [18.5, 28, 37.5].entries()) {
    assert.ok(Math.abs(context.J(actual, 0, frame) - values[index]) < 0.0001, preset + ' changes actual playback progress');
  }
  assert.equal(actual[0].frame, 9);
  assert.equal(actual[1].frame, 47);
  assert.equal(actual[0].value, 2);
  assert.equal(actual[1].value, 12);
}
const held = context.gE(scalarKeys, segment, [{...segment.keyframes[0], interpolation: 'hold'}, segment.keyframes[1]]);
assert.equal(context.J(held, 0, 46), 0);
assert.equal(context.J(held, 0, 47), 1);
for (const name of ['gO', 'gH', 'gE', 'J']) {
  const node = ast.program.body[0].expression.body.body.find(node => node.type === 'FunctionDeclaration' && node.id.name === name);
  assert.ok(original.includes(extract(node)), 'Timing algorithm ' + name + ' remains unchanged');
}
console.log('Curve easing tests passed: owned dropdown portals, nested clicks, outside dismissal, Escape, prop forwarding, and real easing/hold sampling for frames 9-47.');
