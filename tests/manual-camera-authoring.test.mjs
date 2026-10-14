import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import {randomUUID} from 'node:crypto';
import {createRequire} from 'node:module';
import * as THREE from 'three';

const require = createRequire(import.meta.url);
const factories = JSON.parse(await fs.readFile(new URL('../src/vendor/module-factories.json', import.meta.url), 'utf8'));
factories['53401'] = require('../src/patches/motion-loader.cjs').patchMotionLoader(factories['53401']);
for (const patch of ['patch-local-motion-library', 'motion-previews', 'pose-library', 'folder-models', 'root-motion',
  'transform-autokey', 'camera-position-autokey', 'camera-navigation-sync', 'manual-timeline-keyframes', 'manual-camera-authoring']) {
  require('../src/patches/' + patch + '.cjs')(factories);
}
const source = factories['53401'];
new vm.Script('(' + source + ')');
const ast = require('@babel/parser').parse('(' + source + ')');
const extract = node => source.slice(node.start - 1, node.end - 1);
const callbacks = {};
let rowRecordSource, propertyRecordSource;
require('@babel/traverse').default(ast, {VariableDeclarator(path) {
  if (!['cx', 'sQ', 'cA', 'cw', 'cS'].includes(path.node.id.name) || path.node.init?.type !== 'CallExpression') return;
  if (!extract(path.node.init).startsWith('(0,n.useCallback)')) return;
  assert.equal(callbacks[path.node.id.name], undefined);
  callbacks[path.node.id.name] = extract(path.node.init);
}, ObjectProperty(path) {
  if (path.node.key.name === 'onRecordRowKeyframe' && path.node.value.type === 'ArrowFunctionExpression') rowRecordSource = extract(path.node.value);
  if (path.node.key.name === 'onToggleCameraKeyframe' && extract(path.node.value).includes('__localRecordManualCameraChannels')) propertyRecordSource = extract(path.node.value);
}});
const axes = ['x', 'y', 'z'];
const positions = axes.map(axis => 'position.' + axis), targets = axes.map(axis => 'target.' + axis);
const channels = [...positions, ...targets, 'lens.fov', 'lens.roll'];
const context = vm.createContext({crypto: {randomUUID}, Date, structuredClone,
  n: {useCallback: callback => callback}, eH: channels, eB: positions, eG: targets, e$: [positions, targets],
  l7: positions, l6: targets, em: axes, ep: Math.PI / 180, eg: 180 / Math.PI,
  tC: 'scene-camera', tI: 'shot-camera::', tQ: 'Camera', tq: new Set(['scene-camera']),
  so: {cj9: THREE.MathUtils, Pq0: THREE.Vector3, PTz: THREE.Quaternion, O9p: THREE.Euler},
});
for (const node of ast.program.body[0].expression.body.body)
  if (node.type === 'FunctionDeclaration') vm.runInContext(extract(node), context);
const createAuthoring = vm.runInContext(`bindings=>{
  const {R,iH,a_,a$,C,rC,il,tZ,iT,Q,ej,od,ek,iK,e$,__localManualCameraId,__localManualCameraDraft}=bindings;
  const sQ=${callbacks.sQ}; const cx=${callbacks.cx}; return {commit:cx,persist:sQ};
}`, context);
const plain = value => JSON.parse(JSON.stringify(value));
const initialCamera = plain(context.tF());
const migrated = context.tZ({kind:'legacy-singular',sceneCamera:initialCamera,cameraTracks:context.eU(initialCamera)});
assert.equal(migrated.ok, true);
const first = plain(migrated.document.cameras[0]);
const second = {...structuredClone(first),id:'camera-B',name:'Camera B'};
second.transform.position = {x:12,y:4,z:-6};
const original = {objects:[],sceneCamera:initialCamera,timeline:{displayFps:30,durationSec:20,clips:[],objectTracks:{},cameraTracks:plain(first.tracks)},
  multiCamera:{...plain(migrated.document),cameras:[first,second]}};
const getCamera = (state,id) => state.multiCamera.cameras.find(camera=>camera.id===id);
const sample = (state,id,frame) => {const camera=getCamera(state,id);return plain(context.eK(context.t0(camera),camera.tracks).sample(frame));};
let state = structuredClone(original), frame = 60, id = 'camera-B', pending = null, selected = [], notices = [];
const draft = {
  read(cameraId,atFrame) {return pending?.cameraId===cameraId&&pending.frame===atFrame?pending:null;},
  stage(cameraId,atFrame,camera,tracks,pose) {
    pending=context.__localManualCameraDraftValue({scope:'test',cameraId,frame:atFrame},camera,tracks,pose);return true;
  },
  replace(value) {pending=value;},
};
function authoring(options={}) {
  return createAuthoring({R:update=>{state=update(state);},iH:{current:'scene-camera'},a_:{current:null},a$:{current:undefined},
    C:options.editable??true,rC:null,il:state.multiCamera,tZ:{getSnapshot:()=>options.playing??false},iT:message=>notices.push(message),
    Q:{timelineCameraPlaybackLocked:'playing',timelineCameraSelectPart:'select'},ej:'performance',od:'camera',ek:{current:frame/30},iK:state,e$:{current:true},
    __localManualCameraId:id,__localManualCameraDraft:draft});
}
function edit(pose,reason='director.scene-camera.view',options={}) {return authoring(options).commit(pose,reason,id);}
function record(recordChannels) {return context.__localRecordManualCameraChannels({editable:true,poseEditing:false,targetPicking:false,playing:false,
  cameraId:id,frame,draft,commit:authoring().persist,select:refs=>{selected=plain(refs);}},recordChannels);}

const destination = {...sample(state,id,frame),position:{x:8,y:3,z:-2},target:{x:1,y:2,z:-7},fov:65};
assert.equal(edit(destination),true);
assert.ok(channels.every(channel=>getCamera(state,id).tracks[channel].length===0),'Nonzero-frame camera navigation never creates keys');
for (const at of [0,15,30,60,120]) assert.deepEqual(sample(state,id,at),sample(state,id,60),'Unkeyed camera holds its edited pose at every frame');
assert.deepEqual(plain(getCamera(state,'scene-camera')),first,'Visible B edits cannot change separately selected A');
assert.deepEqual(plain(state.sceneCamera),initialCamera,'The legacy output projection still belongs to A');
assert.deepEqual(plain(getCamera(original,'camera-B')),second,'Undo/source snapshots are immutable');

frame=0;
assert.equal(record(positions),true);
assert.equal(record(targets),true);
assert.ok(selected.every(ref=>ref.cameraId===id));
const keyedStart=plain(getCamera(state,id));
frame=60;
const endPose={...sample(state,id,frame),position:{x:15,y:5,z:3},target:{x:3,y:1,z:-4},fov:72,roll:12};
assert.equal(edit(endPose),true);
assert.deepEqual(plain(getCamera(state,id)),keyedStart,'Editing an animated camera does not modify a key until an explicit record');
assert.deepEqual(plain(pending.camera.position),endPose.position);
assert.equal(edit({...plain(pending.camera),position:{...endPose.position,x:18}}),true);
assert.equal(pending.camera.position.x,18,'Repeated settled edits accumulate in the current draft');
assert.equal(record(positions),true);
assert.deepEqual(plain(getCamera(state,id).tracks['position.x'].map(key=>[key.frame,key.value])),[[0,8],[60,18]]);
assert.ok(pending.channels.includes('target.x'),'Recording position preserves pending aim and lens changes');
assert.deepEqual(plain(pending.camera.target),endPose.target);
assert.equal(record(targets),true);
assert.ok(pending.channels.includes('lens.fov'));
assert.equal(record(['lens.fov','lens.roll']),true);
assert.equal(pending,null,'Draft disappears only after all changed properties have been explicitly recorded');
assert.equal(sample(state,id,30).position.x,13,'Explicit position keys interpolate at the midpoint');
assert.deepEqual(sample(state,id,60).target,endPose.target);

const ids=channels.map(channel=>getCamera(state,id).tracks[channel].find(key=>key.frame===60)?.id);
assert.equal(edit({...sample(state,id,60),position:{x:20,y:7,z:4}}),true);
record(positions);
assert.deepEqual(channels.map(channel=>getCamera(state,id).tracks[channel].find(key=>key.frame===60)?.id),ids,'Updating existing keys keeps their identity');
assert.deepEqual(plain(getCamera(state,'scene-camera')),first,'Manual record still leaves the other camera untouched');

const beforeRejected=plain(state);
assert.equal(edit({...sample(state,id,60),position:{x:50,y:1,z:1}},'director.scene-camera.view',{editable:false}),false);
assert.equal(edit({...sample(state,id,60),position:{x:50,y:1,z:1}},'director.scene-camera.view',{playing:true}),false);
assert.deepEqual(plain(state),beforeRejected);
assert.deepEqual(notices,['playing']);

// Drive the actual hook across renders, including passive-effect cleanup. A plain
// draft stub cannot catch owner-signature mismatches after a partial manual record.
function draftHook(initialProps) {
  const slots = [], effects = [], cleanups = [];
  let props = initialProps, index = 0, rendering = false, dirty = false, result;
  const equal = (a, b) => a && b && a.length === b.length && a.every((value, at) => Object.is(value, b[at]));
  const react = {
    useState(initial) {
      const at = index++;
      if (!slots[at]) slots[at] = {value: typeof initial === 'function' ? initial() : initial};
      return [slots[at].value, next => {
        const value = typeof next === 'function' ? next(slots[at].value) : next;
        if (!Object.is(value, slots[at].value)) {slots[at].value = value; dirty = true;}
      }];
    },
    useRef(initial) {const at = index++; return slots[at] ??= {current: initial};},
    useCallback(fn, dependencies) {
      if (!rendering) return fn;
      const at = index++;
      if (!slots[at] || !equal(slots[at].dependencies, dependencies)) slots[at] = {fn, dependencies};
      return slots[at].fn;
    },
    useEffect(effect, dependencies) {
      const at = index++;
      if (!slots[at] || !equal(slots[at].dependencies, dependencies)) {
        slots[at] = {dependencies}; effects.push(() => {cleanups[at]?.(); cleanups[at] = effect();});
      }
    },
  };
  const render = (change = {}) => {
    props = {...props, ...change};
    let count = 0;
    do {
      assert.ok(count++ < 10, 'Draft lifecycle converges without a render loop');
      dirty = false; index = 0; rendering = true; context.n = react;
      result = context.__localUseManualCameraDraft(props);
      rendering = false;
      while (effects.length) effects.shift()();
    } while (dirty);
    return result;
  };
  render();
  return {render, get value() {return result;}, dispose() {for (const cleanup of cleanups) cleanup?.();}};
}
function playbackStore() {
  let active = false;
  const listeners = new Set();
  return {getSnapshot: () => active, subscribe(callback) {listeners.add(callback); return () => listeners.delete(callback);},
    set(value) {if (value === active) return; active = value; for (const callback of listeners) callback();},
    get subscribers() {return listeners.size;}};
}
assert.ok(rowRecordSource && propertyRecordSource);
const createCameraCallbacks = vm.runInContext(`bindings=>{
  const {R,iH,a_,a$,C,rC,il,tZ,iT,Q,ej,od,ek,iK,e$,__localManualCameraId,__localManualCameraDraft,
    am,o3,iO,t8,ah,sa,sr,sn,cO,__localNavigationPreview,ec,nU,lj,s7}=bindings;
  const sQ=${callbacks.sQ}; const cx=${callbacks.cx};
  const cA=${callbacks.cA}; const cw=${callbacks.cw}; const cS=${callbacks.cS};
  return {settle:cA,fov:cw,reset:cS,commit:cx,row:${rowRecordSource},property:${propertyRecordSource}};
}`, context);
function liveWorkspace(initial = original) {
  let document = structuredClone(initial), currentFrame = 0, cameraId = 'camera-B', scope = 'project:performance:camera-B';
  let options = {workspace: 'performance', editable: true, pose: null, preview: true, picker: false};
  const playback = playbackStore(), events = [], selection = [], oldToggles = [], objectRecords = [];
  const liveStore = context.__localCreateCameraNavigationPreviewStore();
  const hook = draftHook({scope, cameraId, frame: currentFrame, cameras: document.multiCamera.cameras, playback, enabled: true});
  const render = (changes = {}) => {
    if (changes.frame !== undefined) currentFrame = changes.frame;
    if (changes.cameraId !== undefined) cameraId = changes.cameraId;
    if (changes.scope !== undefined) scope = changes.scope;
    if (changes.state !== undefined) document = changes.state;
    options = {...options, ...changes};
    return hook.render({scope, cameraId, frame: currentFrame, cameras: document.multiCamera.cameras, playback,
      enabled: options.editable && !options.pose});
  };
  const api = () => {
    render();
    const authored = getCamera(document, cameraId);
    const canonical = authored ? options.workspace === 'performance' ? sample(document, cameraId, currentFrame) : plain(context.t0(authored)) : initialCamera;
    return createCameraCallbacks({R(update, reason) {document = update(document); events.push(reason);},
      iH: {current: cameraId}, a_: {current: null}, a$: {current: undefined}, C: options.editable, rC: options.pose,
      il: document.multiCamera, tZ: playback, iT: value => events.push(value), Q: {timelineCameraPlaybackLocked: 'playing', timelineCameraSelectPart: 'select', viewReset: 'reset'},
      ej: options.workspace, od: 'camera', ek: {current: currentFrame / 30}, iK: document, e$: {current: true},
      __localManualCameraId: cameraId, __localManualCameraDraft: hook.value,
      am: options.preview, o3: {activeCameraId: cameraId}, iO: cameraId, t8: value => playback.set(value), ah() {},
      sa: scope + ':' + currentFrame, sr: canonical, sn: hook.value.displayed || canonical,
      cO: options.picker, __localNavigationPreview: liveStore, ec() {}, nU: refs => selection.push(plain(refs)),
      lj: values => oldToggles.push([...values]), s7: (...args) => objectRecords.push(args)});
  };
  return {render, api, hook, playback, events, selection, oldToggles, objectRecords, liveStore,
    get state() {return document;}, get frame() {return currentFrame;}, get id() {return cameraId;},
    get displayed() {render(); return hook.value.displayed || sample(document, cameraId, currentFrame);}};
}
const row = (group, cameraId = 'camera-B') => ({kind: 'camera-group', cameraId, curve: {group}});
const live = liveWorkspace();
live.api().row(row('position'));
live.api().row(row('target'));
live.render({frame: 60});
const beforeNavigation = plain(getCamera(live.state, live.id));
const firstPose = {...live.displayed, position: {x: 20, y: 6, z: -4}, target: {x: 8, y: 2, z: -12}, fov: 70, roll: 15};
assert.equal(live.api().settle(firstPose), true);
live.render();
assert.deepEqual(plain(live.hook.value.displayed.position), firstPose.position);
assert.deepEqual(plain(getCamera(live.state, live.id)), beforeNavigation, 'Real navigation settles to a hook draft without writing any animation key');
const secondPose = {...live.displayed, position: {x: 22, y: 7, z: -5}, target: {x: 10, y: 3, z: -13}};
assert.equal(live.api().settle(secondPose), true);
live.api().fov(78);
live.render();
assert.deepEqual(plain(live.hook.value.displayed.target), secondPose.target, 'Several completed WASD/mouse gestures and FOV edits accumulate');
assert.equal(live.hook.value.displayed.fov, 78);
live.api().row(row('position'));
live.render();
assert.ok(live.hook.value.read(live.id, live.frame), 'An own manual commit rebases the real draft signature after React rerenders');
assert.deepEqual(plain(live.displayed.target), secondPose.target);
assert.equal(sample(live.state, live.id, 60).position.x, 22);
assert.notEqual(sample(live.state, live.id, 60).target.x, 10, 'Unrecorded target stays transient');
live.api().property(targets);
live.render();
assert.deepEqual(live.oldToggles, [], 'A property diamond records the pending pose rather than deleting an existing key');
assert.equal(sample(live.state, live.id, 60).target.x, 10);
assert.ok(live.hook.value.read(live.id, live.frame));
assert.equal(live.displayed.fov, 78);
live.api().property(['lens.fov', 'lens.roll']);
live.render();
assert.equal(live.hook.value.displayed, null);
live.api().property(positions);
assert.deepEqual(live.oldToggles, [positions], 'A clean property diamond retains the established toggle behavior');
assert.ok(live.selection.flat().every(ref => ref.cameraId === live.id));
live.api().row({kind: 'object-group', object: {id: 'actor'}, objectGroup: 'position'});
assert.deepEqual(live.objectRecords, [['actor', 'position', true]], 'Object recording retains the original route');

const stagePending = workspace => {
  const pose = {...workspace.displayed, position: {...workspace.displayed.position, x: workspace.displayed.position.x + 3},
    target: {...workspace.displayed.target, y: workspace.displayed.target.y + 1}};
  assert.equal(workspace.api().settle(pose), true); workspace.render();
  assert.ok(workspace.hook.value.displayed);
};
stagePending(live);
const keyedBeforeOtherCamera = plain(getCamera(live.state, live.id));
live.api().row(row('position', 'scene-camera'));
live.render();
assert.ok(live.hook.value.displayed, 'Recording a different row cannot consume the active camera draft');
assert.deepEqual(plain(getCamera(live.state, live.id)), keyedBeforeOtherCamera);
assert.equal(live.selection.at(-1)[0].cameraId, 'scene-camera');
live.render({frame: 61});
assert.equal(live.hook.value.displayed, null, 'Seeking expires an unrecorded draft');
live.render({frame: 60});
assert.equal(live.hook.value.displayed, null, 'Returning to the frame cannot resurrect a discarded draft');
stagePending(live);
live.render({cameraId: 'scene-camera'});
assert.equal(live.hook.value.displayed, null, 'Switching cameras expires the pending pose');
live.render({cameraId: 'camera-B'});
stagePending(live);
live.playback.set(true);
assert.equal(live.hook.value.read(live.id, 60), null, 'Starting playback immediately stops displaying an unrecorded edit');
live.playback.set(false); live.render();
assert.equal(live.hook.value.displayed, null, 'Stopping playback cannot resurrect a pending pose');
stagePending(live);
const external = structuredClone(plain(live.state));
getCamera(external, live.id).tracks['position.x'].at(-1).value += 1;
live.render({state: external});
assert.equal(live.hook.value.displayed, null, 'External key edits or undo invalidate stale camera drafts');
stagePending(live);
live.render({scope: 'other-project'});
assert.equal(live.hook.value.displayed, null, 'Drafts cannot leak into another session');
stagePending(live);
live.liveStore.publish({camera: live.displayed});
live.api().reset(); live.render();
assert.equal(live.hook.value.displayed, null, 'Reset view cancels the settled draft');
assert.equal(live.liveStore.getSnapshot(), null);

stagePending(live);
live.render({editable: false});
assert.equal(live.hook.value.displayed, null);
assert.equal(live.api().settle({...sample(live.state, live.id, 60), position: {x: 100, y: 1, z: 1}}), false);
live.render({editable: true, pose: {kind: 'pose'}});
assert.equal(live.api().settle({...sample(live.state, live.id, 60), position: {x: 100, y: 1, z: 1}}), false);
live.render({pose: null, preview: false});
assert.equal(live.api().settle({...sample(live.state, live.id, 60), position: {x: 100, y: 1, z: 1}}), false, 'Free director navigation cannot author a shot camera');
live.render({preview: true});
const locked = structuredClone(plain(live.state));
getCamera(locked, live.id).authoring.cameraLocked = true;
getCamera(locked, live.id).authoring.targetLocked = true;
live.render({state: locked});
const lockedSnapshot = plain(live.state);
assert.equal(live.api().settle({...live.displayed, position: {x: 100, y: 2, z: 1}, target: {x: 9, y: 8, z: 7}}), false);
live.api().row(row('position')); live.api().row(row('target'));
assert.deepEqual(plain(live.state), lockedSnapshot, 'Authoritative position and target locks survive gesture payloads and manual recording');
const empty = structuredClone(plain(live.state)); empty.multiCamera.cameras = [];
live.render({state: empty});
assert.equal(live.api().settle({...initialCamera, position: {x: 100, y: 2, z: 1}}), false);
assert.equal(live.hook.value.displayed, null);

for (const [lock, protectedGroup, editableGroup] of [['cameraLocked', 'position', 'target'], ['targetLocked', 'target', 'position']]) {
  const input = structuredClone(plain(state));
  getCamera(input, 'camera-B').authoring[lock] = true;
  const isolated = liveWorkspace(input);
  isolated.render({frame: 60});
  const before = isolated.displayed;
  const requested = {...before, cameraLocked: false, targetLocked: false, position: {x: 90, y: 8, z: 4}, target: {x: 41, y: 3, z: -8}};
  assert.equal(isolated.api().settle(requested), true, 'One locked group does not disable editing the other group');
  isolated.render();
  assert.deepEqual(plain(isolated.displayed[protectedGroup]), before[protectedGroup], lock + ' protects its own coordinates');
  assert.deepEqual(plain(isolated.displayed[editableGroup]), requested[editableGroup], 'The unlocked group still previews the requested change');
  assert.equal(isolated.displayed[lock], true, 'Incoming gesture payloads cannot unlock an authored camera');
  const tracksBefore = plain(getCamera(isolated.state, isolated.id).tracks);
  isolated.api().row(row(protectedGroup));
  assert.deepEqual(plain(getCamera(isolated.state, isolated.id).tracks), tracksBefore, 'The locked group refuses manual recording');
  isolated.api().row(row(editableGroup)); isolated.render();
  assert.deepEqual(sample(isolated.state, isolated.id, 60)[editableGroup], requested[editableGroup]);
  assert.equal(isolated.hook.value.displayed, null);
  isolated.hook.dispose();
}

const staticView = liveWorkspace(state);
staticView.render({workspace: 'staging', scope: 'staging', frame: 60});
const staticBefore = plain(getCamera(staticView.state, 'camera-B'));
const staticPose = {...plain(context.t0(getCamera(staticView.state, 'camera-B'))), position: {x: 33, y: 5, z: 2}, target: {x: 11, y: 1, z: -3}};
assert.equal(staticView.api().settle(staticPose), true);
staticView.render();
assert.deepEqual(plain(getCamera(staticView.state, 'camera-B').transform.position), staticPose.position, 'Static staging edits persist the base pose even when manual animation already exists');
assert.deepEqual(plain(getCamera(staticView.state, 'camera-B').tracks), staticBefore.tracks, 'Static staging edits never overwrite or add animation keys');
assert.equal(staticView.hook.value.displayed, null, 'Static staging has no inaccessible manual-keyframe draft');
assert.equal(staticView.playback.subscribers, 1);
staticView.hook.dispose(); live.hook.dispose();
assert.equal(staticView.playback.subscribers, 0, 'Unmount cleans up the playback subscription');

console.log('Manual camera authoring: static defaults, isolated IDs, real draft ownership, gesture accumulation, explicit row/property keys, partial-record rerenders, reset, locks and staging passed');
