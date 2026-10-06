import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import {createRequire} from 'node:module';

const require = createRequire(import.meta.url);
const parser = require('@babel/parser');
const traverse = require('@babel/traverse').default;
const factories = JSON.parse(await fs.readFile(new URL('../src/vendor/module-factories.json', import.meta.url), 'utf8'));
require('../src/patches/disable-scene-drafts.cjs')(factories);
const source = factories['53401'];
new vm.Script('(' + source + ')');
const ast = parser.parse('(' + source + ')');
const extract = node => source.slice(node.start - 1, node.end - 1);
const declarations = new Map();
const candidates = [];
let closeKeepSource;
traverse(ast, {
  FunctionDeclaration(path) { declarations.set(path.node.id.name, extract(path.node)); },
  FunctionExpression(path) {
    const code = extract(path.node);
    if (code.includes('getCurrentProject:f,hasUnsavedChanges:y') && code.includes('markSaved:E')) candidates.push(code);
  },
  ObjectExpression(path) {
    const fields = path.node.properties;
    const mode = fields.find(field => field.type === 'ObjectProperty' && field.key.name === 'mode');
    if (mode?.value.type !== 'StringLiteral' || mode.value.value !== 'close') return;
    const keep = fields.find(field => field.type === 'ObjectProperty' && field.key.name === 'onKeep');
    if (keep) closeKeepSource = extract(keep.value);
  },
});
const hookSource = candidates.sort((a, b) => a.length - b.length)[0];
assert.ok(hookSource, 'The actual project hook must be found');
assert.ok(closeKeepSource, 'The close dialog action must be found');
const plain = value => JSON.parse(JSON.stringify(value));
const clone = value => structuredClone(plain(value));
const makeWorkspace = (id, kind) => ({id, kind, name: kind, objects: [{id: 'person', transform: {rotation: {x: 0, y: 0, z: 0}}}],
  timeline: {durationSec: 20, displayFps: 30, objectTracks: {}}, poses: [], cameras: [], captures: []});
const makeProject = () => ({version: 3, activeWorkspace: {kind: 'staging', id: 'stage'},
  stagingWorkspaces: [makeWorkspace('stage', 'staging')], performanceWorkspaces: [makeWorkspace('performance', 'performance')],
  sharedLibrary: {poses: [], cameras: [], captures: []}, exports: []});

function makeHarness(canEdit = true) {
  const originalDraft = JSON.stringify({kind: 'director-stage-local-draft', project: makeProject(), baseVersionId: 'older'});
  const draftKey = 'director-stage-shell:project:node';
  const storage = new Map([[draftKey, originalDraft]]);
  const calls = {read: 0, write: 0, timers: 0, notices: [], commits: [], workspaces: []};
  const slots = [];
  const pendingEffects = [];
  let cursor = 0;
  let dirty = true;
  let result;
  const props = {projectId: 'project', nodeId: 'node', canEdit, initialProject: makeProject(), versionId: 'v1',
    onNotify: message => calls.notices.push(message), onCommit: project => calls.commits.push(clone(project))};
  function effect(callback, dependencies) {
    const index = cursor++;
    const previous = slots[index];
    if (!previous || dependencies.some((value, i) => !Object.is(value, previous.dependencies[i]))) {
      previous?.cleanup?.();
      const next = {dependencies};
      slots[index] = next;
      pendingEffects.push(() => {next.cleanup = callback();});
    }
  }
  const context = vm.createContext({
    AbortController, Date,
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
      useCallback: callback => callback,
      useEffect: effect, useLayoutEffect: effect,
    },
    w: () => ({t: key => key}),
    window: {
      localStorage: {
        getItem: key => storage.get(key) ?? null,
        setItem: (key, value) => storage.set(key, value),
        removeItem: key => storage.delete(key),
      },
      setTimeout() {calls.timers++;throw new Error('Scene edits must not schedule a draft timer');},
      clearTimeout() {},
    },
    k4: {
      read() {calls.read++;throw new Error('Existing scene drafts must not be read');},
      write() {calls.write++;throw new Error('Existing scene drafts must not be overwritten or deleted');},
    },
    kZ: (project, node) => 'active-workspace:' + project + ':' + node,
    k$: () => [], k_: value => value === 'staging' || value === 'performance',
    k0: (kind, project, node) => {calls.workspaces.push(kind);storage.set('active-workspace:' + project + ':' + node, kind);},
    kG: project => JSON.stringify(project),
    np: clone, nr: clone, iS: state => state,
    nf: project => clone(project.activeWorkspace.kind === 'staging' ? project.stagingWorkspaces[0] : project.performanceWorkspaces[0]),
    nn: (state, metadata) => ({...state, ...metadata, kind: 'staging'}),
    no: (state, metadata) => ({...state, ...metadata, kind: 'performance'}),
    nt: 'stage', Sa: new Set(['normalization']), Sr: new Set(),
  });
  for (const name of ['nh', 'nv', 'nb', 'nx', 'Se', 'St']) vm.runInContext(declarations.get(name), context);
  const createProject = vm.runInContext('(' + hookSource + ')', context);
  function current() {
    let attempts = 0;
    while (dirty) {
      assert.ok(attempts++ < 10, 'The hook should settle after effects');
      dirty = false;cursor = 0;result = createProject(props);
      while (pendingEffects.length) pendingEffects.shift()();
    }
    return result;
  }
  function assertDraftUntouched() {
    assert.equal(calls.read, 0);
    assert.equal(calls.write, 0);
    assert.equal(calls.timers, 0);
    assert.equal(storage.get(draftKey), originalDraft, 'Pre-existing draft bytes remain untouched');
    assert.deepEqual(calls.notices, [], 'Disabled draft storage cannot produce a recovery error');
  }
  return {current, calls, assertDraftUntouched,
    unmount() {for (const slot of slots) slot?.cleanup?.();},
    canEdit(value) {props.canEdit = value;dirty = true;return current();},
  };
}

const harness = makeHarness();
assert.equal(harness.current().draftLoading, false, 'The saved project opens immediately');
assert.equal(harness.current().recoveryDraft, null, 'Existing scene drafts cannot trigger a restore dialog');
assert.equal(harness.current().getHasUnsavedChanges(), false);
assert.equal(await harness.current().persistDraft(), false, 'The disabled path must not claim a draft was saved');
harness.current().update(state => ({...state, objects: [{...state.objects[0], name: 'Edited character'}]}), 'director.object.rename');
assert.equal(harness.current().hasUnsavedChanges, true);
assert.equal(harness.current().getHasUnsavedChanges(), true);
assert.equal(harness.calls.commits.at(-1).stagingWorkspaces[0].objects[0].name, 'Edited character', 'Project edits still reach normal persistence');
assert.equal(harness.current().undo(), true);
assert.equal(harness.current().getCurrentProject().stagingWorkspaces[0].objects[0].name, undefined);
assert.equal(harness.current().redo(), true);
assert.equal(harness.current().getCurrentProject().stagingWorkspaces[0].objects[0].name, 'Edited character');

const firstSave = clone(harness.current().getCurrentProject());
harness.current().markSaved(firstSave, 'v2');
assert.equal(harness.current().hasUnsavedChanges, false, 'A successful manual save clears the dirty flag');
harness.current().activateWorkspace('performance');
assert.equal(harness.current().getCurrentProject().activeWorkspace.kind, 'performance');
harness.current().update(state => ({...state, objects: [{...state.objects[0], name: 'Performance character'}]}), 'director.object.rename');
assert.equal(harness.current().getCurrentProject().performanceWorkspaces[0].objects[0].name, 'Performance character');
assert.equal(harness.current().getCurrentProject().stagingWorkspaces[0].objects[0].name, 'Edited character', 'Performance edits preserve the staging scene');

const pendingSave = clone(harness.current().getCurrentProject());
harness.current().update(state => ({...state, objects: [{...state.objects[0], name: 'Newer edit'}]}), 'director.object.rename');
harness.current().markSaved(pendingSave, 'v3');
assert.equal(harness.current().hasUnsavedChanges, true, 'An older completed save cannot clear newer pending edits');
harness.current().markSaved(clone(harness.current().getCurrentProject()), 'v4');
assert.equal(harness.current().hasUnsavedChanges, false);
await harness.current().discardDraft();
assert.equal(harness.current().recoveryDraft, null);
harness.canEdit(false);
const beforeReadonly = clone(harness.current().getCurrentProject());
harness.current().update(state => ({...state, objects: []}), 'director.object.delete');
assert.deepEqual(plain(harness.current().getCurrentProject()), beforeReadonly, 'Read-only protection remains effective');
harness.canEdit(true);
harness.unmount();
harness.assertDraftUntouched();

const readonly = makeHarness(false);
assert.equal(readonly.current().draftLoading, false);
assert.equal(readonly.current().recoveryDraft, null);
assert.equal(await readonly.current().persistDraft(), false);
readonly.unmount();
readonly.assertDraftUntouched();

const closeEvents = [];
vm.runInNewContext('(' + closeKeepSource + ')()', {G: event => closeEvents.push(event), U: () => closeEvents.push('closed')});
assert.deepEqual(closeEvents, ['discard_unsaved', 'closed'], 'Discard-and-close does not invoke any draft persistence');
const jsx = (type, props) => ({type, props});
const closeDialog = vm.runInNewContext('(' + declarations.get('w2') + ')', {
  i: {jsx, jsxs: jsx}, n: {useState: initial => [typeof initial === 'function' ? initial() : initial]},
  w: () => ({t: key => key}), w0: {lG: 'dialog', Cf: 'content', L3: 'title', rr: 'description', Es: 'footer'},
  l: {$nd: 'button'}, c: {FR: {fullscreenFloating: 'modal'}}, document: {activeElement: null},
})({mode: 'close', busy: false, failed: false, onCancel() {}, onKeep() {}, onConfirm() {}});
const buttons = [];
function visit(element) {
  if (!element || typeof element !== 'object') return;
  if (element.type === 'button') buttons.push(element.props.children);
  for (const child of [element.props?.children].flat()) visit(child);
}
visit(closeDialog);
assert.deepEqual(buttons, ['directorStage.save.continue', 'directorStage.save.discardChanges', 'directorStage.save.saveAndClose']);
console.log('Scene draft recovery disabled; manual save, dirty tracking, undo/redo and workspaces verified.');
