import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {THREE, loadSource, normalize, repositoryRoot, moduleFactoriesFile, motionsDirectory, targetModelFile} from './motion-source-utils.mjs';
import {originalRetargetClasses,validateOriginalRetarget} from './original-retarget-utils.mjs';

const require = createRequire(import.meta.url);
const parser = require('@babel/parser');
const traverse = require('@babel/traverse').default;
const sourceRoot = path.join(repositoryRoot, 'sources/motions');
const output = motionsDirectory;
const sourceRecords = JSON.parse(await fs.readFile(path.join(sourceRoot, 'sources.json'), 'utf8'));
const factories = JSON.parse(await fs.readFile(moduleFactoriesFile, 'utf8'));
let hierarchy;
function literal(node) {
  if (node.type === 'StringLiteral') return node.value;
  if (node.type === 'ObjectExpression') return Object.fromEntries(node.properties.map(p=>[p.key.name || p.key.value,literal(p.value)]));
  if (node.type === 'ArrayExpression') return node.elements.flatMap(p=>p.type==='SpreadElement'?literal(p.argument):[literal(p)]);
  if (node.type === 'CallExpression' && node.callee.name === 'lU') {
    let [parentName,...names] = node.arguments.map(literal);
    return names.map(name => {const item={name,parentName};parentName=name;return item;});
  }
  throw new Error(`Unsupported hierarchy literal ${node.type}`);
}
traverse(parser.parse(`(${factories['53401']})`), {VariableDeclarator(p) {if(p.node.id.name==='lV')hierarchy=literal(p.node.init);}});
if (hierarchy?.length !== 65) throw new Error('Director source did not supply expected 65-joint hierarchy');
const parentIndices = hierarchy.map(def=>hierarchy.findIndex(parent=>parent.name===def.parentName));
const retargetClasses=originalRetargetClasses(factories,hierarchy);

function orderedNodes(scene) {
  const candidates = new Map();
  scene.traverse(node => {const name=normalize(node.name);if(!candidates.has(name))candidates.set(name,[]);candidates.get(name).push(node);});
  for (const root of candidates.get(normalize(hierarchy[0].name)) || []) {
    const nodes = [root];
    for (let index=1;index<hierarchy.length;index++) {
      const node=(candidates.get(normalize(hierarchy[index].name))||[]).find(n=>n.parent===nodes[parentIndices[index]]);
      if(!node)break;
      nodes.push(node);
    }
    if(nodes.length===65)return nodes;
  }
  throw new Error('No complete 65-node hierarchy matches the director skeleton');
}
function makeRig(definitions) {
  const scene=new THREE.Group();
  const bones=definitions.map(def=>{const bone=new THREE.Bone();bone.name=def.name;bone.position.fromArray(def.position);bone.quaternion.fromArray(def.quaternion);bone.scale.fromArray(def.scale);return bone;});
  definitions.forEach((def,index)=>{(def.parentIndex<0?scene:bones[def.parentIndex]).add(bones[index]);});
  scene.bones=bones;
  scene.updateMatrixWorld(true);
  scene.skeleton=new THREE.Skeleton(bones);
  return {scene,bones};
}
function sourceDefinitions(scene,targetSide) {
  scene.updateMatrixWorld(true);
  const nodes=orderedNodes(scene);
  const parentTransform=nodes[0].parent?.matrixWorld || new THREE.Matrix4();
  const translation=new THREE.Vector3(),rotation=new THREE.Quaternion(),scale=new THREE.Vector3();
  parentTransform.decompose(translation,rotation,scale);
  if(Math.max(Math.abs(scale.x-scale.y),Math.abs(scale.x-scale.z))>1e-5 || scale.x<=0)throw new Error('Reference parent has unsupported nonuniform scale');
  rotation.normalize();
  translation.divideScalar(scale.x);
  const side=nodes[hierarchy.findIndex(b=>b.name==='mixamorigLeftUpLeg')].getWorldPosition(new THREE.Vector3()).sub(nodes[hierarchy.findIndex(b=>b.name==='mixamorigRightUpLeg')].getWorldPosition(new THREE.Vector3())).setY(0).normalize();
  if(side.lengthSq()<.99)throw Error('Cannot resolve reference heading from hips');
  const headingAngle=targetSide?Math.atan2(new THREE.Vector3().crossVectors(side,targetSide).y,side.dot(targetSide)):0;
  const heading=new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0,1,0),headingAngle);
  // Original vv compares world-space bind deltas; source and target must share a heading.
  rotation.premultiply(heading).normalize();
  translation.applyQuaternion(heading);
  const definitions=nodes.map((node,index)=>({name:hierarchy[index].name,parentIndex:parentIndices[index],position:(index?node.position.clone():node.position.clone().applyQuaternion(rotation).add(translation)).toArray(),quaternion:(index?node.quaternion.clone():node.quaternion.clone().premultiply(rotation)).normalize().toArray(),scale:node.scale.toArray()}));
  return {nodes,definitions,rotation,translation,parentScale:scale.x,promotedNodes:nodes.filter(n=>!n.isBone).map(n=>n.name),side:side.applyQuaternion(heading),heading,headingAngle};
}
function convertedClip(clip, reference) {
  const names=new Map(reference.nodes.map((node,index)=>[normalize(node.name),hierarchy[index].name]));
  const result=clip.clone();
  for(const track of result.tracks) {
    const split=track.name.lastIndexOf('.');
    const boneName=names.get(normalize(track.name.slice(0,split)));
    const property=track.name.slice(split+1);
    if(!boneName || !['position','quaternion','scale'].includes(property))throw new Error(`Unknown animation target ${track.name}`);
    track.name=`${boneName}.${property}`;
    if(boneName!=='mixamorigHips')continue;
    if(property==='position')for(let i=0;i<track.values.length;i+=3){new THREE.Vector3().fromArray(track.values,i).applyQuaternion(reference.rotation).add(reference.translation).toArray(track.values,i);}
    if(property==='quaternion')for(let i=0;i<track.values.length;i+=4){new THREE.Quaternion().fromArray(track.values,i).premultiply(reference.rotation).normalize().toArray(track.values,i);}
  }
  return result;
}
function preparePartialMixamo(scene, targetDefinitions) {
  const names = new Map(hierarchy.map(def => [normalize(def.name.replace(/^mixamorig/, '')), def.name]));
  const renamed = new Map();
  const originalNodes = [];
  scene.traverse(node => {
    const canonical = names.get(normalize(node.name.replace(/^mixamorig\d*/i, '')));
    if (!canonical) return;
    renamed.set(node.name, canonical);
    node.name = canonical;
    originalNodes.push(node);
  });
  for (const clip of scene.animations) {
    clip.tracks = clip.tracks.filter(track => !/^mixamorig(Left|Right)Eye\./.test(track.name));
    for (const track of clip.tracks) {
      const split = track.name.lastIndexOf('.');
      const canonical = renamed.get(track.name.slice(0, split));
      if (canonical) track.name = canonical + track.name.slice(split);
    }
  }
  const byName = new Map(originalNodes.map(node => [node.name, node]));
  const missing = hierarchy.filter(def => !byName.has(def.name));
  if (missing.some(def => !/^mixamorig(Left|Right)Hand(Middle|Ring|Pinky)[1-4]$/.test(def.name))) {
    throw new Error('Only unanimated middle/ring/pinky reference joints may be supplemented');
  }
  const armIndex = hierarchy.findIndex(def => def.name === 'mixamorigLeftForeArm');
  const referenceScale = byName.get('mixamorigLeftForeArm').position.length() / new THREE.Vector3().fromArray(targetDefinitions[armIndex].position).length();
  for (const def of missing) {
    const template = targetDefinitions[hierarchy.indexOf(def)];
    const bone = new THREE.Bone();
    bone.name = def.name;
    bone.position.fromArray(template.position).multiplyScalar(referenceScale);
    bone.quaternion.fromArray(template.quaternion);
    bone.scale.fromArray(template.scale);
    byName.get(def.parentName).add(bone);
    byName.set(def.name, bone);
  }
  return {originalSourceJointCount: originalNodes.length, staticReferenceJointsAdded: missing.map(def => def.name), addedJointAnimationTracks: 0};
}
function hasDynamicValues(track) {
  const size=track.getValueSize();
  return track.values.some((value,index)=>index>=size&&Math.abs(value-track.values[index%size])>1e-5);
}
function compareRoundtrip(scene,originalClip,reference,serializedClip) {
  const originalMixer=new THREE.AnimationMixer(scene), originalAction=originalMixer.clipAction(originalClip);
  const normalized=makeRig(reference.definitions);
  const imported=THREE.AnimationClip.parse(serializedClip);
  if(!imported.validate())throw new Error('Serialized AnimationClip failed Three validation');
  const newMixer=new THREE.AnimationMixer(normalized.scene),newAction=newMixer.clipAction(imported);
  originalAction.setLoop(THREE.LoopOnce,1);originalAction.clampWhenFinished=true;originalAction.play();
  newAction.setLoop(THREE.LoopOnce,1);newAction.clampWhenFinished=true;newAction.play();
  let maxPositionError=0,maxQuaternionError=0;
  const samples=[0,.17,.43,.79,.99].map(t=>t*originalClip.duration);
  for(const time of samples) {
    originalMixer.setTime(time);newMixer.setTime(time);scene.updateMatrixWorld(true);normalized.scene.updateMatrixWorld(true);
    for(let index=0;index<65;index++) {
      const original=reference.nodes[index],copy=normalized.bones[index];
      maxPositionError=Math.max(maxPositionError,original.getWorldPosition(new THREE.Vector3()).divideScalar(reference.parentScale).applyQuaternion(reference.heading).distanceTo(copy.getWorldPosition(new THREE.Vector3())));
      maxQuaternionError=Math.max(maxQuaternionError,original.getWorldQuaternion(new THREE.Quaternion()).premultiply(reference.heading).normalize().angleTo(copy.getWorldQuaternion(new THREE.Quaternion()).normalize()));
    }
  }
  originalAction.stop();newAction.stop();originalMixer.uncacheRoot(scene);newMixer.uncacheRoot(normalized.scene);
  if(maxPositionError>.01||maxQuaternionError>.0001)throw new Error(`Animation conversion differs from source: position=${maxPositionError}, angle=${maxQuaternionError}`);
  return {sampleTimes:samples,maxPositionErrorCentimeters:maxPositionError,maxQuaternionErrorRadians:maxQuaternionError};
}
export {sourceDefinitions,convertedClip,preparePartialMixamo,compareRoundtrip,retargetClasses,makeRig,hierarchy};

export async function buildLocalMotions() {
await fs.mkdir(output,{recursive:true});
const targetScene=await loadSource(targetModelFile);
const targetReference=sourceDefinitions(targetScene);
const manifest={format:'local-director-motion-catalog',version:2,source:'Public Three.js and 3DCharacter Mixamo example assets; not Jimeng catalog assets',targetSkeletonBones:65,motions:[],pathTraversalVariants:[],rejected:[]};
const labels={Idle:['idle','待机'],Walk:['walk','行走'],Run:['run','跑步']};
const extraLabels={'jump.fbx':['jump','向前跳跃'],'roll.fbx':['roll','向前翻滚'],'dodge-back.fbx':['dodge-back','后撤闪避'],'crouch-down.fbx':['crouch-down','站立下蹲'],'stand-up.fbx':['stand-up','蹲姿起身'],'sneak.fbx':['sneak','俯身潜行'],'strafe-left.fbx':['strafe-left','左侧步'],'strafe-right.fbx':['strafe-right','右侧步'],'falling-idle.fbx':['falling-idle','空中下落']};
for(const filename of ['samba.fbx','mixamo.fbx','soldier.glb','xbot.glb',...Object.keys(extraLabels)]) {
  const source=sourceRecords.find(record=>record.name===filename);
  const originalBytes=await fs.readFile(path.join(sourceRoot,filename));
  if(createHash('sha256').update(originalBytes).digest('hex')!==source.sha256)throw new Error(`Source integrity check failed: ${filename}`);
  const scene=await loadSource(path.join(sourceRoot,filename));
  const adaptation = ['samba.fbx','mixamo.fbx','soldier.glb'].includes(filename) ? {originalSourceJointCount:65,staticReferenceJointsAdded:[],addedJointAnimationTracks:0} : preparePartialMixamo(scene,targetReference.definitions);
  const reference=sourceDefinitions(scene,targetReference.side);
  for(const clip of scene.animations) {
    const dynamicTracks=clip.tracks.filter(hasDynamicValues).length;
    if(clip.duration<=0||!clip.tracks.length||!dynamicTracks){manifest.rejected.push({file:filename,clip:clip.name,reason:'No dynamic animation tracks'});continue;}
    if(filename==='xbot.glb'&&!['agree','headShake'].includes(clip.name)){manifest.rejected.push({file:filename,clip:clip.name,reason:'Existing gait or static pose; not counted as an additional action'});continue;}
    const [id,displayName]=filename==='samba.fbx'?['samba','桑巴舞']:filename==='mixamo.fbx'?['mixamo-example','Mixamo 示例动作']:filename==='xbot.glb'?({agree:['agree','点头同意'],headShake:['head-shake','摇头拒绝']}[clip.name]):extraLabels[filename]||labels[clip.name]||[];
    if(!id)throw new Error(`Unclassified real animation ${filename}:${clip.name}`);
    const normalized=convertedClip(clip,reference);
    const json={format:'local-director-animation-clip',version:1,bones:reference.definitions,clip:THREE.AnimationClip.toJSON(normalized),source:{url:source.url,sha256:source.sha256,filename,clipName:clip.name},conversion:{promotedExistingNodes:reference.promotedNodes,createdBones:adaptation.staticReferenceJointsAdded.length,...adaptation,parentRotationAndHeadingBaked:reference.rotation.toArray(),parentTranslationBaked:reference.translation.toArray(),headingAlignmentRadians:reference.headingAngle,originalParentScale:reference.parentScale,preservedSourceUnits:'centimeters'}};
    const roundtrip=compareRoundtrip(scene,clip,reference,json.clip);
    const retargeted=validateOriginalRetarget(json,targetReference.definitions,retargetClasses);
    const bytes=Buffer.from(JSON.stringify(json));
    const file=`${id}.motion.json`;
    await fs.writeFile(path.join(output,file),bytes);
    const origin=extraLabels[filename]?'3DCharacter Mixamo':'Three.js';
    const entry={assetId:`local-${id}`,displayName,description:`${origin} ${filename} / ${clip.name}`,nameFallback:displayName,descriptionFallback:`Public example: ${filename}`,motionUsage:'direct',mediaUrl:`/assets/motions/${file}`,extension:'.motion.json',durationSec:clip.duration,fps:30,trackCount:clip.tracks.length,dynamicTracks,source:json.source,conversion:json.conversion,validation:{roundtrip,retargeted},bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')};
    manifest.motions.push(entry);
    if(['walk','run'].includes(id)) {
      manifest.pathTraversalVariants.push({...entry,assetId:`local-${id}-path`,sourceAssetId:entry.assetId,displayName:`${displayName}（路径）`,nameFallback:`${displayName}（路径）`,description:`${displayName} / 本地步幅配置`,descriptionFallback:'Shared in-place clip with locally estimated stride calibration',motionUsage:'path-traversal',pathTraversalMetersPerCycle:Math.round(retargeted.pathCycleEstimateMeters/retargeted.legScale*100)/100,pathCalibration:{method:'sum of left/right target foot forward excursions relative to hips, divided by retarget legScale because original x5 applies legScale during path playback',source:'local configuration; not original root motion',targetMeasuredCycleMeters:retargeted.pathCycleEstimateMeters,retargetLegScale:retargeted.legScale,targetModelHeightMeters:1.8}});
    }
    console.log(id,JSON.stringify({duration:clip.duration,dynamicTracks,headingDegrees:reference.headingAngle*180/Math.PI,roundtrip,maxLimbErrorDegrees:retargeted.maxLimbDirectionErrorDegrees,pathCycleEstimateMeters:retargeted.pathCycleEstimateMeters}));
  }
}
await fs.writeFile(path.join(output,'manifest.json'),JSON.stringify(manifest,null,2));
console.log(`Prepared ${manifest.motions.length} real clips. Excluded ${manifest.rejected.length} empty/static clips.`);
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))await buildLocalMotions();
