import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import {randomUUID,webcrypto} from 'node:crypto';
import {createRequire} from 'node:module';

const require=createRequire(import.meta.url),bundle={window:{}};
vm.runInNewContext(await fs.readFile(new URL('../web/vendor/modules.js',import.meta.url),'utf8'),bundle);
const source=bundle.window.directorFactories[53401].toString();
const ast=require('@babel/parser').parse('('+source+')'),extract=node=>source.slice(node.start-1,node.end-1);
const axes=['x','y','z'];
const context=vm.createContext({crypto:{randomUUID,subtle:webcrypto.subtle},Date,TextEncoder,TextDecoder,console,
  AbortController,Uint8Array,Math,em:axes,tW:axes,tK:['position','rotation','scale'],ep:Math.PI/180,eg:180/Math.PI,
  tq:new Set(['scene-camera']),lH:{},th:'mixamo-fbx-v1',
  ke:{kR:()=>false,uz:class ServiceError extends Error{}},
});
vm.runInContext('this.structuredClone=value=>JSON.parse(JSON.stringify(value))',context);
const constants=new Set(['eH','eB','eG','e$','tv','tj','tC','tI','tQ','nt','kt','kr','ku','km','tK','ig','am','ap','s9','fu','iI','iV','iM','ag','af','ti','aS']);
const literal=node=>!!node&&(['StringLiteral','NumericLiteral','BooleanLiteral','NullLiteral','RegExpLiteral','BigIntLiteral'].includes(node.type)||
  node.type==='ArrayExpression'&&node.elements.every(item=>!item||literal(item))||
  node.type==='ObjectExpression'&&node.properties.every(item=>item.type==='ObjectProperty'&&!item.computed&&literal(item.value))||
  node.type==='UnaryExpression'&&['-','+','!'].includes(node.operator)&&literal(node.argument)||
  node.type==='NewExpression'&&['Set','Map'].includes(node.callee.name)&&node.arguments.every(literal));
for(const node of ast.program.body[0].expression.body.body){
  if(node.type==='FunctionDeclaration')vm.runInContext(extract(node),context);
  if(node.type==='VariableDeclaration')for(const item of node.declarations){
    if(constants.has(item.id.name)||literal(item.init))vm.runInContext(extract(item),context);
  }
}
let initialize,performanceConstructor,syncConstructor,freezeConstructor;
require('@babel/traverse').default(ast,{ArrowFunctionExpression(path){
  const text=extract(path.node);
  if(text.includes('o??ns(),t,r')&&text.startsWith('()=>')&&(!initialize||text.length<initialize.length))initialize=text;
},FunctionExpression(path){
  const text=extract(path.node);
  if(text.includes('n=`performance-${crypto.randomUUID()}`,o=__localEmptyDirectorState()')&&
    (!performanceConstructor||text.length<performanceConstructor.length))performanceConstructor=text;
  if(text.includes('l=no({...nc(i,a.sharedLibrary,a.stagingWorkspaces)')&&
    (!syncConstructor||text.length<syncConstructor.length))syncConstructor=text;
  if(text.includes('i=a.performanceWorkspaces.find(e=>e.id===t.performanceId)')&&text.includes('t.evaluatedFrame.jointTransforms')&&
    (!freezeConstructor||text.length<freezeConstructor.length))freezeConstructor=text;
}});
assert.equal(typeof context.__localEmptyDirectorState,'function','Build empty-scene-startup after the empty camera patch');
assert.ok(initialize,'Exercise the actual project initialization callback');
assert.ok(performanceConstructor,'Exercise the actual switch-without-sync performance constructor');
const createPerformance=vm.runInContext('('+performanceConstructor+')',context);
assert.ok(syncConstructor,'Exercise the actual sync-to-performance constructor');
const syncPerformance=vm.runInContext('('+syncConstructor+')',context);
assert.ok(freezeConstructor,'Exercise the actual freeze-to-staging constructor');
const freezePerformance=vm.runInContext('('+freezeConstructor+')',context);
const plain=value=>JSON.parse(JSON.stringify(value));
const assertEmpty=state=>{
  assert.deepEqual(plain(state.objects.map(object=>object.kind)),['environment'],
    'Only the internal grid and lighting container remains; no placed character or prop');
  assert.deepEqual(plain(state.selectedObjectIds),[]);
  assert.deepEqual(plain(state.jointTransforms),{});
  assert.deepEqual(plain(state.selectionGroups),[]);
  assert.deepEqual(plain(state.multiCamera),{schemaVersion:3,cameras:[],outputCameraId:''});
  assert.deepEqual(plain(state.timeline.clips),[]);
  assert.deepEqual(plain(state.timeline.objectTracks),{});
  assert.equal(Object.values(state.timeline.cameraTracks).flat().length,0);
  assert.equal(state.timeline.cameraCutTrack?.clips.length||0,0);
  assert.equal(state.environment.gridVisible,true,'The editing grid remains available in an empty scene');
};
assertEmpty(context.__localEmptyDirectorState());
const first=context.ns();
assert.equal(first.stagingWorkspaces.length,1);
assert.equal(first.performanceWorkspaces.length,0);
assert.deepEqual(plain(first.sharedLibrary),{poses:[],cameras:[],captures:[]});
assert.deepEqual(plain(first.exports),[]);
assertEmpty(context.nf(first));
assertEmpty(context.nf(context.np(JSON.parse(JSON.stringify(first)))));
const second=context.ns();
assert.notEqual(first.stagingWorkspaces[0].objects,second.stagingWorkspaces[0].objects,'New projects do not share mutable defaults');
first.stagingWorkspaces[0].environment.backgroundColor='#123456';
assert.equal(second.stagingWorkspaces[0].environment.backgroundColor,'#171717');

context.o=null;context.t='local-director';context.r='local-stage';
const storage=new Map();
context.window={localStorage:{getItem:key=>storage.get(key)??null}};
context.k$=()=>[];context.kZ=(project,node)=>project+':'+node;
const fresh=vm.runInContext('('+initialize+')',context)();
assertEmpty(context.nf(fresh));
const emptyDynamic=createPerformance(fresh,'New dynamic workspace');
assert.equal(emptyDynamic.activeWorkspace.kind,'performance');
assert.equal(emptyDynamic.performanceWorkspaces.length,1);
assertEmpty(context.nf(emptyDynamic));
assert.equal(fresh.performanceWorkspaces.length,0,'Creating a performance workspace does not mutate the staging project');
assertEmpty(context.nf(syncPerformance(fresh,fresh.stagingWorkspaces[0].id,'Synchronized empty workspace')));
const freeze=project=>freezePerformance(project,{performanceId:project.performanceWorkspaces[0].id,
  snapshotId:'frozen-empty',evaluatedFrame:{frame:0,sceneCamera:project.performanceWorkspaces[0].sceneCamera,
    objectTransforms:{},jointTransforms:{}}});
const frozenEmpty=freeze(emptyDynamic);
assert.equal(frozenEmpty.ok,true);
assertEmpty(context.nf({...frozenEmpty.project,activeWorkspace:frozenEmpty.targetWorkspace}));
let loadCount=0;
assert.deepEqual(plain(await context.kK({projectId:'local-director',nodeId:'local-stage',port:{load:()=>{loadCount++}}})),
  {ok:false,reason:'no-version'});
assert.equal(loadCount,0,'First launch without stored version does not load a remote or sample project');

const createdAt='2026-09-23T00:00:00.000Z';
const oldState=context.iw();
const migrated=context.tZ({kind:'legacy-singular',sceneCamera:oldState.sceneCamera,cameraTracks:oldState.timeline.cameraTracks});
assert.equal(migrated.ok,true);
assert.equal(migrated.document.cameras.length,1,'Old singular camera projects keep their camera');
const staticHasCamera={...emptyDynamic,stagingWorkspaces:emptyDynamic.stagingWorkspaces.map(stage=>
  ({...stage,multiCamera:migrated.document}))};
const clearedFrozen=freeze(staticHasCamera);
assert.equal(clearedFrozen.ok,true);
assert.equal(clearedFrozen.changed,true,'Freezing a camera-free workspace detects a camera-only difference');
assertEmpty(context.nf({...clearedFrozen.project,activeWorkspace:clearedFrozen.targetWorkspace}));
const person={id:'saved-person',name:'Existing character',kind:'model',source:'imported',rigged:true,
  visible:true,locked:false,opacity:1,skeletonId:'mixamo-fbx-v1',skeletonVersion:1,transform:context.ig(),
  asset:{provider:'catalog',assetId:'existing-character',mediaUrl:'/assets/character.fbx',extension:'.fbx'}};
const pose={signature:'fixture',rotations:[{boneIndex:0,rotation:{x:0,y:0,z:0},bindWorldRotation:{x:0,y:0,z:0,w:1}}]};
const motion={id:'saved-motion',objectId:person.id,motionId:'__director_stage_custom_pose__',source:'builtin',
  customPose:pose,startTimeSec:2,offsetTimeSec:0,durationSec:2,speed:1,loop:false,
  transitionInFrames:0,createdAt,locomotionMode:'in-place',motionUsage:'direct'};
const existingState={...oldState,objects:[...oldState.objects,person],multiCamera:migrated.document,
  timeline:{...oldState.timeline,clips:[motion],cameraCutTrack:{version:1,clips:[{
    id:'saved-shot',cameraId:migrated.document.outputCameraId,startFrame:0,endFrame:120,createdAt}]}}};
const saved=context.ns();
saved.stagingWorkspaces=[context.nn(existingState,{id:'stage',name:'Saved scene',createdAt,updatedAt:createdAt})];
saved.performanceWorkspaces=[context.no(existingState,{id:'performance',name:'Saved animation',createdAt,updatedAt:createdAt})];
saved.activeWorkspace={kind:'performance',id:'performance'};
const before=plain(saved);context.o=saved;
const reopened=vm.runInContext('('+initialize+')',context)();
assert.equal(reopened,saved,'A loaded project is passed through instead of replaced with new defaults');
const normalized=context.nf(reopened);
assert.equal(normalized.objects.filter(object=>object.kind==='model').length,1);
assert.equal(normalized.timeline.clips[0].id,'saved-motion');
assert.equal(normalized.timeline.cameraCutTrack.clips[0].id,'saved-shot');
assert.equal(normalized.multiCamera.cameras.length,1);
assert.deepEqual(plain(saved),before,'Opening and evaluating a saved project never mutates it');
const existingDynamic=createPerformance(saved,'Unused new workspace name');
assert.equal(existingDynamic.performanceWorkspaces.length,1);
assert.equal(existingDynamic.performanceWorkspaces[0].id,'performance','Switching to an existing performance workspace reuses it');
assert.equal(existingDynamic.performanceWorkspaces[0].timeline.clips[0].id,'saved-motion');
assert.equal(existingDynamic.performanceWorkspaces[0].multiCamera.cameras.length,1);
const separateStatic={...saved,performanceWorkspaces:[],activeWorkspace:{kind:'staging',id:'stage'}};
const skippedSync=createPerformance(separateStatic,'New empty performance');
assertEmpty(context.nf(skippedSync));
assert.equal(skippedSync.stagingWorkspaces[0].objects.filter(object=>object.kind==='model').length,1,
  'Not syncing creates an empty dynamic workspace while preserving existing static content');

for(const project of [second,emptyDynamic,saved]){
  const encoded=context.ka({project,documentId:'local-stage',title:'Local scene',dataVersion:1});
  assert.equal(encoded.ok,true,'Production serializer accepts both new empty and existing populated scenes');
  const checked=context.ki(JSON.stringify(encoded.document));
  assert.equal(checked.ok,true,'Canonical project validation accepts serialized scene');
  let request;
  const restored=await context.kK({projectId:'local-director',nodeId:'local-stage',versionId:'1',
    signal:new AbortController().signal,resolveResource:()=>({mediaUrl:'/assets/character.fbx'}),
    port:{load:async value=>{request=value;return new TextEncoder().encode(JSON.stringify(encoded.document))}}});
  assert.equal(restored.ok,true,'Saving and reopening the project retains its scene');
  assert.equal(request.versionId,'1');
  if(project!==saved){
    assert.equal(encoded.document.staging.cameras.cameras.length,0,'Saving an empty scene cannot invent a camera');
    assertEmpty(context.nf(restored.project));
    if(project===emptyDynamic){
      assert.equal(encoded.document.performance.cameras.cameras.length,0);
      assertEmpty(context.nf({...restored.project,activeWorkspace:{kind:'performance',id:restored.project.performanceWorkspaces[0].id}}));
    }
  }else{
    const performance=restored.project.performanceWorkspaces[0];
    assert.equal(performance.objects.filter(object=>object.kind==='model').length,1);
    assert.equal(performance.timeline.clips[0].id,'saved-motion');
    assert.equal(performance.timeline.cameraCutTrack.clips[0].id,'saved-shot');
    assert.equal(performance.multiCamera.cameras.length,1);
  }
}
console.log('Empty startup passed: real new-project initializer and normalization, no sample load, fresh object isolation, existing characters/actions/shots preserved, and canonical empty/populated save-load round trips.');
