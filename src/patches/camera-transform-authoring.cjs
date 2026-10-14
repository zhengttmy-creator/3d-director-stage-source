const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const parser = require('@babel/parser');
const traverse = require('@babel/traverse').default;

module.exports = function patchCameraTransformAuthoring(factories) {
  let source = factories['53401'];
  const replace = (label, before, after) => {
    assert.equal(source.split(before).length, 2, 'Camera transform authoring anchor changed: ' + label);
    source = source.replace(before, after);
  };
  replace('runtime', 'function __localManualCameraSignature(',
    fs.readFileSync(path.join(__dirname, 'camera-transform-authoring-runtime.js'), 'utf8') + '\nfunction __localManualCameraSignature(');
  const ast = parser.parse('(' + source + ')'), edits = [];
  const found = new Map();
  const change = (name, node, text) => {found.set(name, (found.get(name) || 0) + 1);edits.push({start:node.start-1,end:node.end-1,text});};
  traverse(ast, {
    FunctionDeclaration(entry) {
      const name = entry.node.id.name;
      if (name === 'oN') change(name, entry.node, `function oN(camera){const rotation=__localCameraRotation(camera);return{
        x:camera.position.x,y:camera.position.y,z:camera.position.z,yaw:-rotation.y,pitch:rotation.x,fov:camera.fov}}`);
      if (name === 'oD') change(name, entry.node, `function oD(camera,view){const rotation=__localCameraRotation(camera);
        return __localCameraWithTransform({...camera,fov:view.fov},{position:{x:view.x,y:view.y,z:view.z},rotation:{x:view.pitch,y:-view.yaw,z:rotation.z}})}`);
      if (name === '__localManualCameraPose') change(name,entry.node,
        `function __localManualCameraPose(camera,values,channels=__localCameraTransformChannels()){return __localCameraTransformPose(camera,values,channels)}`);
      if (name === '__localManualCameraDraftValue') change(name,entry.node,
        `function __localManualCameraDraftValue(owner,camera,tracks,pose){return __localCameraTransformDraftValue(owner,camera,tracks,pose)}`);
      if (name === '__localManualCameraEdit') change(name,entry.node,
        `function __localManualCameraEdit(camera,tracks,displayed,incoming,channels){return __localCameraTransformEdit(camera,tracks,displayed,incoming,channels)}`);
    },
    VariableDeclarator(entry) {
      if (entry.node.init?.type !== 'CallExpression') return;
      const name = entry.node.id.name, code = source.slice(entry.node.start-1,entry.node.end-1);
      if (name === 'cx' && code.includes('__localManualCameraId')) change(name,entry.node.init, `(0,n.useCallback)((incoming,reason,explicitCameraId)=>{
        if(!e$.current||!C||rC)return false;
        const cameraId=explicitCameraId??__localManualCameraId,authored=il.cameras.find(camera=>camera.id===cameraId);
        if(!authored)return false;
        const isView=reason==="director.scene-camera.view";
        const isPose=isView||["director.scene-camera.transform","director.scene-camera.position","director.scene-camera.rotation","director.scene-camera.target","director.scene-camera.fov","director.scene-camera.roll"].includes(reason);
        if(!isPose){sQ(state=>({...state,sceneCamera:{...state.sceneCamera,aspectRatio:incoming.aspectRatio,
          cameraHelperVisible:incoming.cameraHelperVisible,cameraLocked:incoming.cameraLocked,targetHelperVisible:false,targetLocked:false}}),reason,cameraId);return true}
        if(tZ.getSnapshot()){iT(Q.timelineCameraPlaybackLocked);return false}
        if("performance"===ej&&!isView&&!od){iT(Q.timelineCameraSelectPart);return false}
        const frame=Math.max(0,Math.round(ek.current*iK.timeline.displayFps)),camera=t0(authored),tracks=authored.tracks;
        const displayed="performance"===ej?__localManualCameraDraft.read(cameraId,frame)?.camera??eK(camera,tracks).sample(frame):camera;
        const rotationReason=reason==="director.scene-camera.rotation"||reason==="director.scene-camera.target"||reason==="director.scene-camera.roll";
        const channels=isView?__localCameraTransformChannels():rotationReason?["rotation.x","rotation.y","rotation.z"]:reason==="director.scene-camera.fov"?["lens.fov"]:l7;
        if(reason==="director.scene-camera.target")incoming=__localCameraFromLegacyTarget(incoming,__localCameraRotation(displayed));
        else if(reason==="director.scene-camera.roll")incoming=__localCameraWithRotation(incoming,{...__localCameraRotation(displayed),z:incoming.roll});
        if("performance"!==ej){
          const next=__localManualCameraPose(camera,incoming,channels);
          if(!channels.some(channel=>Math.abs(eZ(next,channel)-eZ(camera,channel))>1e-7))return false;
          sQ(state=>({...state,sceneCamera:__localManualCameraPose(state.sceneCamera,next,channels)}),reason,cameraId);return true;
        }
        const edit=__localManualCameraEdit(camera,tracks,displayed,incoming,channels);
        if(!edit.changed)return false;
        if(edit.pending)return __localManualCameraDraft.stage(cameraId,frame,camera,tracks,edit.pending);
        sQ(state=>({...state,sceneCamera:__localManualCameraPose(state.sceneCamera,edit.camera,channels)}),reason,cameraId);return true;
      },[C,rC,__localManualCameraId,__localManualCameraDraft,il.cameras,sQ,tZ,iT,Q.timelineCameraPlaybackLocked,Q.timelineCameraSelectPart,ej,od,ek,iK.timeline.displayFps])`);
      if (name === 'cA' && code.includes('__localNavigationPreview.clear')) change(name,entry.node.init, `(0,n.useCallback)(incoming=>{
        if(!C||!am||rC)return false;
        const cameraId=o3.activeCameraId??iO;
        if(!il.cameras.some(camera=>camera.id===cameraId))return false;
        const next=__localCameraTransformPose(sn,incoming);
        t8(false);const changed=cx(next,"director.scene-camera.view",cameraId);
        ah(null);__localNavigationPreview.clear();return changed;
      },[C,am,rC,iO,o3.activeCameraId,il.cameras,sn,t8,cx,__localNavigationPreview])`);
    },
    ObjectProperty(entry) {
      if (entry.node.key.name === 'onSceneCameraNavigationPreview' && entry.node.value.type === 'ArrowFunctionExpression')
        change('livePreview',entry.node.value, `incoming=>{if(!C||!am||rC||cO)return;
          const cameraId=o3.activeCameraId??iO;if(!il.cameras.some(camera=>camera.id===cameraId))return;
          __localNavigationPreview.publish({ownerKey:sa,cameraId,camera:__localCameraTransformPose(sn,incoming)});
        }`);
    },
  });
  for (const name of ['oN','oD','__localManualCameraPose','__localManualCameraDraftValue','__localManualCameraEdit','cx','cA','livePreview'])
    assert.equal(found.get(name),1,'One camera transform authoring site: '+name);
  for(const edit of edits.sort((a,b)=>b.start-a.start)) source=source.slice(0,edit.start)+edit.text+source.slice(edit.end);
  replace('full transform record-only option', '"performance"===ej?channels=>{', '"performance"===ej?(channels,recordOnly=false)=>{');
  replace('full transform diamond updates existing keys',
    'if(!__localManualCameraDraft.read(cameraId,frame)&&cameraId===iO)return lj(channels);',
    'if(!recordOnly&&!__localManualCameraDraft.read(cameraId,frame)&&cameraId===iO)return lj(channels);');
  replace('unified camera selection', 'de=(0,n.useCallback)(e=>{eW(void 0),el(),al(e),',
    'de=(0,n.useCallback)(e=>{e=e?"camera":void 0;eW(void 0),el(),al(e),');
  assert.equal(source.split('selectedSceneCameraPart:od,').length,3,'Viewport and inspector camera selection');
  source=source.replaceAll('selectedSceneCameraPart:od,','selectedSceneCameraPart:od?"camera":void 0,');
  replace('camera transform lock covers rotation',
    '"rotate"===e.tool?e.targetLocked?void 0:"rotate":e.cameraLocked?void 0:"translate"',
    '"rotate"===e.tool?e.cameraLocked?void 0:"rotate":e.cameraLocked?void 0:"translate"');
  replace('gizmo owns rotation rather than target',
    'i="rotate"===r.mode?"target":r.part,n="camera"===i?{...t.state.sceneCamera,position:{x:a.cameraHandle.position.x,y:a.cameraHandle.position.y,z:a.cameraHandle.position.z}}:{...t.state.sceneCamera,target:{x:a.targetHandle.position.x,y:a.targetHandle.position.y,z:a.targetHandle.position.z}};',
    'i="rotate"===r.mode?"rotation":"camera",n=i==="rotation"?__localCameraWithRotation(t.state.sceneCamera,__localCameraRotationFromQuaternion(a.cameraHandle.quaternion,__localCameraRotation(t.state.sceneCamera))):__localCameraWithPosition(t.state.sceneCamera,{x:a.cameraHandle.position.x,y:a.cameraHandle.position.y,z:a.cameraHandle.position.z});');
  replace('gizmo rotation commit route',
    'onSceneCameraChange:(e,t)=>cx(e,(null==t?void 0:t.changedPart)==="target"?"director.scene-camera.target":"director.scene-camera.transform"),',
    'onSceneCameraChange:(e,t)=>cx(e,(null==t?void 0:t.changedPart)==="rotation"?"director.scene-camera.rotation":(null==t?void 0:t.changedPart)==="target"?"director.scene-camera.target":"director.scene-camera.transform"),');
  replace('gizmo preview keeps quaternion and independent translation', 'r.camera.quaternion.copy(sp(f,h)),',
    `if(__localIsCameraRotation(a.rotation)){
      if(n&&e.sceneCameraDrag?.mode==="rotate")f=__localCameraWithRotation(f,__localCameraRotationFromQuaternion(r.cameraHandle.quaternion,__localCameraRotation(a)));
      else if(n&&e.sceneCameraDrag?.part==="camera")f=__localCameraWithPosition(a,{x:r.cameraHandle.position.x,y:r.cameraHandle.position.y,z:r.cameraHandle.position.z});
      else if(u||p||d)f=__localCameraFromLegacyTarget(f,__localCameraRotation(a));
      else f=__localCameraWithPosition(a,f.position);
      r.targetHandle.position.set(f.target.x,f.target.y,f.target.z);
    }r.camera.quaternion.copy(sp(f,h)),`);
  factories['53401']=source;
};
