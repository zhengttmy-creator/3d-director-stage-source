import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import {randomUUID} from 'node:crypto';
import {createRequire} from 'node:module';
import * as THREE from 'three';

const require = createRequire(import.meta.url);
const parser = require('@babel/parser');
const factories = JSON.parse(await fs.readFile(new URL('../src/vendor/module-factories.json', import.meta.url), 'utf8'));
// Production's portable decoder adds monitor/authoring before canonical validation.
require('../src/patches/empty-cameras.cjs')(factories);
require('../src/patches/camera-transform-model.cjs')(factories);
const source = factories['53401'];
const ast = parser.parse('(' + source + ')');
const xyz = ['x', 'y', 'z'];
const position = xyz.map(axis => 'position.' + axis), target = xyz.map(axis => 'target.' + axis);
const rotation = xyz.map(axis => 'rotation.' + axis);
const context = vm.createContext({crypto: {randomUUID}, Date, structuredClone,
  eH: [...position, ...target, 'lens.fov', 'lens.roll', ...rotation], eB: position, eG: target, e$: [position, target],
  l7: position, l6: target, em: xyz, ep: Math.PI / 180, eg: 180 / Math.PI,
  oL: (value, min, max) => Math.max(min, Math.min(max, value)),
  tC: 'scene-camera', tI: 'shot-camera::', tQ: 'Camera', tq: new Set(['scene-camera']),
  so: {cj9: THREE.MathUtils, Pq0: THREE.Vector3, PTz: THREE.Quaternion, O9p: THREE.Euler, kn4: THREE.Matrix4},
  ss: new THREE.Vector3(0,0,1), sl: new THREE.Vector3(0,1,0), sc: new THREE.Vector3(0,0,-1), sd: new THREE.Vector3(1,0,0),
  su: Math.cos(Math.PI/6), sm: Math.cos(2*Math.PI/9),
});
for (const node of ast.program.body[0].expression.body.body)
  if (node.type === 'FunctionDeclaration') vm.runInContext(source.slice(node.start - 1, node.end - 1), context);
const plain = value => JSON.parse(JSON.stringify(value));
const near = (a,b,tolerance=1e-8) => assert.ok(Math.abs(a-b) <= tolerance, `${a} ~= ${b}`);
const vectorNear = (a,b) => xyz.forEach(axis => near(a[axis], b[axis]));
const angularNear = (a,b,tolerance=1e-6) => assert.ok(a.angleTo(b) < tolerance, `orientation error ${a.angleTo(b)}`);
const base = plain(context.tF());
const native = plain(context.__localCameraWithRotation(base,{x:20,y:40,z:15}));
const moved = context.__localCameraWithPosition(native,{x:6,y:3,z:-1});
assert.deepEqual(plain(moved.rotation), native.rotation);
angularNear(context.sp(native),context.sp(moved));
const turned = context.__localCameraWithRotation(native,{x:120,y:55,z:725});
vectorNear(turned.position,native.position);
assert.equal(turned.rotation.z,725);
angularNear(context.sp(turned), new THREE.Quaternion().setFromEuler(new THREE.Euler(120*Math.PI/180,55*Math.PI/180,725*Math.PI/180,'YXZ')));
const unkeyed = context.eK(native,context.eU(native));
assert.deepEqual(plain(unkeyed.sample(0)),plain(unkeyed.sample(300)));

let authored = context.eJ(native,context.eU(native),0,{'rotation.y':0,'position.x':0});
authored = context.eJ(authored.camera,authored.tracks,60,{'rotation.y':720,'position.x':12});
const sampled = context.eK(authored.camera,authored.tracks);
near(sampled.sample(30).rotation.y,360);
near(sampled.sample(30).position.x,6);
near(sampled.sample(15).rotation.y,180);
assert.equal(sampled.tracks['rotation.y'].length,2);
assert.ok(sampled.vectorGroups.rotation);
near(sampled.vectorGroups.rotation.sample(30).y,360);
const secondId = sampled.tracks['rotation.y'][1].id;
authored = context.eJ(authored.camera,authored.tracks,60,{'rotation.y':1080});
assert.equal(authored.tracks['rotation.y'][1].id,secondId);
const holdTracks = plain(authored.tracks);
holdTracks['rotation.y'][0].interpolation='hold';
near(context.eK(authored.camera,holdTracks).sample(59).rotation.y,0);
near(context.eK(authored.camera,holdTracks).sample(60).rotation.y,1080);
const smoothTracks = plain(authored.tracks);
smoothTracks['rotation.y'][0].interpolation='smooth';
const eased=context.eK(authored.camera,smoothTracks).sample(15).rotation.y;
assert.ok(Number.isFinite(eased)&&eased>0&&eased<1080);

const created=plain(context.re({...native,id:'camera-native',name:'Native camera'}));
assert.deepEqual(created.transform.rotation,native.rotation);
created.tracks=plain(authored.tracks);
const reloaded=plain(context.t4(JSON.parse(JSON.stringify(created))));
assert.deepEqual(reloaded.transform.rotation,native.rotation);
assert.deepEqual(reloaded.tracks['rotation.y'],created.tracks['rotation.y']);
angularNear(context.sp(context.t0(reloaded)),context.sp(native));
const doc={schemaVersion:3,cameras:[reloaded],outputCameraId:reloaded.id};
const committed=context.t1(doc,{cameraId:reloaded.id,sceneCamera:turned,tracks:authored.tracks});
assert.equal(committed.ok,true);
assert.deepEqual(plain(committed.camera.transform.rotation),plain(turned.rotation));
assert.deepEqual(plain(context.tX(JSON.parse(JSON.stringify(committed.document))).document.cameras[0].transform.rotation),plain(turned.rotation));
const singular=context.tZ({kind:'legacy-singular',sceneCamera:native,cameraTracks:authored.tracks});
assert.equal(singular.ok,true);
assert.deepEqual(plain(singular.document.cameras[0].transform.rotation),native.rotation);
const portable=context.ko({id:'workspace-camera',name:'Camera',kind:'performance',createdAt:new Date(0).toISOString(),updatedAt:new Date(0).toISOString(),
  objects:[],selectionGroups:[],environment:context.tP(),sceneCamera:native,timeline:{cameraTracks:authored.tracks}});
assert.equal(portable.ok,true);
assert.deepEqual(plain(portable.workspace.cameras.cameras[0].transform.rotation),native.rotation);
const portableImport=context.ks(plain(portable.workspace),()=>undefined,true);
assert.equal(portableImport.ok,true);
assert.deepEqual(plain(portableImport.workspace.sceneCamera.rotation),native.rotation);
const oldPortable=plain(portable.workspace);
const oldPortableCamera=oldPortable.cameras.cameras[0];
delete oldPortableCamera.transform.rotation;
delete oldPortableCamera.authoring;
delete oldPortableCamera.monitor;
for(const channel of rotation)delete oldPortableCamera.tracks[channel];
const oldDecoded=context.ks(oldPortable,()=>undefined,true);
assert.equal(oldDecoded.ok,true,'Schema-1 portable cameras are allowed to omit authoring/monitor');
assert.ok(oldDecoded.workspace.multiCamera.cameras[0].authoring,'Real decoder supplies canonical authoring');
const oldCanonical=context.tX(oldDecoded.workspace.multiCamera);
assert.equal(oldCanonical.ok,true,'Decoded old schema-1 camera must survive canonical migration');
assert.equal(oldCanonical.document.cameras.length,1);
assert.ok(context.__localIsCameraRotation(oldCanonical.document.cameras[0].transform.rotation));
const legacyRequest=context.eJ(native,context.eU(native),30,{'target.x':10,'lens.roll':25});
assert.equal(legacyRequest.tracks['target.x'].length,0);
assert.equal(legacyRequest.tracks['lens.roll'].length,0);
for(const axis of xyz)assert.equal(legacyRequest.tracks['rotation.'+axis].length,1);
const requestedPose={...native,target:{...native.target,x:10},roll:25};delete requestedPose.rotation;
angularNear(context.__localLegacyCameraQuaternion(requestedPose),context.sp(context.eK(native,legacyRequest.tracks).sample(30)));
const residue=plain(authored.tracks);
residue['target.x']=[{id:'old-target-30',frame:30,value:2,interpolation:'linear',createdAt:new Date(0).toISOString()},
  {id:'old-target-45',frame:45,value:4,interpolation:'linear',createdAt:new Date(0).toISOString()}];
const convertedCommit=context.t1(doc,{cameraId:reloaded.id,sceneCamera:native,tracks:residue});
assert.equal(convertedCommit.ok,true);
assert.equal(convertedCommit.camera.tracks['target.x'].length,0);
for(const frame of [0,60])assert.deepEqual(plain(convertedCommit.camera.tracks['rotation.y'].find(key=>key.frame===frame)),residue['rotation.y'].find(key=>key.frame===frame));
for(const frame of [30,45])assert.ok(convertedCommit.camera.tracks['rotation.y'].some(key=>key.frame===frame));

const old=plain(context.__localLegacyCameraCreate({...base,id:'camera-old',name:'Legacy camera'}));
let oldKeys=context.eJ(base,context.eU(base),0,{'position.x':0,'target.x':0,'lens.roll':-15});
oldKeys=context.eJ(base,oldKeys.tracks,12,{'position.x':6,'target.x':-2,'lens.roll':35});
old.tracks=plain(oldKeys.tracks);
delete old.transform.rotation;
const legacySample=context.__localLegacyCameraSampler(base,old.tracks);
const migrated=context.t4(old);
assert.ok(migrated);
assert.equal(migrated.tracks['target.x'].length,0);
assert.equal(migrated.tracks['lens.roll'].length,0);
assert.ok(migrated.tracks['rotation.x'].length<=13);
const migratedSampler=context.eK(context.t0(migrated),migrated.tracks);
for(let frame=0;frame<=12;frame++){
  const before=legacySample.sample(frame),after=migratedSampler.sample(frame);
  vectorNear(before.position,after.position);
  near(before.fov,after.fov);
  angularNear(context.__localLegacyCameraQuaternion(before),context.sp(after),1e-5);
}
assert.deepEqual(plain(context.t4(JSON.parse(JSON.stringify(migrated)))),plain(migrated),'Reopening must not rebake migrated keys');
const staticOld=plain(context.__localLegacyCameraCreate({...base,roll:65,id:'camera-static',name:'Static'}));
const staticNew=context.t4(staticOld);
angularNear(context.__localLegacyCameraQuaternion({...base,roll:65}),context.sp(context.t0(staticNew)));
assert.equal(staticNew.tracks['rotation.z'].length,0);
const simple=context.__localSimplifyCameraRotationKeys(Array.from({length:901},(_,frame)=>({frame,value:frame*.5,interpolation:'linear'})));
assert.equal(simple.length,2,'Linear legacy rotations simplify to endpoints');
const holdOld=plain(context.__localLegacyCameraCreate({...base,id:'camera-hold',name:'Hold'}));
let holdLegacyKeys=context.eJ(base,context.eU(base),0,{'target.x':0});
holdLegacyKeys=context.eJ(base,holdLegacyKeys.tracks,12,{'target.x':6});
holdLegacyKeys.tracks['target.x'][0].interpolation='hold';
holdOld.tracks=plain(holdLegacyKeys.tracks);
const holdMigrated=context.t4(holdOld),holdMigratedSampler=context.eK(context.t0(holdMigrated),holdMigrated.tracks);
angularNear(context.__localLegacyCameraQuaternion(context.__localLegacyCameraSampler(base,holdLegacyKeys.tracks).sample(11.9)),context.sp(holdMigratedSampler.sample(11.9)),1e-6);
const beforePole={x:95,y:390,z:710};
const continuous=context.__localCameraRotationFromQuaternion(context.__localCameraQuaternion({...native,rotation:beforePole}),{x:94,y:390,z:710});
vectorNear(continuous,beforePole);
if(process.argv[2]){
  const saved=JSON.parse(await fs.readFile(process.argv[2],'utf8'));
  const project=typeof saved.content==='string'?JSON.parse(saved.content):saved.content||saved;
  for(const kind of ['staging','performance'])if(project[kind]){
    const decoded=context.ks(project[kind],()=>({mediaUrl:'asset://migration-validation'}),true);
    assert.equal(decoded.ok,true,`Saved ${kind} portable decode`);
    const canonical=context.tX(decoded.workspace.multiCamera);
    assert.equal(canonical.ok,true,`Saved ${kind} canonical migration`);
    assert.deepEqual(plain(canonical.document.cameras.map(camera=>camera.id)),project[kind].cameras.cameras.map(camera=>camera.id));
    console.log(`Saved ${kind}: retained ${canonical.document.cameras.length} cameras.`);
  }
}
console.log('Camera transform: independent translation/rotation, multi-turn tracks, hold/smooth, persistence and legacy visual migration passed.');
