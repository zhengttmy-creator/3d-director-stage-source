import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import {createRequire} from 'node:module';
import * as THREE from 'three';
import {originalRetargetClasses, makeMotionRig} from '../src/motions/original-retarget-utils.mjs';

const require = createRequire(import.meta.url);
const original = JSON.parse(await fs.readFile(new URL('../src/vendor/module-factories.json', import.meta.url), 'utf8'));
const built = {window:{}};
vm.runInNewContext(await fs.readFile(new URL('../web/vendor/modules.js', import.meta.url), 'utf8'), built);
const factories = {'53401':built.window.directorFactories['53401'].toString()};
if (!factories['53401'].includes('function __localApplyUnalignedMotion(')) {
  require('../src/patches/pose-continuation-alignment.cjs')(factories);
}
const source = factories['53401'];
new vm.Script('(' + source + ')');
const ast = require('@babel/parser').parse('(' + source + ')');
const declarations = new Map();
require('@babel/traverse').default(ast, {FunctionDeclaration(path) {
  declarations.set(path.node.id.name, source.slice(path.node.start - 1, path.node.end - 1));
}});
const context = vm.createContext({so:{Pq0:THREE.Vector3, PTz:THREE.Quaternion, O9p:THREE.Euler,
  cj9:THREE.MathUtils, Iw4:THREE.AnimationMixer, $Kf:THREE.Bone},
  ap:'path-traversal', bM:Math.PI/180, bz:180/Math.PI, bT:{x:0,y:0,z:0}, Map, Set, WeakMap});
for (const declaration of declarations.values()) vm.runInContext(declaration, context);
const closeVector = (actual, expected, name, tolerance = 1e-5) => {
  assert.ok(actual.distanceTo(expected) < tolerance, name + ': ' + actual.toArray() + ' != ' + expected.toArray());
};
const closeRotation = (actual, expected, name, tolerance = 1e-5) => {
  assert.ok(actual.angleTo(expected) < tolerance, name + ': rotation error ' + actual.angleTo(expected));
};
const fixtureRuntime = (scene, bones, signature) => ({root:scene,bones,rigSignature:signature,
  bindPositions:new Map(bones.map(bone=>[bone,bone.position.clone()])),
  bindScales:new Map(bones.map(bone=>[bone,bone.scale.clone()])),
  bindQuaternions:new Map(bones.map(bone=>[bone,bone.quaternion.clone()])),
  jointIdByBone:new Map(bones.map((bone,index)=>[bone,'actor::'+index])),
  editableJointIds:new Set(),legacyJointIds:[],motionPlayers:new Map()});
const inspectRaw = (runtime, sample) => {
  context.x2(runtime);
  assert.equal(context.__localApplyUnalignedMotion({},runtime,{jointTransforms:{}},sample),true);
  return {position:runtime.bones[0].position.clone(), rotation:runtime.bones[0].quaternion.clone()};
};
const makePose = (runtime, rootTranslation, rotation = 90) => ({signature:runtime.rigSignature,rootTranslation,
  rotations:context.l0(runtime.bones,runtime.bindQuaternions).map((bind,index)=>({boneIndex:index,
    rotation:{x:index ? 25 : 0,y:index ? 0 : rotation,z:0},bindWorldRotation:{x:bind.x,y:bind.y,z:bind.z,w:bind.w}}))});
const scene = new THREE.Group();
const root = new THREE.Bone(), child = new THREE.Bone();
root.position.set(0,100,0);child.position.set(0,30,0);scene.add(root);root.add(child);
const runtime = fixtureRuntime(scene,[root,child],'continuation-test');
const pose = angle=>makePose(runtime,{x:0,y:0,z:0},angle);
const motion = {id:'walk-native',durationSec:2,loop:true,locomotion:{mode:'embedded'},
  keyframes:[0,1,2].map(timeSec=>({timeSec,pose:pose(20+20*timeSec),
    rootTranslation:{x:8+2*timeSec,y:2*timeSec,z:-3+timeSec}}))};
const anchor = makePose(runtime,{x:30,y:5,z:50},90);
const baseClip = {id:'next',objectId:'actor',motionId:motion.id,source:'imported',startTimeSec:3,
  offsetTimeSec:0.5,durationSec:5,speed:2,loop:true,locomotionMode:'embedded',motionUsage:'direct',
  transitionInFrames:8,poseContinuationAnchor:anchor};
const motions = new Map([[motion.id,motion]]);
const sample = (clip,time)=>context.le(clip,time*30,30,motions,{});
const sourceStart = inspectRaw(runtime,context.__localSampleUnalignedClip(baseClip,90,30,motions,{}));
const anchorState = inspectRaw(runtime,anchor);
const yaw = anchorState.rotation.clone().multiply(sourceStart.rotation.clone().invert());
let laterPosition;
for (const time of [3,3.25,3.75,4.5,6.25,3.75,3]) {
  const raw = inspectRaw(runtime,context.__localSampleUnalignedClip(baseClip,time*30,30,motions,{}));
  assert.equal(context.x5({},runtime,{jointTransforms:{}},sample(baseClip,time)),true);
  closeVector(root.position,raw.position.clone().sub(sourceStart.position).applyQuaternion(yaw).add(anchorState.position),
    'Native continuation offset, speed, loop and seek at '+time);
  closeRotation(root.quaternion,raw.rotation.clone().premultiply(yaw),'Native continuation heading at '+time);
  if (time===3.75) {
    if(laterPosition)closeVector(root.position,laterPosition,'Repeated seek does not accumulate alignment');
    laterPosition=root.position.clone();
  }
}
closeVector(root.position,anchorState.position,'Source start exactly meets captured root position');
closeRotation(root.quaternion,anchorState.rotation,'Source start meets captured heading');

const trimmed = {...baseClip,offsetTimeSec:1.5};
context.x5({},runtime,{jointTransforms:{}},sample(trimmed,3));
closeVector(root.position,anchorState.position,'Front trim recalibrates the incoming source reference');
closeRotation(root.quaternion,anchorState.rotation,'Front trim recalibrates incoming heading');
const path = {...baseClip,motionUsage:'path-traversal'};
assert.equal(sample(path,3).__localPoseContinuation,undefined,'Path traversal cannot receive duplicate alignment');
const invalidRig = {...baseClip,poseContinuationAnchor:{...anchor,signature:'other-rig'}};
const unmatched = sample(invalidRig,3.5);
const unaligned = inspectRaw(runtime,unmatched);
context.x5({},runtime,{jointTransforms:{}},unmatched);
closeVector(root.position,unaligned.position,'Mismatched skeleton leaves motion evaluation untouched');

// Production blend renderer must interpolate between already aligned samples.
for(const progress of [0,0.25,0.5,1]) {
  const incoming=sample(baseClip,3.2);
  context.x5({},runtime,{jointTransforms:{}},incoming);
  const incomingPosition=root.position.clone(), incomingRotation=root.quaternion.clone();
  context.x0({},runtime,{jointTransforms:{}},{kind:'blend',from:anchor,to:incoming,progress});
  closeVector(root.position,anchorState.position.clone().lerp(incomingPosition,progress),'Renderer root blend '+progress);
  closeRotation(root.quaternion,anchorState.rotation.clone().slerp(incomingRotation,progress),'Renderer quaternion blend '+progress);
}

// Exercise the asset branch with the actual original retargeter and real Mixamo walk.
const walk = JSON.parse(await fs.readFile(new URL('../web/assets/motions/walk.motion.json',import.meta.url),'utf8'));
const hierarchy=walk.bones.map(bone=>({name:bone.name,...(bone.parentIndex<0?{}:{parentName:walk.bones[bone.parentIndex].name})}));
const classes=originalRetargetClasses(original,hierarchy);
const sourceRig=makeMotionRig(walk.bones);
const targetRig=makeMotionRig(walk.bones.map(bone=>({...bone,position:bone.position.map(value=>value*1.4)})));
const assetRuntime=fixtureRuntime(targetRig.scene,targetRig.bones,'mixamo-continuation');
const prepared=new classes.BindReference(targetRig.bones).resolve().prepareClip(new classes.Retargeter(sourceRig.bones),THREE.AnimationClip.parse(walk.clip),targetRig.bones);
const assetPath='/assets/motions/walk.motion.json';
const player={clip:prepared.clip,legScale:prepared.legScale,mixer:new THREE.AnimationMixer(targetRig.scene)};
player.action=player.mixer.clipAction(player.clip);
assetRuntime.motionPlayers.set(assetPath,player);
const asset={id:'walk-asset',assetPath,durationSec:walk.clip.duration};
const options={catalogMotions:new Map([[asset.id,asset]])};
const assetAnchor=makePose(assetRuntime,{x:250,y:5,z:-150},73);
const assetClip={...baseClip,source:'catalog',motionId:asset.id,offsetTimeSec:0.2,speed:1.5,
  poseContinuationAnchor:assetAnchor};
const assetSample=time=>context.le(assetClip,time*30,30,new Map(),options);
const assetStart=inspectRaw(assetRuntime,context.__localSampleUnalignedClip(assetClip,90,30,new Map(),options));
const assetTarget=inspectRaw(assetRuntime,assetAnchor);
const difference=assetTarget.rotation.clone().multiply(assetStart.rotation.clone().invert()).normalize();
const assetYaw=new THREE.Quaternion(0,difference.y,0,difference.w).normalize();
for(const time of [3,3.2,3.8,5,6.5,3.2,3]) {
  const raw=inspectRaw(assetRuntime,context.__localSampleUnalignedClip(assetClip,time*30,30,new Map(),options));
  assert.equal(context.x5({},assetRuntime,{jointTransforms:{}},assetSample(time)),true);
  closeVector(targetRig.bones[0].position,raw.position.clone().sub(assetStart.position).applyQuaternion(assetYaw).add(assetTarget.position),
    'Real retargeted FBX branch preserves offset and root-motion cycles at '+time,1e-4);
  closeRotation(targetRig.bones[0].quaternion,raw.rotation.clone().premultiply(assetYaw),'Real retargeted FBX heading at '+time);
}
closeVector(targetRig.bones[0].position,assetTarget.position,'Retargeted animation begins at captured location');

// Missing asset preparation must not cache bind-pose references as successful alignment.
const pendingClip={...assetClip,id:'pending'};
const pendingSample=context.le(pendingClip,90,30,new Map(),options);
assetRuntime.motionPlayers.delete(assetPath);
assetRuntime.pendingMotionPaths=new Map([[assetPath,Promise.resolve()]]);
assert.equal(context.x5({},assetRuntime,{jointTransforms:{}},pendingSample),false);
assert.equal(assetRuntime.localPoseContinuationCache.has(pendingClip),false,'Unprepared asset is not cached');
assetRuntime.motionPlayers.set(assetPath,player);
assert.equal(context.x5({},assetRuntime,{jointTransforms:{}},pendingSample),true);
closeVector(targetRig.bones[0].position,assetTarget.position,'Asset completion recalibrates the actual retargeted reference');
assert.equal(assetRuntime.localPoseContinuationCache.has(pendingClip),true);
console.log('Pose continuation alignment passed: production clip sampler and blend renderer, native keys, real 65-bone Mixamo retargeting, translation, yaw, source trims, speed, loops, deterministic seeks, path exclusions, and delayed asset preparation.');
