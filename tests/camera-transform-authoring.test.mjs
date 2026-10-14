import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import {randomUUID} from 'node:crypto';
import {createRequire} from 'node:module';
import * as THREE from 'three';
const require=createRequire(import.meta.url);
const factories=JSON.parse(await fs.readFile(new URL('../src/vendor/module-factories.json',import.meta.url),'utf8'));
factories['53401']=require('../src/patches/motion-loader.cjs').patchMotionLoader(factories['53401']);
for(const name of ['patch-local-motion-library','motion-previews','pose-library','folder-models','root-motion','transform-autokey',
  'camera-position-autokey','camera-navigation-sync','manual-timeline-keyframes','manual-camera-authoring','camera-transform-model','camera-transform-authoring'])
  require('../src/patches/'+name+'.cjs')(factories);
const source=factories['53401'],ast=require('@babel/parser').parse('('+source+')');
new vm.Script('('+source+')');
const extract=node=>source.slice(node.start-1,node.end-1),callbacks={};let gizmo,propertySource;
require('@babel/traverse').default(ast,{
  VariableDeclarator(path){if(['cx','sQ'].includes(path.node.id.name)&&path.node.init?.type==='CallExpression'&&extract(path.node.init).startsWith('(0,n.useCallback)'))callbacks[path.node.id.name]=extract(path.node.init);},
  FunctionExpression(path){const text=extract(path.node);if(text.includes('e.sceneCameraDrag')&&text.includes('t.onSceneCameraChange(n,{changedPart:i})')&&text.length<1500)gizmo=text;},
  ObjectProperty(path){if(path.node.key.name==='onToggleCameraKeyframe'&&path.node.value.type==='ConditionalExpression')propertySource=extract(path.node.value);}
});
assert.ok(gizmo,'Extract the real viewport transform commit');
const axes=['x','y','z'],positions=axes.map(a=>'position.'+a),targets=axes.map(a=>'target.'+a),rotations=axes.map(a=>'rotation.'+a);
const channels=[...positions,...targets,'lens.fov','lens.roll',...rotations];
const context=vm.createContext({crypto:{randomUUID},Date,structuredClone,n:{useCallback:fn=>fn},eH:channels,eB:positions,eG:targets,e$:[positions,targets],
  l7:positions,l6:targets,em:axes,ep:Math.PI/180,eg:180/Math.PI,tC:'scene-camera',tI:'shot-camera::',tQ:'Camera',tq:new Set(['scene-camera']),
  so:{cj9:THREE.MathUtils,Pq0:THREE.Vector3,PTz:THREE.Quaternion,O9p:THREE.Euler,kn4:THREE.Matrix4},ss:new THREE.Vector3(0,0,1),
  sl:new THREE.Vector3(0,1,0),sc:new THREE.Vector3(0,0,-1),sd:new THREE.Vector3(1,0,0),su:Math.cos(Math.PI/6),sm:Math.cos(2*Math.PI/9)});
for(const node of ast.program.body[0].expression.body.body)if(node.type==='FunctionDeclaration')vm.runInContext(extract(node),context);
const make=vm.runInContext(`b=>{const{R,iH,a_,a$,C,rC,il,tZ,iT,Q,ej,od,ek,iK,e$,__localManualCameraId,__localManualCameraDraft}=b;const sQ=${callbacks.sQ};const cx=${callbacks.cx};return{commit:cx,persist:sQ}}`,context);
const plain=value=>JSON.parse(JSON.stringify(value));
const native=plain(context.__localCameraWithRotation(context.tF(),{x:12,y:25,z:7}));
const A=plain(context.re({...native,id:'camera-A',name:'A'})),B=plain(context.re({...native,id:'camera-B',name:'B'}));
let state={objects:[],sceneCamera:native,timeline:{displayFps:30,durationSec:20,cameraTracks:plain(context.eU(native)),clips:[],objectTracks:{}},multiCamera:{schemaVersion:3,cameras:[A,B],outputCameraId:A.id}};
let frame=30,pending=null;const id=B.id;
const camera=()=>state.multiCamera.cameras.find(c=>c.id===id);
const sample=at=>plain(context.eK(context.t0(camera()),camera().tracks).sample(at));
const draft={read:(atId,at)=>pending?.cameraId===atId&&pending.frame===at?pending:null,
  stage(atId,at,c,t,pose){pending=context.__localManualCameraDraftValue({scope:'test',cameraId:atId,frame:at},c,t,pose);return true;},replace(value){pending=value;}};
const api=()=>make({R:fn=>{state=fn(state);},iH:{current:A.id},a_:{current:null},a$:{current:undefined},C:true,rC:null,il:state.multiCamera,
  tZ:{getSnapshot:()=>false},iT:()=>{},Q:{},ej:'performance',od:'camera',ek:{current:frame/30},iK:state,e$:{current:true},__localManualCameraId:id,__localManualCameraDraft:draft});
const commit=(pose,reason)=>api().commit(pose,'director.scene-camera.'+reason,id);
const record=selected=>context.__localRecordManualCameraChannels({editable:true,poseEditing:false,targetPicking:false,playing:false,cameraId:id,frame,draft,commit:api().persist,select:()=>{}},selected);
const position=plain(native.position),rotation={x:30,y:390,z:45};
assert.equal(commit(context.__localCameraWithRotation(sample(frame),rotation),'rotation'),true);
assert.deepEqual(sample(frame).position,position);assert.deepEqual(sample(frame).rotation,rotation);
assert.equal(commit(context.__localCameraWithPosition(sample(frame),{x:8,y:3,z:2}),'position'),true);
assert.deepEqual(sample(0).rotation,rotation,'A position edit cannot change orientation');
assert.deepEqual(sample(0),sample(300),'Default camera remains static at all times');
assert.ok(channels.every(c=>camera().tracks[c].length===0));
assert.deepEqual(plain(state.multiCamera.cameras[0]),A,'Selected A is independent of edited B');
const navigation=context.oN(sample(0));
assert.equal(navigation.yaw,-rotation.y);assert.equal(navigation.pitch,rotation.x);
const moved=context.oD(sample(0),{...navigation,x:12,y:6,z:4});
assert.deepEqual(plain(moved.rotation),rotation,'WASD preserves yaw pitch roll including authored turns');
const turned=context.oD(moved,{...context.oN(moved),yaw:-410,pitch:35});
assert.deepEqual(plain(turned.position),plain(moved.position));assert.deepEqual(plain(turned.rotation),{x:35,y:410,z:45});

frame=0;assert.equal(record([...positions,...rotations]),true);
frame=30;const previous=plain(camera());
assert.equal(commit(context.__localCameraWithRotation(sample(frame),{x:30,y:750,z:45}),'rotation'),true);
assert.deepEqual(plain(camera()),previous,'Rotation key edits remain pending until explicit record');
assert.equal(record(rotations),true);assert.equal(pending,null);
assert.equal(sample(15).rotation.y,570,'Native Euler keys retain winding at the midpoint');
assert.deepEqual(sample(15).position,sample(0).position);
assert.deepEqual(plain(camera().tracks['position.x'].map(k=>k.frame)),[0]);
assert.deepEqual(plain(camera().tracks['rotation.y'].map(k=>k.frame)),[0,30]);
assert.ok([...targets,'lens.roll'].every(c=>camera().tracks[c].length===0),'No invisible aim or tilt keys are authored');
const loaded=context.tX(JSON.parse(JSON.stringify(state.multiCamera)));
assert.equal(loaded.ok,true);
assert.deepEqual(plain(loaded.document.cameras[1].tracks['rotation.y']),plain(camera().tracks['rotation.y']));
const propertyFactory=vm.runInContext(`b=>{const {C,rC,cO,tZ,__localManualCameraId,ek,iK,il,__localManualCameraDraft,iO,lj,sQ,nU,ej}=b;return ${propertySource}}`,context);
const properties=()=>propertyFactory({C:true,rC:null,cO:false,tZ:{getSnapshot:()=>false},__localManualCameraId:id,ek:{current:frame/30},iK:state,il:state.multiCamera,
  __localManualCameraDraft:draft,iO:id,lj:()=>{throw Error('Whole-transform record must not toggle existing keys off');},sQ:api().persist,nU:()=>{},ej:'performance'});
properties()([...positions,...rotations],true);
const recorded=plain(camera().tracks);
properties()([...positions,...rotations],true);
assert.deepEqual(plain(camera().tracks),recorded,'Repeated whole-transform header recording updates rather than deleting keys');

const commitGizmo=vm.runInContext('('+gizmo+')',context);let emitted;
const pose=sample(0),quat=context.__localCameraQuaternion({...pose,rotation:{x:20,y:400,z:70}});
const runtime={sceneCameraDrag:{mode:'rotate',part:'camera'},sceneCamera:{cameraHandle:{position:new THREE.Vector3(...axes.map(a=>pose.position[a])),quaternion:quat}}};
commitGizmo(runtime,{state:{sceneCamera:pose},onSceneCameraChange:(value,meta)=>{emitted={value,meta};}});
assert.equal(emitted.meta.changedPart,'rotation');assert.deepEqual(plain(emitted.value.position),pose.position);
assert.ok(context.__localCameraQuaternion(emitted.value).angleTo(quat)<1e-6,'Three-axis gizmo rotation includes camera roll');
runtime.sceneCameraDrag={mode:'translate',part:'camera'};runtime.sceneCamera.cameraHandle.position.set(50,6,7);
commitGizmo(runtime,{state:{sceneCamera:pose},onSceneCameraChange:(value,meta)=>{emitted={value,meta};}});
assert.deepEqual(plain(emitted.value.rotation),pose.rotation);assert.deepEqual(plain(emitted.value.position),{x:50,y:6,z:7});
console.log('Camera transform authoring passed: independent position/rotation, navigation, native six-channel keys, persistence and gizmo rotation/translation');
