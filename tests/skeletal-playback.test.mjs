import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import {randomUUID} from 'node:crypto';
import {createRequire} from 'node:module';
import * as THREE from 'three';

const require=createRequire(import.meta.url),bundle={window:{}};
vm.runInNewContext(await fs.readFile(new URL('../web/vendor/modules.js',import.meta.url),'utf8'),bundle);
const source=bundle.window.directorFactories[53401].toString();
const ast=require('@babel/parser').parse('('+source+')'),extract=node=>source.slice(node.start-1,node.end-1);
const context=vm.createContext({crypto:{randomUUID},structuredClone,Map,Set,WeakMap,
  so:{Pq0:THREE.Vector3,PTz:THREE.Quaternion,O9p:THREE.Euler,cj9:THREE.MathUtils,$Kf:THREE.Bone},
  bM:Math.PI/180,bz:180/Math.PI,bT:{x:0,y:0,z:0},ap:'path-traversal',s9:'__director_stage_custom_pose__'});
let scheduler,keyCapture,playButton,playProp,previewSource,exportSource,rowRecord;
require('@babel/traverse').default(ast,{
  FunctionDeclaration(path){vm.runInContext(extract(path.node),context)},
  FunctionExpression(path){const text=extract(path.node);if(/new Map\(i\.map\(e=>\[e\.id,e\]\)\)/.test(text)&&/\ble\(/.test(text)&&(!scheduler||text.length<scheduler.length))scheduler=text},
  ArrowFunctionExpression(path){const text=extract(path.node);if(text.includes('if(!P&&__localBonePlaybackSpace(e))')&&(!keyCapture||text.length<keyCapture.length))keyCapture=text},
  VariableDeclarator(path){
    const id=path.node.id.name,value=path.node.init;
    if(['gq','gQ','gJ'].includes(id)&&value?.type==='StringLiteral')context[id]=value.value;
    if(id==='oZ'&&value?.type==='CallExpression'&&extract(value).includes('sceneCamera:oD.sceneCamera'))previewSource=extract(value);
    if(id==='o$'&&value?.type==='CallExpression'&&extract(value).includes('sceneCamera:oL.sceneCamera'))exportSource=extract(value);
  },
  ObjectProperty(path){
    const text=extract(path.node.value);
    if(path.node.key.name==='onTogglePlayback'&&text.includes('__localBonePlayback.toggle'))playButton=text;
    if(path.node.key.name==='timelinePlayback'&&text.includes('__localBonePlaybackActive'))playProp=text;
    if(path.node.key.name==='onBeginObjectBoneEdit'&&text.includes('__localBonePlayback.toggle'))rowRecord=text;
  },
});
assert.equal(typeof context.__localUseBonePlayback,'function','Build the skeletal playback patch before testing');
assert.ok(scheduler&&keyCapture&&playButton&&playProp&&rowRecord,'Exercise real scheduler, keyboard capture, and viewport wiring');
assert.match(previewSource,/timeline:__localBonePreviewTimeline/);
assert.match(exportSource,/timeline:iX\.timeline/,'Uncommitted editor preview never leaks into the video export evaluator');
vm.runInContext('this.createMotionScheduler='+scheduler,context);
const plain=value=>JSON.parse(JSON.stringify(value));
const pose=angle=>({signature:'playback-fixture',rootTranslation:{x:angle/10,y:0,z:0},rotations:[
  {boneIndex:0,rotation:{x:0,y:0,z:0},bindWorldRotation:{x:0,y:0,z:0,w:1}},
  {boneIndex:1,rotation:{x:angle,y:0,z:0},bindWorldRotation:{x:0,y:0,z:0,w:1}},
]});
const key=(id,timeSec,angle)=>({id,timeSec,pose:pose(angle)});
const saved={id:'saved',objectId:'person',motionId:'motion',source:'builtin',customPose:pose(0),motionName:'Old',
  startTimeSec:3,durationSec:2,offsetTimeSec:1.25,speed:2,loop:false,transitionInFrames:0,
  locomotionMode:'embedded',motionUsage:'direct',boneTiming:{offsetTimeSec:0,speed:1},
  boneKeyframes:[key('old-start',0,0),key('old-end',4,0)]};
const editing={boneAnimation:true,objectId:'person',clipId:'saved',startTimeSec:3,durationSec:2,keyTimeSec:0,
  boneKeys:[key('start',0,0),key('end',2,80)],baselinePose:pose(0),boneDirty:false,
  displayName:'Unsaved animation',jointTransforms:{},lockedJointIds:[]};
const root=new THREE.Bone(),child=new THREE.Bone(),scene=new THREE.Group();
root.position.y=100;child.position.y=30;root.add(child);scene.add(root);
const bones=[root,child],runtime={root:scene,bones,rigSignature:'playback-fixture',
  bindPositions:new Map(bones.map(bone=>[bone,bone.position.clone()])),
  bindScales:new Map(bones.map(bone=>[bone,bone.scale.clone()])),
  bindQuaternions:new Map(bones.map(bone=>[bone,bone.quaternion.clone()])),
  jointIdByBone:new Map(bones.map((bone,index)=>[bone,'person::'+index])),
  editableJointIds:new Set(),legacyJointIds:[],motionPlayers:new Map()};
const renderFrame=frame=>{
  context.x0({},runtime,{jointTransforms:{}},frame.motionPoses.person);
  return context.__localCaptureRuntimePose(runtime);
};
const sampleTimeline=timeline=>{
  const scheduler=context.createMotionScheduler({...timeline,clips:context.__localLinkContinuationClips(timeline.clips,30)},[],{});
  return frame=>({frame,motionPoses:scheduler.sample(frame/30)});
};
const makeHooks=()=>{
  const refs=[],effects=[];let cursor=0,pending=[];
  return{
    begin(){cursor=0;pending=[];context.n={
      useRef:initial=>{const index=cursor++;return refs[index]??(refs[index]={current:initial})},
      useEffect:(callback,deps)=>{const index=cursor++,old=effects[index];
        if(!old||deps.some((value,i)=>!Object.is(value,old.deps[i])))pending.push(()=>{
          old?.cleanup?.();effects[index]={deps,cleanup:callback()};
        });},
    }},
    flush(){for(const effect of pending)effect();pending=[]},
  };
};

function fixture(draft){
  const timeline={displayFps:30,durationSec:12,clips:draft?[]:[structuredClone(saved)]};
  let state={objects:[{id:'person',rigged:true}],selectedObjectIds:['person'],timeline};
  let session=structuredClone(editing),active=false,copied=pose(0),commitCount=0;
  if(draft){session.clipId=undefined;session.draftClip={...structuredClone(saved),id:'draft',boneKeyframes:undefined}}
  const store={getSnapshot:()=>active,setActive:value=>{active=value}},timeRef={current:3};
  const edits=makeHooks(),playback=makeHooks(),notices=[],seeks=[],captures=[];
  let control,play;
  const setSession=value=>{session=typeof value==='function'?value(session):value};
  const controller={current:{copyPose:()=>copied,captureEvaluatedPerformanceFrame:async frame=>{
    captures.push(frame.frame);const result=renderFrame(frame);
    return{skeletalPoses:{person:result},jointTransforms:Object.fromEntries(result.rotations.map((item,index)=>
      ['person::'+index,{rotation:item.rotation,position:index?{x:0,y:0,z:0}:result.rootTranslation}]))};
  }}};
  const seek=value=>{timeRef.current=value;seeks.push(value)};
  const render=()=>{
    const preview=context.__localBonePlaybackTimeline(state.timeline,session);
    edits.begin();
    control=context.__localUseBoneEditing({state,session,setSession,controller,sampleFrame:sampleTimeline(preview),
      seek,stop:()=>store.setActive(false),select:()=>{},commit:update=>{commitCount++;state=update(state)},
      finish:()=>setSession(null),notice:value=>notices.push(value),scope:'playback'});
    edits.flush();playback.begin();
    play=context.__localUseBonePlayback({session,setSession,store,active:active&&!!session?.boneAnimation,
      timeRef,seek,tools:control,controller,fps:30,notice:value=>notices.push(value),scope:'playback'});
    playback.flush();
    return play;
  };
  return{render,store,timeRef,setSession,seeks,notices,captures,
    get state(){return state},get session(){return session},get commits(){return commitCount},get control(){return control},
    copy:angle=>{copied=pose(angle)},
    frame:time=>renderFrame(sampleTimeline(context.__localBonePlaybackTimeline(state.timeline,session))(Math.round(time*30))),
  };
}

for(const draft of [true,false]){
  const item=fixture(draft),original=plain(item.state.timeline);
  item.render().toggle();item.render();
  assert.equal(item.store.getSnapshot(),true,'Draft and existing clip previews can both start');
  for(const [time,angle]of [[3,0],[3.5,12.5],[4,40],[4.5,67.5]]){
    const result=item.frame(time);
    assert.ok(Math.abs(result.rotations[1].rotation.x-angle)<1e-7,'Production scheduler and renderer animate unsaved key at '+time+': '+JSON.stringify(result));
    assert.ok(Math.abs(result.rootTranslation.x-angle/10)<1e-7,'Preview preserves root translation and source timing');
  }
  item.timeRef.current=4;item.render().toggle();item.render();await new Promise(resolve=>setImmediate(resolve));item.render();
  assert.equal(item.session.keyTimeSec,1,'Pause restores the current local editing frame');
  assert.ok(Math.abs(item.session.jointTransforms['person::1'].rotation.x-40)<1e-7,'Paused pose is the actual interpolated pose');
  item.render().toggle();item.render();
  item.timeRef.current=5;item.store.setActive(false);item.render();await new Promise(resolve=>setImmediate(resolve));item.render();
  assert.equal(item.session.keyTimeSec,2,'Automatic endpoint pause reaches the last authored key');
  assert.ok(Math.abs(item.session.jointTransforms['person::1'].rotation.x-80)<1e-7);
  item.render().toggle();item.render();assert.equal(item.timeRef.current,3,'Restart at end returns to the edited clip start');
  item.setSession(null);item.render();
  assert.equal(item.store.getSnapshot(),false,'Cancel stops playback');
  assert.equal(item.commits,0,'Preview, pause, endpoint and cancellation do not save the editor transaction');
  assert.deepEqual(plain(item.state.timeline),original,'Cancelling a preview leaves the persisted timeline untouched');
  assert.deepEqual(item.notices,[]);
}

const dirty=fixture(true);
dirty.setSession({...dirty.session,keyTimeSec:1,boneDirty:true});dirty.copy(65);dirty.render().toggle();dirty.render();
assert.equal(dirty.session.boneKeys.length,3,'Starting preview includes the current unrecorded joint modification');
assert.ok(Math.abs(dirty.frame(4).rotations[1].rotation.x-65)<1e-7);
assert.equal(dirty.commits,0);
const race=fixture(false);race.render().toggle();race.render();race.timeRef.current=3.2;
const requested=race.control.time(1.5);race.render();await requested;await new Promise(resolve=>setImmediate(resolve));race.render();
assert.equal(race.session.keyTimeSec,1.5,'Manual seek takes precedence over automatic pause restoration');
assert.equal(race.timeRef.current,4.5,'A pending manual seek cannot be reset to the previous playhead');
const movedAnchor={...editing,keyTimeSec:1,boneDirty:true,poseContinuation:{anchorKeyId:'anchor'},
  boneKeys:[key('anchor',1,25),key('end',2,80)]};
assert.deepEqual(plain(context.__localBonePlaybackSession(movedAnchor,pose(90),30).boneKeys),plain(movedAnchor.boneKeys),
  'Preview protects the frozen pose even after its key is moved away from zero');

context.rC=editing;context.__localBonePlaybackActive=true;context.ej='performance';context.su={player:true};
assert.equal(vm.runInContext(playProp,context),context.su,'The actual viewport receives its frame player while editing');
context.__localBonePlaybackActive=false;
assert.equal(vm.runInContext(playProp,context),undefined,'Paused editing returns to editable joint transforms');
let buttonToggles=0;context.__localBonePlayback={toggle:()=>buttonToggles++};
vm.runInContext('('+playButton+')',context)();assert.equal(buttonToggles,1,'The timeline play button routes editing playback');
context.__localBonePlaybackActive=true;
let rowKeys=0;context.__localBoneTools={record:()=>rowKeys++};
vm.runInContext('('+rowRecord+')',context)('person');
assert.equal(buttonToggles,2,'An action-row key command first pauses playback');
assert.equal(rowKeys,0,'The row command cannot record a moving pose into its old editing time');
context.__localBonePlaybackActive=false;vm.runInContext('('+rowRecord+')',context)('person');
assert.equal(rowKeys,1,'A later click records after the paused editing frame is restored');
context.i={jsx:(type,props)=>({type,props}),jsxs:(type,props)=>({type,props})};
Object.assign(context,{__localPoseButtonClass:'button',__localBonePreviousIcon:'previous',__localBoneNextIcon:'next',
  __localBoneKeyIcon:'key',__localPoseIcons:{delete:'delete'}});
const editor=context.__LocalBoneEditor({session:{...editing,keyTimeSec:1,boneKeys:[key('a',0,0),key('b',1,40),key('c',2,80)]},
  fps:30,playing:true,onTime:()=>{},onRecord:()=>{},onDelete:()=>{}});
for(const control of editor.props.children.filter(item=>item.type==='button'||item.type==='input')){
  assert.equal(control.props.disabled,true,'Editing controls cannot write at a stale local time while playing');
}

const captureFactory=vm.runInContext('(function(config){const {document,f,t,r,a,i,o,s,l,u,c,p,d,m,g}=config;return '+keyCapture+'})',context);
function keyboard({modal=false,trap=false,tag='BUTTON',bone=false,editor=false,repeat=false}={}){
  const calls=[],target={tagName:tag,isContentEditable:false,matches:()=>false,closest(selector){
    if(selector.includes('[data-bone-key-id]'))return bone||editor&&selector.includes('director-stage-bone-editor')?this:null;
    if(selector==='button'||selector==='button, summary')return tag==='BUTTON'?this:null;
    if(selector===context.gQ)return tag==='DIV'?this:null;return null;
  }};
  const event={key:' ',code:'Space',target,repeat,metaKey:false,ctrlKey:false,altKey:false,shiftKey:false,
    isComposing:false,defaultPrevented:false,preventDefault(){this.defaultPrevented=true},stopPropagation(){this.stopped=true}};
  const handler=captureFactory({document:{querySelector:()=>modal?{}:null},
    f:{cancelCameraGesture:()=>{},cancelTimelineTransient:()=>false,dispatchTimelineCommand:command=>calls.push(command.type)},
    t:{current:{cameraGestureKeyDown:()=>false}},r:'timeline',a:{kind:'none'},i:false,o:30,s:true,l:false,u:'pose',c:false,p:false,d:false,
    m:trap?[{active:true,cancel:()=>{}}]:[]});
  handler(event);return{event,calls};
}
for(const target of [{bone:true},{editor:true},{tag:'DIV'}]){
  const result=keyboard(target);assert.deepEqual(result.calls,['playback.toggle']);assert.ok(result.event.defaultPrevented);
}
assert.deepEqual(keyboard({bone:true,repeat:true}).calls,[],'Held Space does not rapidly alternate playback');
for(const target of [{tag:'INPUT',bone:true},{tag:'TEXTAREA'},{bone:true,modal:true},{bone:true,trap:true},{tag:'BUTTON'}]){
  const result=keyboard(target);assert.deepEqual(result.calls,[],'Inputs, dialogs, other exclusive tools, and command buttons keep native behavior');
  assert.equal(result.event.defaultPrevented,false);
}
console.log('Skeletal playback passed: unsaved draft and saved animation through production scheduler/renderer, roots and timing, pause/end editing restore, dirty poses, cancellation, manual-seek races, relocated anchors, viewport/play-button wiring, and real Space dispatch.');
