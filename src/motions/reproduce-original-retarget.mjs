import fs from 'node:fs/promises';
import path from 'node:path';
import vm from 'node:vm';
import {createRequire} from 'node:module';
import {THREE,loadSource,normalize,moduleFactoriesFile,motionsDirectory,targetModelFile,reportsDirectory} from './motion-source-utils.mjs';
const require=createRequire(import.meta.url);
const parser=require('@babel/parser');
const traverse=require('@babel/traverse').default;
const f=JSON.parse(await fs.readFile(moduleFactoriesFile,'utf8'));
const json=JSON.parse(await fs.readFile(path.join(motionsDirectory,'walk.motion.json'),'utf8'));
const hierarchy=json.bones.map(b=>({name:b.name,...b.parentIndex<0?{}:{parentName:json.bones[b.parentIndex].name}}));
const aliases={YJl:THREE.Group,$Kf:THREE.Bone,EAD:THREE.Skeleton,Pq0:THREE.Vector3,PTz:THREE.Quaternion,kn4:THREE.Matrix4,Iw4:THREE.AnimationMixer,tz3:THREE.AnimationClip,RiT:THREE.VectorKeyframeTrack,MBL:THREE.QuaternionKeyframeTrack};
const context=vm.createContext({so:aliases,lV:hierarchy,lq:normalize});
const req=id=>{if(id===13882)return aliases;throw Error(`Unexpected require ${id}`);};
req.d=(exports,getters,values)=>{for(const key of Object.keys(getters||{}))Object.defineProperty(exports,key,{get:getters[key]});Object.assign(exports,values);};
const vf={};
vm.runInContext(`(${f['82873']})`,context)({},vf,req);
context.vf=vf;
const classes={};
traverse(parser.parse(`(${f['53401']})`),{ClassDeclaration(p){if(['vh','vv','vb'].includes(p.node.id.name))classes[p.node.id.name]=f['53401'].slice(p.node.start-1,p.node.end-1);}});
vm.runInContext(`${classes.vh}\n${classes.vv}\n${classes.vb}\nthis.OriginalRetargeter=vv;this.OriginalBindReference=vb;`,context);
const OriginalRetargeter=context.OriginalRetargeter;
function ordered(scene){const byName=new Map();scene.traverse(n=>{const key=normalize(n.name);if(!byName.has(key))byName.set(key,[]);byName.get(key).push(n);});for(const root of byName.get(normalize(hierarchy[0].name))||[]){const chain=[root];for(let i=1;i<hierarchy.length;i++){const parent=chain[hierarchy.findIndex(n=>n.name===hierarchy[i].parentName)];const next=(byName.get(normalize(hierarchy[i].name))||[]).find(n=>n.parent===parent);if(!next)break;chain.push(next);}if(chain.length===65)return chain;}throw Error('Missing canonical hierarchy');}
function sceneFromJson(data){const g=new THREE.Group(),bones=data.bones.map(def=>{const b=new THREE.Bone();b.name=def.name;b.position.fromArray(def.position);b.quaternion.fromArray(def.quaternion);b.scale.fromArray(def.scale);return b;});data.bones.forEach((def,i)=>(def.parentIndex<0?g:bones[def.parentIndex]).add(bones[i]));g.updateMatrixWorld(true);return {scene:g,bones};}
const target=await loadSource(targetModelFile);
const targetBones=ordered(target);
if(process.argv.includes('--align-heading')) {
  const original=sceneFromJson(json);
  const side=bones=>bones.find(b=>b.name==='mixamorigLeftUpLeg').getWorldPosition(new THREE.Vector3()).sub(bones.find(b=>b.name==='mixamorigRightUpLeg').getWorldPosition(new THREE.Vector3())).setY(0).normalize();
  const sourceSide=side(original.bones),targetSide=side(targetBones);
  const angle=Math.atan2(new THREE.Vector3().crossVectors(sourceSide,targetSide).y,sourceSide.dot(targetSide));
  const heading=new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0,1,0),angle);
  new THREE.Vector3().fromArray(json.bones[0].position).applyQuaternion(heading).toArray(json.bones[0].position);
  new THREE.Quaternion().fromArray(json.bones[0].quaternion).premultiply(heading).toArray(json.bones[0].quaternion);
  for(const track of json.clip.tracks){if(track.name==='mixamorigHips.position')for(let i=0;i<track.values.length;i+=3)new THREE.Vector3().fromArray(track.values,i).applyQuaternion(heading).toArray(track.values,i);if(track.name==='mixamorigHips.quaternion')for(let i=0;i<track.values.length;i+=4)new THREE.Quaternion().fromArray(track.values,i).premultiply(heading).toArray(track.values,i);}
  console.log('aligned heading radians',angle);
}
const source=sceneFromJson(json);
const sourceRetargeter=new OriginalRetargeter(source.bones);
const targetRetargeter=new context.OriginalBindReference(targetBones).resolve();
const prepared=targetRetargeter.prepareClip(sourceRetargeter,THREE.AnimationClip.parse(json.clip),targetBones);
const targetMixer=new THREE.AnimationMixer(targetBones[0]),targetAction=targetMixer.clipAction(prepared.clip);targetAction.setLoop(THREE.LoopOnce,1);targetAction.clampWhenFinished=true;targetAction.play();
const srcMixer=new THREE.AnimationMixer(source.scene),srcAction=srcMixer.clipAction(THREE.AnimationClip.parse(json.clip));srcAction.setLoop(THREE.LoopOnce,1);srcAction.clampWhenFinished=true;srcAction.play();
const landmarks=['Hips','Head','LeftArm','LeftForeArm','LeftHand','RightArm','RightForeArm','RightHand','LeftUpLeg','LeftLeg','LeftFoot','RightUpLeg','RightLeg','RightFoot'];
const samples=[];
for(const time of [0,.4,.8]){targetMixer.setTime(time);srcMixer.setTime(time);target.updateMatrixWorld(true);source.scene.updateMatrixWorld(true);const record={time,source:{},target:{}};for(const name of landmarks){const key='mixamorig'+name;record.source[name]=source.bones.find(b=>b.name===key).getWorldPosition(new THREE.Vector3()).toArray();record.target[name]=targetBones.find(b=>b.name===key).getWorldPosition(new THREE.Vector3()).toArray();}samples.push(record);}
await fs.mkdir(reportsDirectory,{recursive:true});
await fs.writeFile(path.join(reportsDirectory,'original-retarget-reproduction.json'),JSON.stringify({legScale:prepared.legScale,samples},null,2));
console.log(JSON.stringify({legScale:prepared.legScale,samples},null,2));
