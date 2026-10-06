import fs from 'node:fs/promises';
import path from 'node:path';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {THREE,loadSource,repositoryRoot,targetModelFile,reportsDirectory} from './motion-source-utils.mjs';
import {sourceDefinitions,retargetClasses} from './build-local-motions.mjs';
import {validateOriginalRetarget} from './original-retarget-utils.mjs';

const require=createRequire(import.meta.url);
const {helperSource}=require('../patches/motion-loader.cjs');
const root=path.join(repositoryRoot,'web');
const manifest=JSON.parse(await fs.readFile(path.join(root,'assets/poses/manifest.json'),'utf8'));
assert.equal(manifest.format,'local-director-pose-catalog');
assert.equal(manifest.poses.length,10);
assert.equal(new Set(manifest.poses.map(entry=>entry.assetId)).size,manifest.poses.length);
const target=sourceDefinitions(await loadSource(targetModelFile));
const hierarchy=target.definitions.map(def=>({name:def.name,...def.parentIndex<0?{}:{parentName:target.definitions[def.parentIndex].name}}));
let fetches=0;
const context=vm.createContext({URL,window:{location:{href:'http://127.0.0.1:4202/',origin:'http://127.0.0.1:4202'}},fetch:async url=>{fetches++;return {ok:true,status:200,json:async()=>JSON.parse(await fs.readFile(path.join(root,new URL(url).pathname),'utf8'))};},so:{YJl:THREE.Group,$Kf:THREE.Bone,tz3:THREE.AnimationClip},lV:hierarchy,pD:{w:class{loadAsync(){throw Error('Static poses must load locally');}}}});
vm.runInContext(helperSource,context);
const load=vm.runInContext('__localDirectorLoadMotion',context);
const results=[];
for(const entry of manifest.poses) {
  assert.equal(entry.localPosePreset,true);
  assert.equal(entry.motionUsage,'direct');
  const bytes=await fs.readFile(path.join(root,entry.mediaUrl));
  assert.equal(createHash('sha256').update(bytes).digest('hex'),entry.sha256);
  const json=JSON.parse(bytes);
  assert.equal(json.bones.length,65);
  const loaded=await load(entry.mediaUrl);
  const again=await load(entry.mediaUrl);
  assert.notEqual(loaded,again);
  const clip=loaded.animations[0];
  assert(clip.validate());
  assert.equal(clip.duration,1);
  assert.equal(clip.tracks.length,65*3);
  for(const track of clip.tracks) {
    const size=track.getValueSize();
    assert.deepEqual([...track.times],[0,1]);
    assert.deepEqual([...track.values.slice(0,size)],[...track.values.slice(size)],`${entry.assetId}: ${track.name} changes over time`);
  }
  const result=validateOriginalRetarget(json,target.definitions,retargetClasses,{allowStatic:true});
  assert(result.maxJointMovementCentimeters<1e-7);
  results.push({assetId:entry.assetId,displayName:entry.displayName,maxMovement:result.maxJointMovementCentimeters,maxDirectionErrorAboveBind:result.maxErrorAboveBindDifferenceDegrees});
}
assert.equal(fetches,manifest.poses.length);
await assert.rejects(load('https://example.com/pose.motion.json'),/same-origin/);
await fs.mkdir(reportsDirectory,{recursive:true});
const report={status:'passed',poses:manifest.poses.length,exactStaticTracks:true,bonesPerPose:65,localCachedLoader:true,originalRetargeter:true,results};
await fs.writeFile(path.join(reportsDirectory,'pose-presets-validation.json'),JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify(report,null,2));
