import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import {createRequire} from 'node:module';

const require = createRequire(import.meta.url);
const factories = JSON.parse(await fs.readFile(new URL('../src/vendor/module-factories.json', import.meta.url), 'utf8'));
require('../src/patches/manual-timeline-keyframes.cjs')(factories);
require('../src/patches/camera-transform-ui.cjs')(factories);
const source = factories['53401'];
new vm.Script('(' + source + ')');
const ast = require('@babel/parser').parse('(' + source + ')');
const extract = node => source.slice(node.start-1,node.end-1);
const declarations = new Map();
let rowsSource;
require('@babel/traverse').default(ast, {
  FunctionDeclaration(entry) {declarations.set(entry.node.id.name, extract(entry.node));},
  FunctionExpression(entry) {
    const code=extract(entry.node);
    if (code.startsWith('function(e){var t;let r,a=[]') && code.includes('kind:"camera-root"')) rowsSource=code;
  },
});
const jsx = (type,props,key) => ({type,props,key});
const copy={sceneCamera:'相机',sceneCameraPosition:'机位位置',rotation:'旋转',sceneCameraLens:'镜头',fov:'视野',aspectRatio:'画幅比例'};
const context=vm.createContext({i:{jsx,jsxs:jsx},pi:value=>String(value),pn:(...values)=>values.join(':'),
  pl:'VectorProperty',ps:'Section',pc:'NumberProperty',pr:{precision:1},pt:{precision:3},md:'Select',cj:{A:'Camera'},fO:{A:'Diamond'},s$:()=>['16:9'],
  __localCameraRotation:camera=>({...camera.rotation}),
  __localCameraWithRotation:(camera,rotation)=>({...camera,rotation,target:{x:999,y:998,z:997}}),
  __localCameraWithPosition:(camera,position)=>({...camera,position,target:{x:888,y:887,z:886}}),
  bH:()=>true,nC:camera=>camera.name,
  fg:(channel,key,cameraId)=>({frame:key.frame,refs:[{kind:'camera-property',cameraId,channel,keyframeId:key.id}]}),
  fh:(id,keys)=>keys,sP:()=>[],tR:(group,axis)=>group+'.'+axis,
});
for(const name of ['__localCameraTransformGroups','__LocalCameraTransformProperties','__LocalCameraTransformPanel','ce','po','px','bB','__localCameraRowChannels'])
  vm.runInContext(declarations.get(name),context);
const plain=value=>JSON.parse(JSON.stringify(value));
const camera={id:'camera-B',position:{x:1,y:2,z:3},target:{x:40,y:50,z:60},rotation:{x:10,y:720,z:-20},fov:50,roll:-20,aspectRatio:'16:9',cameraLocked:false};
const recorded=[],changed=[],previewed=[];
const properties=context.__LocalCameraTransformProperties({labels:{position:'机位位置',rotation:'旋转',lens:'镜头',fov:'视野'},
  value:camera,keyframeActive:{'rotation.x':true,'rotation.y':true,'rotation.z':true},
  onToggleKeyframe:channels=>recorded.push(plain(channels)),onChange:(...args)=>changed.push(plain(args)),
  onPreviewChange:(...args)=>previewed.push(plain(args)),onCancelPreview:()=>{}});
const [position,rotation,lens]=properties.props.children;
assert.deepEqual(plain(position.props.value),camera.position);
assert.deepEqual(plain(rotation.props.value),camera.rotation,'Rotation shows angles, never the target position');
assert.equal(rotation.props.suffix,'°');
assert.deepEqual(plain(rotation.props.keyframeActive),{x:true,y:true,z:true});
assert.equal(rotation.props.groupKeyframeTestId,'director-stage-camera-group-keyframe-rotation');
rotation.props.onToggleAllKeyframes();
assert.deepEqual(recorded,[['rotation.x','rotation.y','rotation.z']]);
rotation.props.onChange('y',1080,'edit-rotation');
assert.equal(changed[0][0].rotation.y,1080,'Multiple turns are not clamped');
assert.equal(changed[0][1],'director.scene-camera.rotation');
assert.deepEqual(changed[0][0].target,{x:999,y:998,z:997},'Core rotation conversion is used when authoring');
position.props.onPreviewChange('x',7,'edit-position');
assert.equal(previewed[0][0].position.x,7);
assert.deepEqual(previewed[0][0].rotation,camera.rotation);
assert.deepEqual(previewed[0][0].target,{x:888,y:887,z:886},'Position moves the camera without retaining a world target');
assert.equal(lens.props.children.props.value,50);
assert.equal(properties.props.children.length,3,'No standalone target or roll property remains');
assert.equal(context.__LocalCameraTransformProperties({labels:{},value:{...camera,cameraLocked:true}}).props.children[1].props.disabled,true);
const panel=context.__LocalCameraTransformPanel({copy,value:camera,onToggleKeyframe:channels=>recorded.push(plain(channels))});
const transformButton=panel.props.children[0].props.children[2];
assert.equal(transformButton.props['data-testid'],'director-stage-camera-transform-keyframe');
transformButton.props.onClick();
assert.deepEqual(recorded[1],['position.x','position.y','position.z','rotation.x','rotation.y','rotation.z']);

assert.ok(rowsSource,'Actual timeline row builder is available');
const buildRows=vm.runInContext('('+rowsSource+')',context);
const channels=['position.x','position.y','position.z','rotation.x','rotation.y','rotation.z','lens.fov'];
const tracks=Object.fromEntries(channels.map(channel=>[channel,channel.startsWith('rotation.')?[{id:channel+'-15',frame:15,value:20}]:[]]));
const rows=plain(buildRows({shotCameras:[{id:'camera-B',name:'相机 B',tracks}],activeCameraId:'camera-B',selectedCameraId:'camera-B',
  cameraTracks:tracks,expandedRows:{'camera:camera-B:root':true},objects:[],objectTracks:{},clips:[],
  labels:{camera:{position:'机位位置',rotation:'旋转',lens:'镜头',fov:'视野'},transform:{position:'位置',rotation:'旋转',scale:'缩放'}}}));
assert.deepEqual(rows.map(row=>row.id),['camera:camera-B:root','camera:camera-B:position','camera:camera-B:rotation','camera:camera-B:lens.fov']);
const rotationRow=rows[2];
assert.equal(rotationRow.curve.group,'rotation');
assert.deepEqual(plain(context.__localCameraRowChannels(rotationRow)),['rotation.x','rotation.y','rotation.z']);
assert.deepEqual(plain(context.__localCameraRowChannels(rows[0])),['position.x','position.y','position.z','rotation.x','rotation.y','rotation.z']);
assert.deepEqual(rotationRow.aggregateKeyframes.flatMap(key=>key.refs.map(ref=>ref.channel)),['rotation.x','rotation.y','rotation.z']);
assert.ok(rotationRow.aggregateKeyframes.flatMap(key=>key.refs).every(ref=>ref.cameraId==='camera-B'));
assert.deepEqual(plain(context.__localCameraRowChannels({kind:'camera-channel',cameraTrack:'lens.roll'})),[]);

const display=context.bB({selectedPart:'camera',cameraHelperVisible:true,targetHelperVisible:true,spatialPathsEnabled:true,hasSpatialPaths:true});
assert.equal(display.showTargetModel,false);
assert.equal(display.showAimLine,false);
assert.equal(display.showTargetPath,false);
assert.equal(display.showCameraModel,true);
assert.equal(display.showCameraPath,true);
assert.ok(!declarations.get('mV').includes('director-stage-shot-camera-target-row-'));
assert.ok(!declarations.get('mV').includes('director-stage-shot-camera-expand-'));
assert.ok(!declarations.get('ho').includes('director-stage-add-camera-target-path'));
assert.ok(source.includes('flatMap(e=>[e.cameraModel]).filter(e=>e.visible)'));
assert.ok(source.includes('director-stage-camera-target-picker'),'Preset subject selection remains available');
console.log('Camera transform UI: native angle properties, timeline keys, hidden target editing, and preset picker passed');
