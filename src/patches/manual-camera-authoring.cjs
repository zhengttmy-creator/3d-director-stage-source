const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const parser = require('@babel/parser');
const traverse = require('@babel/traverse').default;

// Apply after camera navigation, camera rows and manual timeline buttons. Object
// authoring and deliberately authored camera path presets retain their own logic.
module.exports = function patchManualCameraAuthoring(factories) {
  let source = factories['53401'];
  const replace = (label, before, after) => {
    assert.equal(source.split(before).length, 2, 'Manual camera authoring anchor changed: ' + label);
    source = source.replace(before, after);
  };
  replace('runtime', 'function __localCreateCameraNavigationPreviewStore()',
    fs.readFileSync(path.join(__dirname, 'manual-camera-authoring-runtime.js'), 'utf8') + '\nfunction __localCreateCameraNavigationPreviewStore()');
  replace('settled draft hook', 'sr="performance"===ej||am||oF?o9:iK.sceneCamera,',
    `sr="performance"===ej||am||oF?o9:iK.sceneCamera,
      __localManualCameraId=("performance"===ej||am||oF?o3.activeCameraId:null)??iO,
      __localManualCameraDraft=__localUseManualCameraDraft({scope:[J,ej,iO].join("\\0"),cameraId:__localManualCameraId,
        frame:Math.max(0,Math.round(o8)),cameras:il.cameras,playback:tZ,enabled:C&&!rC}),`);
  replace('display settled edits', 'sn=(null==si?void 0:si.current)??sr,',
    'sn=__localManualCameraDraft.displayed??(null==si?void 0:si.current)??sr,');
  replace('row helper accepts displayed pose', 'function __localRecordCameraRowKeyframe(state, row, frame) {',
    'function __localRecordCameraRowKeyframe(state, row, frame, displayCamera) {');
  replace('row helper samples displayed pose', 'const sampled = eK(camera, state.timeline.cameraTracks).sample(frame);',
    'const sampled = displayCamera || eK(camera, state.timeline.cameraTracks).sample(frame);');

  const ast = parser.parse('(' + source + ')');
  const edits = [];
  let commits = 0, navigation = 0, resets = 0, rows = 0, properties = 0, live = 0;
  traverse(ast, {
    VariableDeclarator(entry) {
      const code = source.slice(entry.node.start - 1, entry.node.end - 1);
      if (entry.node.id.name === 'cx' && code.includes('timelineCameraSelectPart')) {
        commits++;
        edits.push({start: entry.node.init.start - 1, end: entry.node.init.end - 1, text: `(0,n.useCallback)((incoming,reason,explicitCameraId)=>{
          if(!e$.current||!C||rC)return false;
          const cameraId=explicitCameraId??__localManualCameraId;
          const authored=il.cameras.find(camera=>camera.id===cameraId);
          if(!authored)return false;
          const isView=reason==="director.scene-camera.view";
          const isPose=isView||["director.scene-camera.transform","director.scene-camera.position","director.scene-camera.target","director.scene-camera.fov","director.scene-camera.roll"].includes(reason);
          if(!isPose){sQ(state=>({...state,sceneCamera:{...state.sceneCamera,aspectRatio:incoming.aspectRatio,
            cameraHelperVisible:incoming.cameraHelperVisible,targetHelperVisible:incoming.targetHelperVisible,
            cameraLocked:incoming.cameraLocked,targetLocked:incoming.targetLocked}}),reason,cameraId);return true}
          if(tZ.getSnapshot()){iT(Q.timelineCameraPlaybackLocked);return false}
          if("performance"===ej&&!isView&&!od){iT(Q.timelineCameraSelectPart);return false}
          const frame=Math.max(0,Math.round(ek.current*iK.timeline.displayFps));
          const camera=t0(authored),tracks=authored.tracks;
          const channels=isView?eH:reason==="director.scene-camera.fov"?["lens.fov"]:reason==="director.scene-camera.roll"?["lens.roll"]:
            reason==="director.scene-camera.target"||od==="target"?l6:l7;
          if("performance"!==ej){
            const next=__localManualCameraPose(camera,incoming,channels);
            if(!channels.some(channel=>Math.abs(eZ(next,channel)-eZ(camera,channel))>1e-7))return false;
            sQ(state=>({...state,sceneCamera:__localManualCameraPose(state.sceneCamera,next,channels)}),reason,cameraId);
            return true;
          }
          const displayed=__localManualCameraDraft.read(cameraId,frame)?.camera??eK(camera,tracks).sample(frame);
          const edit=__localManualCameraEdit(camera,tracks,displayed,incoming,channels);
          if(!edit.changed)return false;
          if(edit.pending)return __localManualCameraDraft.stage(cameraId,frame,camera,tracks,edit.pending);
          sQ(state=>({...state,sceneCamera:__localManualCameraPose(state.sceneCamera,edit.camera,channels)}),reason,cameraId);
          return true;
        },[C,rC,__localManualCameraId,__localManualCameraDraft,il.cameras,sQ,tZ,iT,Q.timelineCameraPlaybackLocked,Q.timelineCameraSelectPart,ej,od,ek,iK.timeline.displayFps])`});
      }
      if (entry.node.id.name === 'cA' && code.includes('__localNavigationPreview.clear')) {
        navigation++;
        edits.push({start: entry.node.init.start - 1, end: entry.node.init.end - 1,
          text: source.slice(entry.node.init.start - 1, entry.node.init.end - 1)
            .replace('const next={...sr,', 'const next={...sn,')
            .replace('il.cameras,sr,t8,cx,', 'il.cameras,sr,sn,t8,cx,')});
      }
      if (entry.node.id.name === 'cS' && code.includes('Q.viewReset') && code.includes('e.baseline')) {
        resets++;
        edits.push({start: entry.node.init.start - 1, end: entry.node.init.end - 1,
          text: source.slice(entry.node.init.start - 1, entry.node.init.end - 1)
            .replace('()=>{ec(),', '()=>{ec(),__localManualCameraDraft.clear(),__localNavigationPreview.clear(),')
            .replace('[iO,sa,ec,Q.viewReset,iT]', '[iO,sa,ec,Q.viewReset,iT,__localManualCameraDraft,__localNavigationPreview]')});
      }
    },
    ObjectProperty(entry) {
      const key = entry.node.key.name;
      if (key === 'onRecordRowKeyframe' && entry.node.value.type === 'ArrowFunctionExpression') {
        rows++;
        edits.push({start: entry.node.value.start - 1, end: entry.node.value.end - 1, text: `row=>{
          if(!C||rC||cO||tZ.getSnapshot())return;
          if(row.kind==="object-group"){s7(row.object.id,row.objectGroup,true);return}
          if(!il.cameras.some(camera=>camera.id===row.cameraId))return;
          return __localRecordManualCameraChannels({editable:C,poseEditing:!!rC,targetPicking:!!cO,playing:tZ.getSnapshot(),
            cameraId:row.cameraId,frame:Math.max(0,Math.round(ek.current*iK.timeline.displayFps)),draft:__localManualCameraDraft,
            commit:sQ,select:nU},__localCameraRowChannels(row));
        }`});
      }
      if (key === 'onToggleCameraKeyframe' && source.slice(entry.node.value.start - 1, entry.node.value.end - 1) === '"performance"===ej?lj:void 0') {
        properties++;
        edits.push({start: entry.node.value.start - 1, end: entry.node.value.end - 1, text: `"performance"===ej?channels=>{
          if(!C||rC||cO||tZ.getSnapshot())return;
          const cameraId=__localManualCameraId,frame=Math.max(0,Math.round(ek.current*iK.timeline.displayFps));
          if(!il.cameras.some(camera=>camera.id===cameraId))return;
          if(!__localManualCameraDraft.read(cameraId,frame)&&cameraId===iO)return lj(channels);
          return __localRecordManualCameraChannels({editable:C,poseEditing:!!rC,targetPicking:!!cO,playing:tZ.getSnapshot(),
            cameraId,frame,draft:__localManualCameraDraft,commit:sQ,select:nU},channels);
        }:void 0`});
      }
      if (key === 'onSceneCameraNavigationPreview' && entry.node.value.type === 'ArrowFunctionExpression') {
        live++;
        const code = source.slice(entry.node.value.start - 1, entry.node.value.end - 1);
        edits.push({start: entry.node.value.start - 1, end: entry.node.value.end - 1,
          text: code.replace('camera:{...sr,', 'camera:{...sn,')});
      }
    },
  });
  assert.equal(commits, 1, 'Manual camera pose commit callback');
  assert.equal(navigation, 1, 'Manual camera navigation callback');
  assert.equal(resets, 1, 'Manual camera reset callback');
  assert.equal(rows, 1, 'Manual camera row record callback');
  assert.equal(properties, 1, 'Manual camera property record callback');
  assert.equal(live, 1, 'Manual camera live preview callback');
  for (const edit of edits.sort((a,b) => b.start - a.start)) source = source.slice(0, edit.start) + edit.text + source.slice(edit.end);
  factories['53401'] = source;
};
