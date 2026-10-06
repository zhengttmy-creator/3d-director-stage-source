import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
import {THREE,loadSource,repositoryRoot,motionsDirectory,targetModelFile} from './motion-source-utils.mjs';
import {sourceDefinitions,convertedClip,preparePartialMixamo,compareRoundtrip,retargetClasses,makeRig} from './build-local-motions.mjs';
import {validateOriginalRetarget} from './original-retarget-utils.mjs';

const output=path.join(repositoryRoot,'web/assets/poses');
const sourceRoot=path.join(repositoryRoot,'sources/motions/poses');
const sources=JSON.parse(await fs.readFile(path.join(sourceRoot,'sources.json'),'utf8'));
const sharedSources=JSON.parse(await fs.readFile(path.join(sourceRoot,'../sources.json'),'utf8'));
const target=sourceDefinitions(await loadSource(targetModelFile));
const presets=[
  {id:'standing',displayName:'自然站立',file:'xbot.glb',sharedSource:true,clipName:'idle',time:.4,category:'站立'},
  {id:'crouching',displayName:'下蹲',motion:'crouch-down',time:1.2,category:'蹲姿'},
  {id:'sneaking',displayName:'俯身警戒',motion:'sneak',time:.35,category:'站立'},
  {id:'sitting',displayName:'坐地屈膝',file:'sitting-idle.fbx',time:1,category:'坐姿'},
  {id:'sitting-closed',displayName:'交腿坐姿',file:'female-sitting.fbx',time:0,category:'坐姿'},
  {id:'sitting-relaxed',displayName:'架腿坐姿',file:'male-sitting.fbx',time:0,category:'坐姿'},
  {id:'kneeling',displayName:'双膝跪姿',file:'kneeling-idle.fbx',time:1,category:'跪姿'},
  {id:'kneeling-pointing',displayName:'单膝跪姿指向',file:'kneeling-pointing.fbx',time:1.3,category:'跪姿'},
  {id:'chair-sitting',displayName:'椅子坐姿',file:'sitting-down.fbx',time:.5,category:'坐姿'},
  {id:'sitting-clap',displayName:'坐姿鼓掌',file:'sitting-clap.fbx',time:1.1,category:'坐姿'},
];
const manifest={format:'local-director-pose-catalog',version:1,targetSkeletonBones:65,poses:[]};
await fs.mkdir(output,{recursive:true});

for(const preset of presets) {
  let converted,source,conversion,roundtrip;
  if(preset.motion) {
    converted=JSON.parse(await fs.readFile(path.join(motionsDirectory,`${preset.motion}.motion.json`),'utf8'));
    source={...converted.source,normalizedMotion:preset.motion};
    conversion=converted.conversion;
    roundtrip={reuseValidatedNormalizedMotion:true};
  } else {
    const directory=preset.sharedSource?path.dirname(sourceRoot):sourceRoot;
    const record=(preset.sharedSource?sharedSources:sources).find(entry=>entry.name===preset.file);
    const bytes=await fs.readFile(path.join(directory,preset.file));
    assert.equal(createHash('sha256').update(bytes).digest('hex'),record.sha256,`Source hash mismatch: ${preset.file}`);
    const scene=await loadSource(path.join(directory,preset.file));
    const adaptation=preparePartialMixamo(scene,target.definitions);
    const reference=sourceDefinitions(scene,target.side);
    const clip=preset.clipName?scene.animations.find(clip=>clip.name===preset.clipName):scene.animations[0];
    const serialized=THREE.AnimationClip.toJSON(convertedClip(clip,reference));
    roundtrip=compareRoundtrip(scene,clip,reference,serialized);
    source={url:record.url,sha256:record.sha256,filename:preset.file,clipName:clip.name,repository:record.repository,commit:record.commit};
    conversion={...adaptation,headingAlignmentRadians:reference.headingAngle,preservedSourceUnits:'centimeters'};
    converted={bones:reference.definitions,clip:serialized};
  }
  const rig=makeRig(converted.bones);
  const clip=THREE.AnimationClip.parse(converted.clip);
  const mixer=new THREE.AnimationMixer(rig.scene);
  const action=mixer.clipAction(clip);
  action.setLoop(THREE.LoopOnce,1);action.clampWhenFinished=true;action.play();
  const sampleTime=Math.min(preset.time,clip.duration);
  mixer.setTime(sampleTime);
  const xzOffset=[rig.bones[0].position.x,0,rig.bones[0].position.z];
  rig.bones[0].position.x=0;rig.bones[0].position.z=0;
  const tracks=rig.bones.flatMap(bone=>[
    new THREE.VectorKeyframeTrack(`${bone.name}.position`,[0,1],[...bone.position,...bone.position]),
    new THREE.QuaternionKeyframeTrack(`${bone.name}.quaternion`,[0,1],[...bone.quaternion,...bone.quaternion]),
    new THREE.VectorKeyframeTrack(`${bone.name}.scale`,[0,1],[...bone.scale,...bone.scale]),
  ]);
  const poseClip=new THREE.AnimationClip(preset.id,1,tracks);
  assert(poseClip.validate());
  const json={format:'local-director-animation-clip',version:1,bones:converted.bones,clip:THREE.AnimationClip.toJSON(poseClip),source:{...source,sampleTimeSec:sampleTime,sourceDurationSec:clip.duration},conversion:{...conversion,staticFrame:true,horizontalCenteringOffsetCentimeters:xzOffset,generatedAnimation:false}};
  const validation=validateOriginalRetarget(json,target.definitions,retargetClasses,{allowStatic:true});
  assert(validation.maxJointMovementCentimeters<1e-7,`${preset.id} must remain still`);
  const positions=validation.landmarks[0].target;
  const vector=name=>new THREE.Vector3().fromArray(positions[name]);
  const kneeAngle=side=>vector(side+'UpLeg').sub(vector(side+'Leg')).angleTo(vector(side+'Foot').sub(vector(side+'Leg')))*180/Math.PI;
  const poseGeometry={hipsHeightCentimeters:positions.Hips[1],leftKneeAngleDegrees:kneeAngle('Left'),rightKneeAngleDegrees:kneeAngle('Right'),leftKneeHeightCentimeters:positions.LeftLeg[1],rightKneeHeightCentimeters:positions.RightLeg[1],leftFootHeightCentimeters:positions.LeftFoot[1],rightFootHeightCentimeters:positions.RightFoot[1]};
  if(preset.id==='standing')assert(poseGeometry.hipsHeightCentimeters>90&&Math.min(poseGeometry.leftKneeAngleDegrees,poseGeometry.rightKneeAngleDegrees)>165,'Standing must have extended legs');
  if(preset.id==='crouching')assert(poseGeometry.hipsHeightCentimeters<60&&Math.max(poseGeometry.leftKneeAngleDegrees,poseGeometry.rightKneeAngleDegrees)<70,'Crouching must have lowered hips and bent knees');
  if(preset.id==='sitting')assert(poseGeometry.hipsHeightCentimeters<30,'Ground sitting must remain close to the floor');
  if(preset.id==='chair-sitting')assert(poseGeometry.hipsHeightCentimeters>45&&poseGeometry.hipsHeightCentimeters<75&&Math.min(poseGeometry.leftKneeHeightCentimeters,poseGeometry.rightKneeHeightCentimeters)>40&&Math.max(poseGeometry.leftFootHeightCentimeters,poseGeometry.rightFootHeightCentimeters)<25,'Chair sitting must have elevated thighs and feet below the knees');
  if(preset.id==='kneeling')assert(Math.max(poseGeometry.leftKneeHeightCentimeters,poseGeometry.rightKneeHeightCentimeters)<20,'Both kneeling knees must be close to the floor');
  if(preset.id==='kneeling-pointing')assert(Math.min(poseGeometry.leftKneeHeightCentimeters,poseGeometry.rightKneeHeightCentimeters)<20&&Math.max(poseGeometry.leftKneeHeightCentimeters,poseGeometry.rightKneeHeightCentimeters)>30,'Single-knee pose must have one raised knee');
  const bytes=Buffer.from(JSON.stringify(json));
  const filename=`${preset.id}.motion.json`;
  await fs.writeFile(path.join(output,filename),bytes);
  manifest.poses.push({assetId:`local-pose-${preset.id}`,displayName:preset.displayName,nameFallback:preset.displayName,description:`${preset.displayName} / Mixamo 源姿态`,descriptionFallback:preset.displayName,category:preset.category,localPosePreset:true,motionUsage:'direct',mediaUrl:`/assets/poses/${filename}`,extension:'.motion.json',durationSec:1,fps:30,trackCount:tracks.length,dynamicTracks:0,source:json.source,conversion:json.conversion,validation:{roundtrip,retargeted:validation,poseGeometry},bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')});
  action.stop();mixer.uncacheRoot(rig.scene);
  console.log(preset.id,JSON.stringify(poseGeometry));
}
await fs.writeFile(path.join(output,'manifest.json'),JSON.stringify(manifest,null,2)+'\n');
console.log(`Prepared ${manifest.poses.length} static source poses; motion catalog unchanged.`);
