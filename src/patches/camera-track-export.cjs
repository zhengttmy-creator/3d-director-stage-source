const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

module.exports = function patchCameraTrackExport(factories) {
  let source = factories['53401'];
  const replace = (label, before, after) => {
    assert.equal(source.split(before).length, 2, 'Camera track export anchor changed: ' + label);
    source = source.replace(before, after);
  };
  replace('runtime', 'function cr(e){',
    fs.readFileSync(path.join(__dirname, 'camera-track-export-runtime.js'), 'utf8') + '\nfunction cr(e){');
  replace('track plan independent of selected camera',
    'oL=(0,n.useMemo)(()=>cr({source:t6,document:il,storyboard:oN,timelineDurationSec:oR.durationSec,displayFps:oR.displayFps}),[oR.displayFps,oR.durationSec,il,oN,t6])',
    'oL=(0,n.useMemo)(()=>__localCameraTrackExportPlan({document:il,storyboard:iK.timeline.cameraCutTrack,displayFps:oR.displayFps}),[oR.displayFps,il,iK.timeline.cameraCutTrack])');
  replace('strict track frame rendering',
    'sy=(0,n.useCallback)(async(e,t,r,a)=>{var i;let n=o$.sampleTime(t),',
    'sy=(0,n.useCallback)(async(e,t,r,a)=>{var i;let n=__localSampleCameraTrackExportFrame(o$,oL,t),');
  replace('render plan dependency',
    'width:r,height:a}))??null},[il.cameras,iX,o$,rc])',
    'width:r,height:a}))??null},[il.cameras,iX,o$,oL,rc])');
  replace('open track export only',
    're(rO((e={document:il,storyboard:oN}).storyboard,e.document.cameras.map(e=>{let{id:t}=e;return t})).clips.length>0?{kind:"storyboard"}:{kind:"camera",cameraId:ci(e.document).id})',
    're({kind:"storyboard"})');
  replace('dialog validation props',
    'open:sA&&il.cameras.length>0,durationSec:oL.durationSec,',
    'open:sA&&il.cameras.length>0,trackExportError:oL.exportError,trackShotCount:oL.shotCount,durationSec:oL.durationSec,');
  replace('guard export start',
    'onStart:()=>{if(il.cameras.length)sF()},onCancel:sO,',
    'onStart:()=>{if(!il.cameras.length)return;if(!oL.exportReady){iT(oL.exportError);return}sF()},onCancel:sO,');
  replace('dialog receives validation',
    'function hK(e){let t,r,{open:a,durationSec:n,',
    'function hK(e){let t,r,{open:a,trackExportError:__localTrackExportError,trackShotCount:__localTrackShotCount,durationSec:n,');
  replace('disabled start button',
    '"data-writeback-action":"start-video-export",onClick:j,className:',
    '"data-writeback-action":"start-video-export",onClick:j,disabled:!!__localTrackExportError,title:__localTrackExportError,className:');
  replace('pass validation to settings',
    '(hQ,{durationSec:n,fps:o,',
    '(hQ,{trackExportError:__localTrackExportError,trackShotCount:__localTrackShotCount,durationSec:n,fps:o,');
  replace('settings receives validation',
    'function hQ(e){let t,{durationSec:r,fps:a,',
    'function hQ(e){let t,{trackExportError:__localTrackExportError,trackShotCount:__localTrackShotCount,durationSec:r,fps:a,');
  replace('validation feedback',
    '!!g&&(0,i.jsxs)("div",{className:"flex gap-3 rounded-xl border border-danger/25 bg-danger/8 p-3 text-danger",',
    '!!(g||__localTrackExportError)&&(0,i.jsxs)("div",{role:"alert","data-testid":"director-stage-video-export-track-error",className:"flex gap-3 rounded-xl border border-danger/25 bg-danger/8 p-3 text-danger",');
  replace('validation heading',
    'children:y("directorStage.videoExport.failed")',
    'children:__localTrackExportError?"请完善镜头轨道":y("directorStage.videoExport.failed")');
  replace('validation explanation',
    'children:f??y("directorStage.videoExport.error.generic")',
    'children:__localTrackExportError??f??y("directorStage.videoExport.error.generic")');
  replace('fixed track source control',
    '(0,i.jsx)(md,{value:A,onValueChange:e=>{b(e===ct?{kind:"storyboard"}:{kind:"camera",cameraId:e})},className:"mt-2 h-9 w-full rounded-lg border border-stroke bg-surface-raised px-3 text-[12px] text-content-secondary outline-none","data-testid":"director-stage-video-export-source",label:y("directorStage.videoExport.source"),options:[{value:ct,disabled:!p,label:p?y("directorStage.videoExport.sourceStoryboard"):y("directorStage.videoExport.sourceStoryboardUnavailable")},...m.map(e=>({value:e.id,label:nC(e)}))]})',
    '(0,i.jsxs)("div",{className:"mt-2 flex min-h-9 w-full items-center justify-between gap-3 rounded-lg border border-stroke bg-surface-raised px-3 py-2 text-[12px] text-content-secondary","data-testid":"director-stage-video-export-source","aria-label":"导出来源：镜头轨道",children:[(0,i.jsx)("span",{className:"font-medium text-content",children:"镜头轨道"}),(0,i.jsx)("span",{className:"text-content-muted",children:`${__localTrackShotCount??0} 个启用片段`})]})');
  replace('fixed track export explanation',
    'children:"storyboard"===d.kind?y("directorStage.videoExport.sourceStoryboardHint"):y("directorStage.videoExport.sourceCameraHint",{camera:t??""})',
    'children:"按相机轨道从上到下选择当前启用的镜头；上层结束后继续播放下层覆盖该时刻的镜头，渲染至所有启用片段的最晚结束时间。"');
  replace('track export description',
    'children:F("directorStage.videoExport.description")',
    'children:"按镜头轨道的上下层级和拍摄时段渲染，自动切换相机。"');
  replace('preview track name',
    'oJ=(0,n.useMemo)(()=>[{id:ct,name:Q.timelineStoryboard,disabled:!oD.storyboardAvailable}',
    'oJ=(0,n.useMemo)(()=>[{id:ct,name:"镜头轨道",disabled:!oN.clips.some(clip=>clip.enabled!==false)}');
  replace('preview track options dependencies',
    '[Q.timelineStoryboard,il.cameras,oD.storyboardAvailable]', '[il.cameras,oN]');
  replace('current preview label',
    'oX="storyboard"===oD.source.kind?Q.timelineStoryboard:',
    'oX="storyboard"===oD.source.kind?"镜头轨道":');
  replace('main viewport follows the preview source',
    '(my,{open:ab,mode:av,cameras:oY,selectedCameraId:iO,',
    '(my,{open:ab,mode:av,cameras:oJ,selectedCameraId:oK,');
  factories['53401'] = source;
};
