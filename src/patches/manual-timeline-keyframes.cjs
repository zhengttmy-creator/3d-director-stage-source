const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

module.exports = function patchManualTimelineKeyframes(factories) {
  let source = factories['53401'];
  const replace = (label, before, after) => {
    assert.equal(source.split(before).length, 2, 'Timeline keyframe patch anchor changed: ' + label);
    source = source.replace(before, after);
  };
  replace('runtime helpers', 'function ho(e){',
    fs.readFileSync(path.join(__dirname, 'manual-timeline-keyframes-runtime.js'), 'utf8') + '\nfunction ho(e){');
  replace('record without toggle', 'p=(0,n.useCallback)((e,a)=>{if("performance"!==t)return;',
    'p=(0,n.useCallback)((e,a,__localRecordOnly=!1)=>{if("performance"!==t)return;');
  replace('record locked object guard', 's=r.objects.find(t=>t.id===e);if("rotation"===a&&lL',
    's=r.objects.find(t=>t.id===e);if(__localRecordOnly&&(!s||s.locked||"environment"===s.kind||"world"===s.kind))return;if("rotation"===a&&lL');
  replace('preserve keys on repeated add', 'if(o.every(Boolean)){let r=i,a=[];',
    'if(o.every(Boolean)&&!__localRecordOnly){let r=i,a=[];');
  replace('row props', 'onBeginCameraPath:z,onSelectObject:F,onSelectCamera:R}=e,T=',
    'onBeginCameraPath:z,onSelectObject:F,onSelectCamera:R,manualKeyProps:__localKeyProps}=e,T=');
  replace('row button', 'children:V}):V,!!("camera-root"===u.kind',
    'children:V}):V,__localKeyProps&&["object-group","camera-group","camera-channel"].includes(u.kind)&&(0,i.jsx)(__LocalTimelineKeyButton,{...__localKeyProps,row:u}),!!("camera-root"===u.kind');
  replace('timeline callback', 'onSelectStoryboardCamera:G,onSelectObject:U,onSelectCamera:V,onTimeChange:W',
    'onSelectStoryboardCamera:G,onSelectObject:U,onSelectCamera:V,onRecordRowKeyframe:__localRecordRow,manualKeyEditable:__localCanRecord=!0,onTimeChange:W');
  replace('timeline row wiring', 'onBeginObjectPath:O,onSelectObject:U,onSelectCamera:V})},e.id)',
    'onBeginObjectPath:O,onSelectObject:U,onSelectCamera:V,manualKeyProps:{clock:k,playback:S,editable:__localCanRecord,onRecord:__localRecordRow,tracks:g.objectTracks,camera:h.find(t=>t.id===e.cameraId),clips:g.clips,fps:g.displayFps}})},e.id)');
  replace('editor record handler', 'onSelectStoryboardCamera:dr,onSelectObject:du,onSelectCamera:da,onTimeChange:e=>{t8(!1),nP(e)}',
    `onSelectStoryboardCamera:dr,onSelectObject:du,onSelectCamera:da,onRecordRowKeyframe:__localRow=>{
      if(!C||rC||cO||tZ.getSnapshot())return;
      if(__localRow.kind==="object-group"){s7(__localRow.object.id,__localRow.objectGroup,!0);return}
      if(!il.cameras.some(camera=>camera.id===__localRow.cameraId))return;
      const frame=Math.max(0,Math.round(ek.current*iK.timeline.displayFps));
      let refs=[];
      sQ(state=>{const result=__localRecordCameraRowKeyframe(state,__localRow,frame);refs=result.refs;return result.state},"director.timeline.record-camera-keyframe",__localRow.cameraId);
      if(refs.length)nU(refs);
    },onTimeChange:e=>{t8(!1),nP(e)}`);
  replace('record availability', 'storyboardPreviews:o1,storyboardEditable:C,selectedClipId:nF',
    'storyboardPreviews:o1,storyboardEditable:C,manualKeyEditable:C&&!rC&&!cO,selectedClipId:nF');
  factories['53401'] = source;
};
