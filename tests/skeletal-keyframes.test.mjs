import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import {randomUUID} from 'node:crypto';
import {createRequire} from 'node:module';
import * as THREE from 'three';

const require = createRequire(import.meta.url);
const bundleContext = {window:{}};
vm.runInNewContext(await fs.readFile(new URL('../web/vendor/modules.js',import.meta.url),'utf8'),bundleContext);
const source = bundleContext.window.directorFactories['53401'].toString();
const ast = require('@babel/parser').parse('('+source+')');
const extract = node=>source.slice(node.start-1,node.end-1);
let encode, decode;
require('@babel/traverse').default(ast,{ArrowFunctionExpression(path){
  const text=extract(path.node);
  if (text.startsWith('e=>{var t;let r=r1(e,o);if(e.customPose)')) encode=text;
  if (text.startsWith('e=>{var t;if("custom-pose"===e.kind&&e.pose)')) decode=text;
}});
assert.ok(encode&&decode,'Use the real project serializer and deserializer');
const context=vm.createContext({crypto:{randomUUID},Date,structuredClone,Map,Set,Math,
  so:{cj9:THREE.MathUtils,Pq0:THREE.Vector3,PTz:THREE.Quaternion,O9p:THREE.Euler},
  th:'mixamo-fbx-v1',tv:new Set(),ag:{},af:{},am:'direct',pE:{mode:'embedded'},pO:{mode:'in-place',provenance:'authored'},
  s9:'__director_stage_custom_pose__',ap:'path-traversal'});
vm.runInContext('this.structuredClone=value=>JSON.parse(JSON.stringify(value))',context);
for(const node of ast.program.body[0].expression.body.body) if(node.type==='FunctionDeclaration') vm.runInContext(extract(node),context);
vm.runInContext('this.encode=(function(o){return '+encode+'})(30);this.decode=(function(d){return '+decode+'})(30)',context);
const plain=value=>JSON.parse(JSON.stringify(value));
const pose=angle=>({signature:'0:-1|1:0',rootTranslation:{x:angle/45,y:0,z:0},rotations:[
  {boneIndex:0,rotation:{x:0,y:0,z:0},bindWorldRotation:{x:0,y:0,z:0,w:1}},
  {boneIndex:1,rotation:{x:angle,y:0,z:0},bindWorldRotation:{x:0,y:0,z:0,w:1}},
]});
let keys=context.__localUpsertBoneKey([],pose(0),0,30);
keys=context.__localUpsertBoneKey(keys,pose(90),2,30);
const clip={id:'clip',objectId:'person',motionId:'walk',source:'catalog',motionName:'Walk',startTimeSec:3,
  offsetTimeSec:0,durationSec:2,speed:1,loop:true,transitionInFrames:0,createdAt:new Date().toISOString(),
  locomotionMode:'embedded',motionUsage:'direct',boneKeyframes:keys,boneTiming:{offsetTimeSec:0,speed:1}};
let sample=context.le(clip,120,30,new Map(),{});
assert.ok(Math.abs(sample.rotations[1].rotation.x-45)<1e-8,'Timeline 4s samples local 1s, quaternion halfway rotation');
assert.equal(sample.rootTranslation.x,1,'Skeletal root translation interpolates with the pose');
const trimmed={...clip,startTimeSec:4,offsetTimeSec:1,durationSec:1};
assert.ok(Math.abs(context.le(trimmed,120,30,new Map(),{}).rotations[1].rotation.x-45)<1e-8,'Front trim samples the retained source pose');
assert.equal(context.__localBoneDisplayKeys(trimmed)[1].timeSec,1,'Marker moves with the trimmed source');
const faster={...clip,speed:2,durationSec:1};
assert.ok(Math.abs(context.le(faster,105,30,new Map(),{}).rotations[1].rotation.x-45)<1e-8,'Clip speed scales skeletal sampling');
assert.equal(context.__localBoneDisplayKeys(faster)[1].timeSec,1);
sample=context.le({...clip,poseLock:{timeSec:1,pose:pose(22)}},150,30,new Map(),{});
assert.equal(sample.rotations[1].rotation.x,22,'A locked pose overrides animation throughout the clip');
for(const item of [clip,{...clip,poseLock:{timeSec:1,pose:pose(22)}},
  {...clip,customPose:pose(0),motionId:'__director_stage_custom_pose__',source:'builtin',loop:false,locomotionMode:'in-place'}]){
  const encoded=context.encode(item);
  assert.equal(context.kv(encoded),true,'Canonical project clip schema accepts edited bones: '+JSON.stringify(encoded));
  const reloaded=context.decode(JSON.parse(JSON.stringify(encoded)));
  assert.deepEqual(plain(reloaded.boneKeyframes),plain(item.boneKeyframes));
  assert.deepEqual(plain(reloaded.boneTiming),plain(item.boneTiming));
  assert.deepEqual(plain(reloaded.poseLock??null),plain(item.poseLock??null));
  assert.equal(reloaded.motionId,item.motionId,'Original Mixamo/catalog motion reference remains available for unlocking');
  assert.ok(Math.abs(context.le(reloaded,120,30,new Map(),{}).rotations[1].rotation.x-(item.poseLock?22:45))<1e-8);
}
const updated=context.__localUpsertBoneKey(keys,pose(60),2.001,30);
assert.equal(updated.length,2);
assert.equal(updated[1].id,keys[1].id,'Updating a frame preserves its key identity');
assert.equal(updated[1].pose.rotations[1].rotation.x,60);
assert.equal(context.__localNormalizeBonePose({...pose(0),rootTranslation:{x:NaN,y:0,z:0}}),undefined);
assert.equal(context.__localNormalizeBonePose({...pose(0),rotations:[pose(0).rotations[0],pose(0).rotations[0]]}),undefined);
assert.equal(context.__localNormalizeBonePose({...pose(0),rotations:[null]}),undefined);
assert.deepEqual(plain(context.__localBoneClipData({boneKeyframes:[null]})),{});
assert.deepEqual(plain(context.__localBoneClipData({...clip,boneKeyframes:[{id:'bad',timeSec:Infinity,pose:pose(0)}]})),{});
assert.equal(context.__localBoneLocalTime(clip,100),2);
assert.equal(context.__localBoneLocalTime(clip,0),0);
assert.equal(context.__localSampleBoneClip({...clip,boneKeyframes:[]},1),undefined,'Deleting every key returns to the original action');
context.n={useRef:value=>({current:value}),useEffect:()=>{}};
let state={objects:[{id:'person',rigged:true}],timeline:{displayFps:30,durationSec:20,clips:[clip]}};
let session={objectId:'person',clipId:'clip',startTimeSec:3,durationSec:2,keyTimeSec:2,boneAnimation:true,
  boneKeys:keys,displayName:'Walk',boneDirty:false};
const props=()=>({state,session,setSession:value=>{session=value},controller:{current:{copyPose:()=>pose(90)}},
  sampleFrame:()=>{},seek:()=>{},stop:()=>{},select:()=>{},commit:update=>{state=update(state)},finish:()=>{},notice:()=>{},scope:'test'});
context.__localUseBoneEditing(props()).remove();
assert.equal(session.boneKeys.length,1);
context.__localUseBoneEditing(props()).save();
assert.equal(state.timeline.clips[0].boneKeyframes.length,1,'Saving after deleting a key cannot silently restore it');
const savedMotion=context.__localCreateSkeletalMotion({...session,boneKeys:keys,keyTimeSec:2},pose(90),{skeletonId:'mixamo-fbx-v1',skeletonVersion:1});
assert.ok(savedMotion);
assert.equal(savedMotion.keyframes.length,2);
assert.ok(Math.abs(context.s6(savedMotion,1).rotations[1].rotation.x-45)<1e-8,'Local motion library export retains animated skeleton keys');
console.log('Skeletal animation: production quaternion sampling, root motion, frame replacement, freeze/unfreeze, canonical project round trip, and invalid data passed.');

const expressions=[];
require('@babel/traverse').default(ast,{FunctionExpression(path){expressions.push(extract(path.node))}});
const scheduler=expressions.filter(code=>/new Map\(i\.map\(e=>\[e\.id,e\]\)\)/.test(code)&&/\ble\(/.test(code)).sort((a,b)=>a.length-b.length)[0];
assert.ok(scheduler);
vm.runInContext('this.createMotionScheduler='+scheduler,context);
const schedule=clips=>context.createMotionScheduler({displayFps:30,clips:context.__localLinkContinuationClips(clips,30)},[],{});
const input=structuredClone(clip);
const cut=context.__localCutToPose([input],input.id,4,pose(45),30);
assert.equal(cut.clips.length,2);
assert.equal(cut.clips[0].durationSec,1,'Only source tail is trimmed');
assert.equal(input.durationSec,2,'Original asset and source object are not mutated');
assert.equal(cut.clip.startTimeSec,4);
assert.equal(cut.clip.boneKeyframes.length,1,'The frozen pose creates exactly one skeletal key');
assert.equal(cut.clip.boneKeyframes[0].timeSec,0);
assert.equal(cut.clip.transitionInFrames,0,'Cut pose is exact at its first frame');
for(const time of [3,3.2,3.5,3.9666667]){
  assert.deepEqual(plain(schedule(cut.clips).sample(time)),plain(schedule([input]).sample(time)),'Every earlier pose is unchanged at '+time);
}
for(const time of [4,4.5,5,10,29.9]){
  assert.deepEqual(plain(schedule(cut.clips).sample(time).person.sample.rotations),plain(pose(45).rotations),'Frozen pose held through empty timeline at '+time);
  assert.equal(schedule(cut.clips).sample(time).person.sample.rootTranslation.x,1);
}
const firstFrame=context.__localCutToPose([input],input.id,3,pose(0),30);
assert.equal(firstFrame.clips.length,1,'Cut at clip start replaces the action without zero-duration prefix');
const secondFrame=context.__localCutToPose([input],input.id,3+1/30,pose(2),30);
assert.equal(secondFrame.clips[0].durationSec,1/30);
// The normalizer is an arrow callback, so extract it separately from the production bundle.
let normalizeClip;
require('@babel/traverse').default(ast,{ArrowFunctionExpression(path){const text=extract(path.node);if(text.startsWith('e=>{var t;if(!iY(e)')&&text.includes('__localBoneClipData(e)'))normalizeClip=text}});
assert.ok(normalizeClip);
context.c=new Set(['person']);context.__localClipFps=30;
vm.runInContext('this.normalizeClip='+normalizeClip,context);
assert.equal(context.normalizeClip(secondFrame.clips[0])[0].durationSec,1/30,'One frame survives stage normalization');
assert.equal(context.normalizeClip(input)[0].durationSec,2,'Uncut clip duration survives stage normalization');
assert.throws(()=>context.__localCutToPose([input],input.id,2,pose(0),30));
assert.throws(()=>context.__localCutToPose([input],input.id,5,pose(0),30));
const boundary={...input,startTimeSec:29,durationSec:1};
const atLimit=context.__localCutToPose([boundary],boundary.id,29+29/30,pose(10),30);
assert.ok(Math.abs(atLimit.clip.startTimeSec+atLimit.clip.durationSec-30)<1e-8);
for(const item of [cut.clip,...secondFrame.clips]){
  const encoded=context.encode(item);
  assert.equal(context.kv(encoded),true);
  const restored=context.decode(plain(encoded));
  assert.deepEqual(plain(context.__localBoneClipData(restored)),plain(context.__localBoneClipData(item)),'Continuation metadata survives project round trip');
}
const next={...input,id:'next',startTimeSec:6,durationSec:2};
const chain=[...cut.clips,next];
const linked=context.__localLinkContinuationClips(chain,30).at(-1);
assert.equal(linked.poseContinuationAnchor.rotations[1].rotation.x,45);
assert.equal(linked.transitionInFrames,8);
const blending=schedule(chain).sample(6).person;
assert.equal(blending.kind,'blend','Next action blends from the held pose even across a gap');
assert.equal(blending.from.rotations[1].rotation.x,45);
assert.equal(blending.progress,0);
assert.equal(blending.to.__localPoseContinuation.anchor.rootTranslation.x,1);
const editedHold={...cut.clip,boneKeyframes:context.__localUpsertBoneKey(cut.clip.boneKeyframes,pose(65),1,30)};
const trimmedHold={...editedHold,startTimeSec:4.5,offsetTimeSec:0.5,durationSec:0.5};
const encodedHold=context.encode(trimmedHold);
assert.equal(context.kv(encodedHold),true);
const restoredHold=context.decode(plain(encodedHold));
assert.equal(restoredHold.offsetTimeSec,0.5,'Custom skeletal clip source offset survives save');
assert.deepEqual(plain(context.le(restoredHold,135,30,new Map(),{})),plain(context.le(trimmedHold,135,30,new Map(),{})),
  'A front-trimmed skeletal clip reloads at the same evaluated pose');
assert.equal(context.__localLinkContinuationClips([cut.clips[0],editedHold,next],30).at(-1).poseContinuationAnchor.rotations[1].rotation.x,65,
  'Editing the last continuation key refreshes the following action alignment');
assert.equal(schedule([cut.clips[0],editedHold,next]).sample(6).person.from.rotations[1].rotation.x,65,'Transition samples exact endpoint key, not preceding frame');
const intervening={...input,id:'intervening',startTimeSec:5,durationSec:1};
assert.equal(context.__localLinkContinuationClips([...cut.clips,intervening,next],30).at(-1).poseContinuationAnchor,undefined,
  'An intervening animation stops old continuation anchors from leaking');
const incoming={...input,transitionInFrames:8};
const before={...input,id:'before',startTimeSec:2,durationSec:1};
const early=context.__localCutToPose([before,incoming],incoming.id,3.1,pose(30),30);
for(const time of [3,3+1/30,3+2/30])assert.deepEqual(plain(schedule(early.clips).sample(time)),plain(schedule([before,incoming]).sample(time)),
  'Cut inside an incoming blend preserves all earlier blending frames');
state={objects:[{id:'person',rigged:true}],timeline:{displayFps:30,durationSec:20,clips:cut.clips}};
session={...session,clipId:cut.clip.id,startTimeSec:4,durationSec:1,keyTimeSec:0,boneKeys:cut.clip.boneKeyframes,poseContinuation:cut.clip.poseContinuation};
context.__localUseBoneEditing(props()).remove();
assert.equal(session.boneKeys.length,1,'Editor deletion protects cut anchor');
context.__localUseBoneEditing(props()).deleteKey(cut.clip.id,cut.clip.poseContinuation.anchorKeyId);
assert.equal(state.timeline.clips.at(-1).boneKeyframes.length,1,'Timeline deletion protects cut anchor');
context.__localUseBoneEditing(props()).settings(cut.clip.id,{durationSec:2,transitionSec:0.5});
assert.equal(state.timeline.clips.at(-1).durationSec,2);
assert.equal(state.timeline.clips.at(-1).poseContinuation.transitionFrames,15);
context.__localUseBoneEditing(props()).settings(cut.clip.id,{durationSec:40});
assert.equal(state.timeline.clips.at(-1).durationSec,2,'Invalid duration does not modify state');
console.log('Pose continuation: exact cuts, preserved history, one-frame boundaries, hold, gap blends, final pose alignment, serialization, protected anchor and independent durations passed.');
const editProps=()=>({...props(),sampleFrame:frame=>({frame,motionPoses:schedule(state.timeline.clips).sample(frame/30)}),
  controller:{current:{copyPose:()=>pose(65),captureEvaluatedPerformanceFrame:async frame=>({
    skeletalPoses:{person:frame.motionPoses.person.sample},jointTransforms:{'person::head':{rotation:{x:0,y:65,z:0}}}})}}});
state={objects:[{id:'person',rigged:true}],selectedObjectIds:['person'],timeline:{displayFps:30,durationSec:20,clips:[editedHold]}};
session=null;
await context.__localUseBoneEditing(editProps()).begin('person',editedHold.id,5);
assert.equal(session.keyTimeSec,1,'Clicking the endpoint key edits that exact frame');
assert.equal(session.boneKeys.length,2);
state={...state,timeline:{...state.timeline,clips:[trimmedHold]}};
session=null;
await context.__localUseBoneEditing(editProps()).begin('person',trimmedHold.id,4.5);
assert.equal(session.boneKeys[0].timeSec,0,'Legacy front trim rebuilds a valid start anchor');
assert.equal(session.poseContinuation.anchorKeyId,session.boneKeys[0].id);
assert.equal(context.__localUseBoneEditing(editProps()).save(),true);
assert.ok(context.__localBoneClipData(state.timeline.clips[0]).poseContinuation,'Editing a previously trimmed continuation preserves holding and alignment');
assert.deepEqual(plain(context.le(state.timeline.clips[0],150,30,new Map(),{})),plain(context.le(trimmedHold,150,30,new Map(),{})));
console.log('Bone editor endpoint selection and legacy trimmed continuation save passed.');
