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
const context=vm.createContext({crypto:{randomUUID},structuredClone,Map,Set,WeakMap,
  so:{Pq0:THREE.Vector3,PTz:THREE.Quaternion,O9p:THREE.Euler,cj9:THREE.MathUtils,$Kf:THREE.Bone},
  bM:Math.PI/180,bz:180/Math.PI,bT:{x:0,y:0,z:0},ap:'path-traversal'});
require('@babel/traverse').default(require('@babel/parser').parse('('+source+')'),{
  FunctionDeclaration(path){vm.runInContext(source.slice(path.node.start-1,path.node.end-1),context)},
});
const plain=value=>JSON.parse(JSON.stringify(value));
const closePose=(actual,expected,label)=>{
  const a=new THREE.Vector3(actual.rootTranslation.x,actual.rootTranslation.y,actual.rootTranslation.z);
  const b=new THREE.Vector3(expected.rootTranslation.x,expected.rootTranslation.y,expected.rootTranslation.z);
  assert.ok(a.distanceTo(b)<1e-7,label+': '+a.toArray()+' != '+b.toArray());
  for(let index=0;index<actual.rotations.length;index++){
    const quaternion=rotation=>new THREE.Quaternion().setFromEuler(new THREE.Euler(
      rotation.x*Math.PI/180,rotation.y*Math.PI/180,rotation.z*Math.PI/180,'XYZ'));
    assert.ok(quaternion(actual.rotations[index].rotation).angleTo(quaternion(expected.rotations[index].rotation))<1e-6,
      label+': bone '+index+' rotation');
  }
};

function fixture({withAnchor=true,offset=0,omitZero=false}={}){
  const root=new THREE.Bone(),child=new THREE.Bone(),scene=new THREE.Group();
  root.position.y=100;child.position.y=30;root.add(child);scene.add(root);
  const bones=[root,child];
  const runtime={root:scene,bones,rigSignature:'editing-fixture',
    bindPositions:new Map(bones.map(bone=>[bone,bone.position.clone()])),
    bindScales:new Map(bones.map(bone=>[bone,bone.scale.clone()])),
    bindQuaternions:new Map(bones.map(bone=>[bone,bone.quaternion.clone()])),
    jointIdByBone:new Map(bones.map((bone,index)=>[bone,'person::'+index])),
    editableJointIds:new Set(),legacyJointIds:[],motionPlayers:new Map()};
  const pose=(x,z=0,yaw=0,childAngle=0)=>({signature:runtime.rigSignature,rootTranslation:{x,y:0,z},
    rotations:bones.map((bone,index)=>({boneIndex:index,rotation:{x:index?childAngle:0,y:index?0:yaw,z:0},
      bindWorldRotation:{x:0,y:0,z:0,w:1}}))});
  const anchor=pose(30,50,90);
  const hold={id:'hold',objectId:'person',startTimeSec:0,durationSec:1,customPose:anchor,
    boneKeyframes:[{id:'anchor',timeSec:0,pose:anchor}],poseContinuation:{anchorKeyId:'anchor',transitionFrames:0}};
  const incoming={id:'next',objectId:'person',motionName:'Authored action',startTimeSec:1,durationSec:2-offset,
    offsetTimeSec:offset,speed:1,customPose:pose(0),
    boneKeyframes:(omitZero?[1,2]:[0,1,2]).map(timeSec=>({id:'key-'+timeSec,timeSec,pose:pose(timeSec*2,0,0,timeSec*10)})),
    boneTiming:{offsetTimeSec:0,speed:1},locomotionMode:'in-place',motionUsage:'direct'};
  let state={objects:[{id:'person',rigged:true}],selectedObjectIds:['person'],
    timeline:{displayFps:30,durationSec:10,clips:withAnchor?[hold,incoming]:[incoming]}};
  let session=null,displayPose,gate,nextCapture=0,sessionWrites=0;
  const notices=[],refs=[];
  const sampleFrame=frame=>{
    const linked=context.__localLinkContinuationClips(state.timeline.clips,30).find(clip=>clip.id==='next');
    return{frame,motionPoses:{person:{kind:'single',sample:context.le(linked,frame,30,new Map(),{})}}};
  };
  const evaluate=frame=>{
    context.x0({},runtime,{jointTransforms:{}},frame.motionPoses.person);
    return context.__localCaptureRuntimePose(runtime);
  };
  const setSession=value=>{
    session=value;sessionWrites++;
    displayPose={signature:runtime.rigSignature,rootTranslation:{...value.jointTransforms['person::0'].position},
      rotations:context.l0(bones,runtime.bindQuaternions).map((bind,index)=>({boneIndex:index,
        rotation:{...value.jointTransforms['person::'+index].rotation},
        bindWorldRotation:{x:bind.x,y:bind.y,z:bind.z,w:bind.w}}))};
  };
  const controller={current:{
    captureEvaluatedPerformanceFrame:async frame=>{
      const wait=gate;gate=undefined;if(wait)await wait;
      nextCapture++;
      const pose=evaluate(frame);
      return{skeletalPoses:{person:pose},jointTransforms:Object.fromEntries(pose.rotations.map((item,index)=>
        ['person::'+index,{rotation:item.rotation,position:index?{x:0,y:0,z:0}:pose.rootTranslation}]))};
    },copyPose:()=>displayPose,
  }};
  const render=()=>{
    let cursor=0;
    context.n={useRef:initial=>refs[cursor++]??(refs[cursor-1]={current:initial}),useEffect:()=>{}};
    return context.__localUseBoneEditing({state,session,setSession,controller,sampleFrame,seek:()=>{},stop:()=>{},
      select:()=>{},commit:update=>{state=update(state)},finish:()=>{},notice:value=>notices.push(value),scope:'fixture'});
  };
  return{
    render,evaluateAt:time=>evaluate(sampleFrame(Math.round(time*30))),
    get state(){return state},get session(){return session},get displayed(){return displayPose},
    get sessionWrites(){return sessionWrites},get captures(){return nextCapture},notices,
    alterChild:angle=>{displayPose={...displayPose,rotations:displayPose.rotations.map((item,index)=>
      index?{...item,rotation:{...item.rotation,x:angle}}:item)}},
    blockNextCapture:promise=>{gate=promise},
    changePriorAnchor:()=>{state={...state,timeline:{...state.timeline,clips:state.timeline.clips.map(clip=>
      clip.id==='hold'?{...clip,durationSec:0.5}:clip)}}},
  };
}

const edited=fixture();
const originalKeys=plain(edited.state.timeline.clips[1].boneKeyframes);
const before=edited.evaluateAt(1.5);
assert.deepEqual(plain(before.rootTranslation),{x:30,y:0,z:49});
await edited.render().begin('person','next',1.5);
closePose(edited.displayed,before,'Opening an aligned action preserves its pose');
assert.deepEqual(plain(edited.session.boneKeys.map(key=>({id:key.id,timeSec:key.timeSec}))),
  originalKeys.map(key=>({id:key.id,timeSec:key.timeSec})),'Baking preserves key identities and local times');
assert.deepEqual(plain(edited.state.timeline.clips[1].boneKeyframes),originalKeys,'Opening cannot mutate the source clip');
edited.render().record();
assert.equal(edited.render().save(),true);
closePose(edited.evaluateAt(1.5),before,'Recording an unchanged aligned pose must not apply alignment twice');
assert.equal(edited.state.timeline.clips[1].boneKeyframes.length,4);

const seeked=fixture();
const seekExpected=seeked.evaluateAt(1.75),endExpected=seeked.evaluateAt(3);
await seeked.render().begin('person','next',1.5);
await seeked.render().time(0.75);
closePose(seeked.displayed,seekExpected,'Editor scrubbing keeps baked root coordinates');
await seeked.render().time(2);
closePose(seeked.displayed,endExpected,'Editor can seek the actual endpoint without losing alignment');
const endpoint=fixture();
const endpointExpected=endpoint.evaluateAt(3);
await endpoint.render().begin('person','next',3);
assert.equal(endpoint.session.keyTimeSec,2);
closePose(endpoint.displayed,endpointExpected,'Opening the endpoint marker preserves aligned pose');

const changed=fixture();
const changedBefore=changed.evaluateAt(1.5);
await changed.render().begin('person','next',1.5);
changed.alterChild(63);
changed.render().record();
assert.equal(changed.render().save(),true);
const changedAfter=changed.evaluateAt(1.5);
assert.ok(Math.abs(changedAfter.rotations[1].rotation.x-63)<1e-7,'An actual joint edit survives playback');
assert.deepEqual(plain(changedAfter.rootTranslation),plain(changedBefore.rootTranslation),'Joint editing cannot displace the aligned root');

for(const options of [{omitZero:true},{offset:0.5}]){
  const item=fixture(options),expected=item.evaluateAt(1.75);
  const retained=context.__localBoneDisplayKeys(item.state.timeline.clips[1]).filter(key=>key.timeSec>=0);
  await item.render().begin('person','next',1.75);
  assert.equal(item.session.boneKeys[0].timeSec,0,'A trimmed or missing start key gets a captured baseline');
  for(const key of retained)assert.ok(item.session.boneKeys.some(value=>value.id===key.id&&value.timeSec===key.timeSec));
  item.render().record();assert.equal(item.render().save(),true);
  closePose(item.evaluateAt(1.75),expected,'Trimmed source reference remains stable after editing');
}

const standalone=fixture({withAnchor:false});
const standaloneKeys=plain(standalone.state.timeline.clips[0].boneKeyframes),standalonePose=standalone.evaluateAt(1.5);
await standalone.render().begin('person','next',1.5);
assert.deepEqual(plain(standalone.session.boneKeys),standaloneKeys,'Unlinked animation does not get rebaked');
standalone.render().record();assert.equal(standalone.render().save(),true);
closePose(standalone.evaluateAt(1.5),standalonePose,'Unlinked editing retains its previous behavior');

const cancelled=fixture();
let release;
cancelled.blockNextCapture(new Promise(resolve=>{release=resolve}));
const pending=cancelled.render().begin('person','next',1.5);
cancelled.changePriorAnchor();cancelled.render();release();await pending;
assert.equal(cancelled.session,null,'An anchor change during async capture cancels the stale session');
assert.equal(cancelled.sessionWrites,0,'A cancelled bake cannot overwrite a newer editor session');
assert.equal(cancelled.captures,1,'Baking stops as soon as its timeline becomes stale');
console.log('Pose continuation editing passed: real renderer/capture and editing hooks, unchanged and edited poses, key identity preservation, trimmed baselines, endpoint and scrub alignment, standalone editing, and stale capture cancellation.');
