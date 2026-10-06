import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {THREE,loadSource,normalize,moduleFactoriesFile,motionsDirectory,targetModelFile,reportsDirectory} from './motion-source-utils.mjs';
import {originalRetargetClasses,validateOriginalRetarget} from './original-retarget-utils.mjs';

const output=motionsDirectory;
const factories=JSON.parse(await fs.readFile(moduleFactoriesFile,'utf8'));
const walk=JSON.parse(await fs.readFile(path.join(output,'walk.motion.json'),'utf8'));
const hierarchy=walk.bones.map(b=>({name:b.name,...b.parentIndex<0?{}:{parentName:walk.bones[b.parentIndex].name}}));
const classes=originalRetargetClasses(factories,hierarchy);
const target=await loadSource(targetModelFile);
target.updateMatrixWorld(true);
const byName=new Map();
let boneNodeCount=0;
target.traverse(node=>{if(!node.isBone)return;boneNodeCount++;const key=normalize(node.name);if(!byName.has(key))byName.set(key,[]);byName.get(key).push(node);});
let bones;
for(const root of byName.get(normalize(hierarchy[0].name))||[]) {
  const candidate=[root];
  for(let i=1;i<hierarchy.length;i++) {
    const node=(byName.get(normalize(hierarchy[i].name))||[]).find(node=>node.parent===candidate[walk.bones[i].parentIndex]);
    if(!node)break;
    candidate.push(node);
  }
  if(candidate.length===65){bones=candidate;break;}
}
assert.equal(bones?.length,65);
const skinBindings=[];
target.traverse(node=>{if(!node.isSkinnedMesh)return;const outside=node.skeleton.bones.filter(b=>!bones.includes(b));const equivalents=outside.map(bone=>{const match=bones.find(b=>normalize(b.name)===normalize(bone.name));assert.ok(match,'Weighted bones must have canonical name mappings');return {name:bone.name,worldPositionError:bone.getWorldPosition(new THREE.Vector3()).distanceTo(match.getWorldPosition(new THREE.Vector3())),worldRotationError:bone.getWorldQuaternion(new THREE.Quaternion()).angleTo(match.getWorldQuaternion(new THREE.Quaternion()))};});skinBindings.push({name:node.name,visible:node.visible,parent:node.parent.name,vertices:node.geometry.getAttribute('position').count,boneCount:node.skeleton.bones.length,bonesOutsideCanonicalHierarchy:outside.map(b=>b.name),maxDuplicatePositionError:Math.max(0,...equivalents.map(v=>v.worldPositionError)),maxDuplicateRotationError:Math.max(0,...equivalents.map(v=>v.worldRotationError))});});
const definitions=bones.map((bone,index)=>({name:hierarchy[index].name,parentIndex:walk.bones[index].parentIndex,position:bone.position.toArray(),quaternion:bone.quaternion.toArray(),scale:bone.scale.toArray()}));
const validation=[];
const manifest=JSON.parse(await fs.readFile(path.join(output,'manifest.json'),'utf8'));
for(const entry of manifest.motions) {
  const id=entry.assetId;
  const json=JSON.parse(await fs.readFile(path.join(output,path.basename(entry.mediaUrl)),'utf8'));
  validation.push({id,...validateOriginalRetarget(json,definitions,classes)});
}
// Undo only the canonical heading correction to prove the old regression is detected.
const broken=structuredClone(walk),inverse=new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0,1,0),-walk.conversion.headingAlignmentRadians);
new THREE.Vector3().fromArray(broken.bones[0].position).applyQuaternion(inverse).toArray(broken.bones[0].position);
new THREE.Quaternion().fromArray(broken.bones[0].quaternion).premultiply(inverse).toArray(broken.bones[0].quaternion);
for(const track of broken.clip.tracks) {
  if(track.name==='mixamorigHips.position')for(let i=0;i<track.values.length;i+=3)new THREE.Vector3().fromArray(track.values,i).applyQuaternion(inverse).toArray(track.values,i);
  if(track.name==='mixamorigHips.quaternion')for(let i=0;i<track.values.length;i+=4)new THREE.Quaternion().fromArray(track.values,i).premultiply(inverse).toArray(track.values,i);
}
let regressionError;
try{validateOriginalRetarget(broken,definitions,classes);}catch(error){regressionError=error.message;}
assert.match(regressionError||'',/Incorrect retargeted/,'The arms-above-head regression must fail world-pose validation');
const report={boneNodeCount,uniqueBoneNames:byName.size,canonicalBones:bones.length,skinBindings,oldHeadingRegressionRejected:regressionError,validation};
await fs.mkdir(reportsDirectory,{recursive:true});
await fs.writeFile(path.join(reportsDirectory,'original-retarget-validation.json'),JSON.stringify(report,null,2));
console.log(JSON.stringify({...report,validation:validation.map(({landmarks,...result})=>result)},null,2));
