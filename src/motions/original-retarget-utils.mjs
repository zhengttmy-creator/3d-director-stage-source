import vm from 'node:vm';
import {createRequire} from 'node:module';
import {THREE,normalize} from './motion-source-utils.mjs';

const require=createRequire(import.meta.url);
const parser=require('@babel/parser');
const traverse=require('@babel/traverse').default;

export function originalRetargetClasses(factories,hierarchy) {
  const aliases={YJl:THREE.Group,$Kf:THREE.Bone,EAD:THREE.Skeleton,Pq0:THREE.Vector3,PTz:THREE.Quaternion,kn4:THREE.Matrix4,Iw4:THREE.AnimationMixer,tz3:THREE.AnimationClip,RiT:THREE.VectorKeyframeTrack,MBL:THREE.QuaternionKeyframeTrack};
  const context=vm.createContext({so:aliases,lV:hierarchy,lq:normalize});
  const request=id=>{if(id===13882)return aliases;throw Error(`Unexpected retarget dependency ${id}`);};
  request.d=(exports,getters,values)=>{for(const key of Object.keys(getters||{}))Object.defineProperty(exports,key,{get:getters[key]});Object.assign(exports,values);};
  const vf={};
  vm.runInContext(`(${factories['82873']})`,context)({},vf,request);
  context.vf=vf;
  const classes={};
  traverse(parser.parse(`(${factories['53401']})`),{ClassDeclaration(p){if(['vh','vv','vb'].includes(p.node.id.name))classes[p.node.id.name]=factories['53401'].slice(p.node.start-1,p.node.end-1);}});
  for(const name of ['vh','vv','vb'])if(!classes[name])throw Error(`Original retarget class ${name} is missing`);
  vm.runInContext(`${classes.vh}\n${classes.vv}\n${classes.vb}\nthis.Retargeter=vv;this.BindReference=vb;`,context);
  return {Retargeter:context.Retargeter,BindReference:context.BindReference};
}

export function makeMotionRig(definitions) {
  const scene=new THREE.Group();
  const bones=definitions.map(def=>{const bone=new THREE.Bone();bone.name=def.name;bone.position.fromArray(def.position);bone.quaternion.fromArray(def.quaternion);bone.scale.fromArray(def.scale);return bone;});
  definitions.forEach((def,index)=>(def.parentIndex<0?scene:bones[def.parentIndex]).add(bones[index]));
  scene.updateMatrixWorld(true);
  return {scene,bones};
}

export function validateOriginalRetarget(json,targetDefinitions,classes,{allowStatic=false}={}) {
  const source=makeMotionRig(json.bones),target=makeMotionRig(targetDefinitions);
  const prepared=new classes.BindReference(target.bones).resolve().prepareClip(new classes.Retargeter(source.bones),THREE.AnimationClip.parse(json.clip),target.bones);
  const targetMixer=new THREE.AnimationMixer(target.bones[0]),sourceMixer=new THREE.AnimationMixer(source.scene);
  const targetAction=targetMixer.clipAction(prepared.clip),sourceAction=sourceMixer.clipAction(THREE.AnimationClip.parse(json.clip));
  const byName=bones=>new Map(bones.map(b=>[b.name.slice('mixamorig'.length),b]));
  const sourceNames=byName(source.bones),targetNames=byName(target.bones);
  const position=(names,name)=>names.get(name).getWorldPosition(new THREE.Vector3());
  const segments=[['LeftArm','LeftForeArm'],['LeftForeArm','LeftHand'],['RightArm','RightForeArm'],['RightForeArm','RightHand'],['LeftUpLeg','LeftLeg'],['LeftLeg','LeftFoot'],['RightUpLeg','RightLeg'],['RightLeg','RightFoot'],['Spine','Spine2'],['Neck','Head'],['Head','HeadTop_End']];
  const direction=(names,segment)=>position(names,segment[1]).sub(position(names,segment[0])).normalize();
  const bindAngles=segments.map(segment=>direction(sourceNames,segment).angleTo(direction(targetNames,segment)));
  const sampleTimes=[...new Set([0,.4,.8,...Array.from({length:61},(_,i)=>json.clip.duration*i/61)].filter(time=>time<json.clip.duration))].sort((a,b)=>a-b);
  for(const action of [sourceAction,targetAction]){action.setLoop(THREE.LoopOnce,1);action.clampWhenFinished=true;action.play();}
  let maxSegmentAngle=0,maxLimbAngle=0,maxReferenceDeviation=0,maxMovement=0;
  const segmentErrors=Object.fromEntries(segments.map(segment=>[segment.join('->'),0]));
  let firstPositions;
  const landmarks=[];
  const footRanges={LeftFoot:[],RightFoot:[]};
  for(const time of sampleTimes) {
    sourceMixer.setTime(time);targetMixer.setTime(time);source.scene.updateMatrixWorld(true);target.scene.updateMatrixWorld(true);
    const positions=target.bones.map(b=>b.getWorldPosition(new THREE.Vector3()));
    if(positions.some(v=>!v.toArray().every(Number.isFinite))||target.bones.some(b=>![...b.quaternion].every(Number.isFinite)))throw Error('Original retargeter produced a non-finite pose');
    if(firstPositions)for(let i=0;i<65;i++)maxMovement=Math.max(maxMovement,firstPositions[i].distanceTo(positions[i]));
    else firstPositions=positions;
    for(let i=0;i<segments.length;i++) {
      const angle=direction(sourceNames,segments[i]).angleTo(direction(targetNames,segments[i]));
      maxSegmentAngle=Math.max(maxSegmentAngle,angle);
      if(i<8)maxLimbAngle=Math.max(maxLimbAngle,angle);
      segmentErrors[segments[i].join('->')]=Math.max(segmentErrors[segments[i].join('->')],angle*180/Math.PI);
      maxReferenceDeviation=Math.max(maxReferenceDeviation,angle-bindAngles[i]);
      if(angle>15*Math.PI/180)throw Error(`Incorrect retargeted ${segments[i].join('->')} at ${time}s: ${angle*180/Math.PI} degrees from source`);
    }
    if([0,.4,.8].includes(time)) {
      const names=['Hips','Head','LeftArm','LeftHand','RightArm','RightHand','LeftUpLeg','LeftLeg','LeftFoot','RightUpLeg','RightLeg','RightFoot'];
      landmarks.push({time,source:Object.fromEntries(names.map(name=>[name,position(sourceNames,name).toArray()])),target:Object.fromEntries(names.map(name=>[name,position(targetNames,name).toArray()]))});
    }
    for(const name of Object.keys(footRanges)) {
      const foot=position(targetNames,name),hips=position(targetNames,'Hips');
      footRanges[name].push(foot.z-hips.z);
    }
  }
  sourceAction.stop();targetAction.stop();sourceMixer.uncacheRoot(source.scene);targetMixer.uncacheRoot(target.bones[0]);
  if(maxMovement<.01&&!allowStatic)throw Error('Original retargeter produces no movement');
  const footExcursion=Object.fromEntries(Object.entries(footRanges).map(([name,values])=>[name,Math.max(...values)-Math.min(...values)]));
  // A full gait cycle has two steps. The in-place foot sweep estimates each step's travel.
  const cycleEstimateMeters=(footExcursion.LeftFoot+footExcursion.RightFoot)/100;
  return {engine:'Original director vv.prepareClip + bundled vf.NM',samples:sampleTimes.length,legScale:prepared.legScale,maxJointMovementCentimeters:maxMovement,maxLimbDirectionErrorDegrees:maxLimbAngle*180/Math.PI,maxBodyDirectionErrorDegrees:maxSegmentAngle*180/Math.PI,segmentDirectionErrorsDegrees:segmentErrors,maxErrorAboveBindDifferenceDegrees:maxReferenceDeviation*180/Math.PI,finite:true,landmarks,footExcursionCentimeters:footExcursion,pathCycleEstimateMeters:cycleEstimateMeters};
}
