import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import {randomUUID} from 'node:crypto';
import {createRequire} from 'node:module';
import * as THREE from 'three';

const require=createRequire(import.meta.url);
const bundle={window:{}};
vm.runInNewContext(await fs.readFile(new URL('../web/vendor/modules.js',import.meta.url),'utf8'),bundle);
const source=bundle.window.directorFactories['53401'].toString();
const ast=require('@babel/parser').parse('('+source+')');
const jsx=(type,props,key)=>({type,props:props||{},key});
const context=vm.createContext({crypto:{randomUUID},structuredClone,Map,Set,WeakMap,
  i:{jsx,jsxs:jsx,Fragment:'fragment'},ck:{A:'bone-icon'},
  so:{Pq0:THREE.Vector3,PTz:THREE.Quaternion,O9p:THREE.Euler,cj9:THREE.MathUtils},
  s9:'__director_stage_custom_pose__',ap:'path-traversal'});
const extract=node=>source.slice(node.start-1,node.end-1);
let editCallback,recordCallback,cancelCallback,keyCapture;
require('@babel/traverse').default(ast,{
  FunctionDeclaration(path){vm.runInContext(extract(path.node),context)},
  ObjectProperty(path){
    if(path.node.key.name==='onEditBoneClip'&&path.node.value.type==='ArrowFunctionExpression'){
      const callback=extract(path.node.value);
      if(callback.includes('__localBoneTools'))editCallback=callback;
    }
    if(path.node.key.name==='onBeginObjectBoneEdit'&&path.node.value.type==='ArrowFunctionExpression'){
      const callback=extract(path.node.value);
      if(callback.includes('__localBoneTools'))recordCallback=callback;
    }
  },
  VariableDeclarator(path){
    if(['gq','gQ','gJ'].includes(path.node.id.name)&&path.node.init?.type==='StringLiteral'){
      context[path.node.id.name]=path.node.init.value;
    }
    if(path.node.id.name==='dY'&&path.node.init?.type==='CallExpression'){
      const callback=path.node.init.arguments[0];
      if(callback?.type==='ArrowFunctionExpression'&&extract(callback).includes('rI(null),iE('))cancelCallback=extract(callback);
    }
  },
  ArrowFunctionExpression(path){
    const callback=extract(path.node);
    if(callback.includes('if(g_(e)&&e.target?.closest?.("[data-bone-key-id]"))return;')&&
      (!keyCapture||callback.length<keyCapture.length))keyCapture=callback;
  },
});
assert.equal(typeof context.__localBoneEditorClip,'function','Build the skeletal editor synchronization patch first');
assert.ok(editCallback&&recordCallback&&cancelCallback,'Exercise the production workspace key and cancel callbacks');
assert.ok(keyCapture,'Exercise the real global keydown capture handler, including the active pose trap');
const plain=value=>JSON.parse(JSON.stringify(value));
const pose=angle=>({signature:'sync-fixture',rootTranslation:{x:angle/10,y:0,z:0},rotations:[
  {boneIndex:0,rotation:{x:0,y:0,z:0},bindWorldRotation:{x:0,y:0,z:0,w:1}},
  {boneIndex:1,rotation:{x:angle,y:0,z:0},bindWorldRotation:{x:0,y:0,z:0,w:1}},
]});
const key=(id,timeSec,angle)=>({id,timeSec,pose:pose(angle)});
const originalKeys=[key('persisted-start',0,0),key('persisted-end',6,60)];
const clip={id:'saved',objectId:'person',motionId:'motion',motionName:'Persisted action',source:'imported',
  startTimeSec:2,offsetTimeSec:1.25,durationSec:4,speed:2,loop:false,transitionInFrames:0,
  createdAt:'2026-09-23T00:00:00Z',locomotionMode:'embedded',motionUsage:'direct',
  boneKeyframes:originalKeys,boneTiming:{offsetTimeSec:0,speed:1}};
const session={boneAnimation:true,objectId:'person',clipId:'saved',startTimeSec:3,durationSec:2,
  displayName:'Unsaved edited action',keyTimeSec:1,boneKeys:[key('a',0,0),key('b',1,30),key('c',2,60)],
  baselinePose:pose(0),jointTransforms:{},lockedJointIds:[],boneDirty:false};
const original=plain(clip);
const projected=context.__localBoneEditorClip(clip,session);
assert.notEqual(projected,clip);
assert.equal(projected.startTimeSec,3);
assert.equal(projected.durationSec,2);
assert.equal(projected.motionName,session.displayName);
assert.deepEqual(plain(context.__localBoneDisplayKeys(projected)),plain(session.boneKeys),
  'Session-local key times cannot receive source offset or speed twice');
assert.equal(context.__localBoneLocalTime(projected,4),1,'A nonzero global start samples session-local time');
assert.deepEqual(plain(clip),original,'Display projection cannot mutate persisted clip data');
for(const other of [null,{...session,boneAnimation:false},{...session,clipId:'different'}]){
  assert.equal(context.__localBoneEditorClip(clip,other),clip,'Unrelated clip references remain unchanged');
}

const elements=value=>{
  if(Array.isArray(value))return value.flatMap(elements);
  if(!value||typeof value!=='object')return[];
  return[value,...elements(value.props?.children)];
};
const renderMarkers=props=>{
  context.n={useRef:initial=>({current:initial}),useState:initial=>[typeof initial==='function'?initial():initial,()=>{}]};
  return context.__LocalBoneMarkers(props);
};
const markers=(value,active,callbacks={})=>elements(renderMarkers({clip:value,session:active,fps:30,pixelsPerFrame:6,
  onMove:callbacks.onMove||(()=>{}),onEdit:callbacks.onEdit||(()=>{}),onDelete:callbacks.onDelete||(()=>{})}))
  .filter(element=>element.props['data-bone-key-id']);
const rendered=markers(clip,session);
assert.deepEqual(rendered.map(element=>element.props['data-bone-key-id']),['a','b','c']);
assert.equal(rendered.filter(element=>element.props['aria-pressed']===true).length,1);
assert.equal(rendered.find(element=>element.props['aria-pressed']===true).props['data-bone-key-id'],'b');
assert.match(rendered[1].props.style.left,/50%/,'The middle session key is drawn halfway through the clip');
const draftClip={...clip,id:'draft',customPose:pose(0),boneKeyframes:undefined};
const draftSession={...session,clipId:undefined,draftClip};
const draftMarkers=renderMarkers({clip:draftClip,session:draftSession,fps:30,pixelsPerFrame:6,onMove:()=>{},onEdit:()=>{},onDelete:()=>{}});
assert.deepEqual(markers(draftClip,draftSession).map(element=>element.props['data-bone-key-id']),['a','b','c'],
  'An uncommitted draft projects every editor key');
const draftElement=context.hd({draftId:'draft',label:'Draft',leftPx:20,widthPx:200,
  onMovePointerDown:()=>{},onTrimStartPointerDown:()=>{},onTrimEndPointerDown:()=>{},boneMarkers:draftMarkers});
assert.equal(elements(draftElement).filter(element=>element.props['data-bone-key-id']).length,3,
  'The real draft clip component mounts its skeletal marker slot');
const checkButtons=(value,inButton=false)=>{
  if(Array.isArray(value)){value.forEach(child=>checkButtons(child,inButton));return}
  if(!value||typeof value!=='object')return;
  assert.ok(!(inButton&&value.type==='button'),'Skeletal marker buttons cannot be nested in the draft drag button');
  checkButtons(value.props?.children,inButton||value.type==='button');
};
checkButtons(draftElement);

function fixture(draft=false){
  let state={objects:[{id:'person',rigged:true}],selectedObjectIds:['person'],mode:'pose',
    timeline:{displayFps:30,durationSec:12,clips:draft?[]:[structuredClone(clip)]}};
  let editing={...structuredClone(draft?draftSession:session),keyTimeSec:1,
    boneKeys:[key('start',0,0),key('end',2,60)]};
  let copied=pose(30),commitCount=0,pendingBegin;
  const refs=[],notices=[],seeks=[],sampledFrames=[];
  const setSession=value=>{editing=typeof value==='function'?value(editing):value};
  const render=()=>{
    let cursor=0;
    context.n={useRef:initial=>refs[cursor++]??(refs[cursor-1]={current:initial}),useEffect:()=>{}};
    return context.__localUseBoneEditing({state,session:editing,setSession,
      controller:{current:{copyPose:()=>copied,captureEvaluatedPerformanceFrame:async value=>({
        skeletalPoses:{person:context.__localNormalizeBonePose(value.motionPoses.person.sample)},jointTransforms:{},
      })}},sampleFrame:frame=>{sampledFrames.push(frame);return{frame,motionPoses:{person:{kind:'single',sample:pose(0)}}}},
      seek:value=>seeks.push(value),stop:()=>{},select:()=>{},commit:update=>{commitCount++;state=update(state)},
      finish:()=>{},notice:value=>notices.push(value),scope:'sync-fixture'});
  };
  const editFromWorkspace=async localTime=>{
    const tools=render();
    context.iK=state;context.rC=editing;context.ek={current:editing.startTimeSec+editing.keyTimeSec};
    context.__localBoneTools={...tools,begin:(...args)=>{pendingBegin=tools.begin(...args);return pendingBegin}};
    const route=vm.runInContext('('+editCallback+')',context);
    pendingBegin=undefined;
    route(editing.clipId||editing.draftClip.id,localTime);
    assert.ok(pendingBegin,'Workspace marker route must accept both persisted and draft clip IDs');
    await pendingBegin;
  };
  const cancel=()=>{
    context.rI=setSession;context.iE=update=>{state=update(state)};
    context.ia=()=>{};context.cg={};context.tr=()=>{};
    vm.runInContext('('+cancelCallback+')',context)();
  };
  const recordFromWorkspace=()=>{
    context.iK=state;context.rC=editing;context.__localBoneTools=render();
    context.__localBonePlaybackActive=false;
    context.ek={current:editing.startTimeSec+editing.keyTimeSec};
    vm.runInContext('('+recordCallback+')',context)('person');
  };
  return{render,editFromWorkspace,recordFromWorkspace,cancel,setSession,
    get state(){return state},get session(){return editing},get commits(){return commitCount},
    get activeId(){return editing.clipId||editing.draftClip.id},notices,seeks,sampledFrames,
    copy:angle=>{copied=pose(angle)},
  };
}

for(const draft of [true,false]){
  const item=fixture(draft),before=plain(item.state.timeline);
  const target=draft?item.session.draftClip:item.state.timeline.clips[0];
  item.recordFromWorkspace();
  assert.equal(item.session.boneKeys.length,3,'Record adds a visible session key');
  const middle=item.session.boneKeys.find(value=>value.timeSec===1);
  assert.equal(markers(target,item.session).length,3,'Timeline marker count updates without saving');
  item.copy(42);item.render().record();
  assert.equal(item.session.boneKeys.length,3,'Update does not create a second marker at the same frame');
  assert.equal(item.session.boneKeys.find(value=>value.timeSec===1).id,middle.id);
  assert.equal(item.session.boneKeys.find(value=>value.id===middle.id).pose.rotations[1].rotation.x,42);
  const unsaved=plain(item.session.boneKeys);
  await item.editFromWorkspace(2);
  assert.equal(item.session.keyTimeSec,2,'Clicking the endpoint marker seeks the current editor');
  assert.deepEqual(plain(item.session.boneKeys),unsaved,'Marker navigation cannot reload and discard unsaved keys');
  assert.equal(item.seeks.at(-1),5,'A marker local time is converted using the nonzero session start');
  const controller=item.render();
  const marker=markers(target,item.session,{onDelete:id=>controller.deleteKey(item.activeId,id)})
    .find(element=>element.props['data-bone-key-id']===middle.id);
  let prevented=false,stopped=false;
  marker.props.onKeyDown({key:'Delete',preventDefault:()=>{prevented=true},stopPropagation:()=>{stopped=true}});
  assert.ok(prevented&&stopped,'Marker delete consumes the event before timeline clip deletion');
  assert.equal(item.session.boneKeys.length,2);
  assert.equal(markers(target,item.session).length,2,'Deleting a key immediately removes its timeline marker');
  assert.equal(item.commits,0,'Record, update, navigate, and delete stay in the editor transaction');
  assert.deepEqual(plain(item.state.timeline),before,'Uncommitted skeletal edits cannot alter saved timeline state');
  item.cancel();
  assert.equal(item.session,null);
  assert.deepEqual(plain(item.state.timeline),before,'The actual Cancel callback restores the original timeline');
  assert.equal(context.__localBoneEditorClip(target,item.session),target,'Cancelling removes the display projection');
}

const protectedKey=fixture(false);
protectedKey.setSession({...protectedKey.session,poseContinuation:{anchorKeyId:'start',transitionFrames:8}});
protectedKey.render().deleteKey(protectedKey.activeId,'start');
assert.equal(protectedKey.session.boneKeys.length,2,'The continuation anchor stays protected during live editing');
assert.equal(protectedKey.commits,0);

const captureFactory=vm.runInContext('(function(config){const {document,f,t,r,a,i,o,s,l,u,c,p,d,m,g}=config;return '+keyCapture+'})',context);
function keyFixture({activePose=true,modal=false,disabled=false}={}){
  const calls=[];
  const handler=captureFactory({document:{querySelector:()=>modal?{}:null},
    f:{cancelCameraGesture:()=>calls.push('camera.cancel'),cancelTimelineTransient:()=>false,
      dispatchTimelineCommand:command=>calls.push(command.type),dispatchHistoryNavigation:command=>calls.push(command),
      closeTransientUi:()=>false,hasEditTarget:()=>false},
    t:{current:{cameraGestureKeyDown:()=>false,cancelCameraGesture:()=>false}},
    r:'timeline',a:{kind:'motion-clips',clipIds:['saved']},i:false,o:30,s:true,l:false,u:'pose',c:false,p:false,d:disabled,
    m:activePose?[{active:true,cancel:()=>calls.push('pose.cancel')}]:[],g:()=>calls.push('save'),
  });
  const event=(key,{bone=false,tag='BUTTON',ctrlKey=false}={})=>{
    const target={tagName:tag,isContentEditable:false,matches:()=>false,closest(selector){
      if(selector==='[data-bone-key-id]')return bone?target:null;
      if(selector==='button'||selector==='button, summary')return tag==='BUTTON'?target:null;
      if(selector===context.gQ)return tag==='DIV'?target:null;
      return null;
    }};
    return{key,code:key,ctrlKey,metaKey:false,altKey:false,shiftKey:false,repeat:false,isComposing:false,
      target,defaultPrevented:false,stopped:false,
      preventDefault(){this.defaultPrevented=true},stopPropagation(){this.stopped=true}};
  };
  return{handler,event,calls};
}

for(const key of ['Delete','Backspace'])for(const activePose of [true,false]){
  const item=fixture(true);item.render().record();
  const middle=item.session.boneKeys.find(value=>value.timeSec===1);
  const control=item.render();
  const marker=markers(item.session.draftClip,item.session,{onDelete:id=>control.deleteKey(item.activeId,id)})
    .find(element=>element.props['data-bone-key-id']===middle.id);
  const global=keyFixture({activePose}),event=global.event(key,{bone:true});
  global.handler(event);
  assert.equal(event.defaultPrevented,false,'Global capture must let '+key+' reach a focused bone marker');
  assert.equal(event.stopped,false,'The active pose trap cannot swallow bone marker '+key);
  assert.deepEqual(global.calls,[],'A focused bone marker must not dispatch clip deletion or a global command');
  marker.props.onKeyDown(event);
  assert.equal(item.session.boneKeys.length,2,'The real marker handler receives '+key+' after global capture');
  assert.equal(item.commits,0,'The focused draft key is removed without committing the draft');
  assert.ok(event.defaultPrevented&&event.stopped,'The marker owns deletion after capture releases it');
}

const exclusive=keyFixture();
for(const key of ['Delete','Backspace','r']){
  const event=exclusive.event(key);
  exclusive.handler(event);
  assert.ok(event.defaultPrevented&&event.stopped,'Ordinary controls still obey the active pose key trap');
}
const input=exclusive.event('Backspace',{tag:'INPUT'});
exclusive.handler(input);
assert.equal(input.defaultPrevented,false,'Text input Backspace retains native text editing');
assert.equal(input.stopped,false);
const escape=exclusive.event('Escape',{bone:true});
exclusive.handler(escape);
assert.deepEqual(exclusive.calls,['pose.cancel'],'The bone marker exception does not bypass Escape cancellation');
assert.ok(escape.defaultPrevented&&escape.stopped);
const normalTimeline=keyFixture({activePose:false});
const deleteClip=normalTimeline.event('Delete',{tag:'DIV'});
normalTimeline.handler(deleteClip);
assert.deepEqual(normalTimeline.calls,['selection.delete'],'Ordinary timeline deletion keeps its existing dispatch');
assert.ok(deleteClip.defaultPrevented&&deleteClip.stopped);
const save=normalTimeline.event('s',{bone:true,ctrlKey:true});
normalTimeline.handler(save);
assert.deepEqual(normalTimeline.calls,['selection.delete','camera.cancel','save'],'Save shortcuts keep their original precedence');
assert.ok(save.defaultPrevented&&save.stopped);
for(const options of [{modal:true},{disabled:true}]){
  const blocked=keyFixture(options),event=blocked.event('Escape',{bone:true});
  blocked.handler(event);
  assert.deepEqual(blocked.calls,[],'Open dialogs or disabled root still own their input');
  assert.equal(event.defaultPrevented,false);
  assert.equal(event.stopped,false);
}
console.log('Skeletal editor timeline sync passed: draft and saved markers, active keys, transactional editing/cancellation, source timing, workspace callbacks, and production global key capture with Delete/Backspace, dialogs, text inputs, and normal shortcuts.');
