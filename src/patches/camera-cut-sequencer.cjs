const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const parser = require('@babel/parser');
const traverse = require('@babel/traverse').default;

module.exports = function patchCameraCutSequencer(factories) {
  let source = factories['53401'];
  const replace = (label, before, after) => {
    assert.equal(source.split(before).length, 2, 'Camera cuts patch anchor changed: ' + label);
    source = source.replace(before, after);
  };
  const replaceFunction = (name, value) => {
    let found;
    traverse(parser.parse('(' + source + ')'), {FunctionDeclaration(entry) {
      if (entry.node.id?.name === name) {assert.equal(found, undefined); found = entry.node;}
    }});
    assert.ok(found, 'Camera cuts function missing: ' + name);
    source = source.slice(0, found.start - 1) + value + source.slice(found.end - 1);
  };
  replaceFunction('rO', 'function rO(e,t){return __localNormalizeShots(e?.clips,t)}');
  replaceFunction('rV', 'function rV(e){return __localNormalizeShots(e)}');
  replaceFunction('rU', 'function rU(e){return rO(e).clips.reduce((end,clip)=>Math.max(end,clip.endFrame),0)}');
  replaceFunction('rH', 'function rH(e,t,r){const c=rO(e).clips.find(c=>c.id===t);return c?__localEditShot(e,t,{endFrame:c.startFrame+Math.max(1,rQ(r))}):rO(e)}');
  replaceFunction('hk', 'function hk(e){return (0,i.jsx)(__LocalShotTrack,e)}');
  replace('runtime', 'function rO(e,t){', fs.readFileSync(path.join(__dirname, 'camera-cut-sequencer-runtime.js'), 'utf8') + '\nfunction rO(e,t){');
  replace('shot metadata', 'function rW(e){return{id:e.id,cameraId:e.cameraId,startFrame:e.startFrame,endFrame:e.endFrame,createdAt:e.createdAt,',
    'function rW(e){return{id:e.id,cameraId:e.cameraId,startFrame:e.startFrame,endFrame:e.endFrame,createdAt:e.createdAt,...e.enabled===false?{enabled:false}:{},');
  replace('import shot enabled', 'createdAt:e.createdAt,...iY(e.provenance)', 'createdAt:e.createdAt,...e.enabled===false?{enabled:false}:{},...iY(e.provenance)');
  replace('import preserve camera layers', 'return{version:1,clips:r.map(e=>{let t=e.endFrame-e.startFrame,r={...e,startFrame:a,endFrame:a+t};return a=r.endFrame,r})}}(e.cameraCutTrack)',
    'return __localNormalizeShots(r)}(e.cameraCutTrack)');
  replace('import duration includes covered layers', '((null==f||null==(a=f.clips.at(-1))?void 0:a.endFrame)??0)/d',
    'rU(f)/d');
  replace('timeline duration includes covered layers', '((null==(r=e.cameraCutTrack)||null==(t=r.clips.at(-1))?void 0:t.endFrame)??0)/a',
    'rU(e.cameraCutTrack)/a');
  replace('fps preserve placement', 'startFrame:0,endFrame:Math.max(1,Math.round((e.endFrame-e.startFrame)/n*o))',
    'startFrame:Math.max(0,Math.round(e.startFrame/n*o)),endFrame:Math.max(Math.round(e.startFrame/n*o)+1,Math.round(e.endFrame/n*o))');
  replace('legacy append placement', 'cameraId:e.cameraId,startFrame:0,endFrame:r,createdAt:e.createdAt',
    'cameraId:e.cameraId,startFrame:rU(t),endFrame:rU(t)+r,createdAt:e.createdAt');
  replace('disabled playback', 'a=r.track)?void 0:a.clips.filter(e=>l.has(e.cameraId))',
    'a=r.track)?void 0:a.clips.filter(e=>l.has(e.cameraId)&&e.enabled!==false)');
  replace('camera row layer priority', 'sample:e=>{let t=Math.max(0,rQ(e)),r=0,a=c.clips.length-1;for(;r<=a;){let e=r+a>>1,i=c.clips[e];if(t<i.startFrame)a=e-1;else{if(!(t>=i.endFrame))return{cameraId:i.cameraId,source:"camera-cut",clipId:i.id};r=e+1}}return o}',
    'sample:e=>{const clip=__localActiveLayerShot(c,s,Math.max(0,rQ(e)));return clip?{cameraId:clip.cameraId,source:"camera-cut",clipId:clip.id}:o}');
  replace('storyboard gap fallback', 'let t=e.document.cameras.find(e=>{let{id:t}=e;return t===r.clips[0].cameraId})??ci(e.document);return{source:{kind:"storyboard"}',
    'let t=ci(e.document);return{source:{kind:"storyboard"}');
  replace('storyboard full timeline', 'cameraCutTrack:r,durationSec:rU(r)/i,sceneCamera:t0(t)',
    'cameraCutTrack:r,durationSec:Math.max(n,rU(r)/i),sceneCamera:t0(t)');
  replace('gesture equality', 'a.startFrame===e.startFrame&&a.endFrame===e.endFrame})}function hy',
    'a.startFrame===e.startFrame&&a.endFrame===e.endFrame&&(a.enabled!==false)===(e.enabled!==false)})}function hy');
  replace('canonical enabled validation', 'e.endFrame>e.startFrame&&kR(e.createdAt)&&(void 0===e.provenance',
    'e.endFrame>e.startFrame&&kR(e.createdAt)&&(void 0===e.enabled||typeof e.enabled==="boolean")&&(void 0===e.provenance');
  replace('timeline props', 'onAppendStoryboardClip:H,onChangeStoryboardTrack:B,',
    'onAppendStoryboardClip:H,onInsertStoryboardClip:__localInsertStoryboard,onPreviewStoryboard:__localPreviewStoryboard,onChangeStoryboardTrack:B,');
  replace('track props', 'onAppend:H,onChange:B,onSelectCamera:G,',
    'onAppend:H,onInsert:__localInsertStoryboard,onPreview:__localPreviewStoryboard,onChange:B,onSelectCamera:G,');
  replace('workspace callbacks', 'onAppendStoryboardClip:d7,onChangeStoryboardTrack:d8,', `onAppendStoryboardClip:d7,
    onPreviewStoryboard:()=>{rr({kind:"storyboard"});re({kind:"storyboard"})},
    onInsertStoryboardClip:request=>{
      if(!C)return {ok:false,reason:"当前项目不可编辑"};
      if(rC)return {ok:false,reason:"请先完成或取消骨骼／姿势编辑，再添加镜头"};
      if(cO&&!request.newCamera)return {ok:false,reason:"请先完成或取消相机目标选择，再添加拍摄片段"};
      const yaw=ii.yaw*Math.PI/180,pitch=ii.pitch*Math.PI/180,horizontal=Math.cos(pitch);
      const view={position:{x:ii.x,y:ii.y,z:ii.z},target:{x:ii.x+Math.sin(yaw)*horizontal*5,y:ii.y+5*Math.sin(pitch),z:ii.z-Math.cos(yaw)*horizontal*5},fov:ii.fov,roll:0,aspectRatio:a2};
      const insertion={...request,id:"storyboard-shot-"+crypto.randomUUID(),newCameraId:"shot-camera-"+crypto.randomUUID(),createdAt:new Date().toISOString()};
      const result=__localInsertShotInState(iK,insertion,view);
      if(!result.ok){iT(result.reason);return result}
      if(cO)cQ();
      dN();sQ(state=>{const next=__localInsertShotInState(state,insertion,view);return next.ok?next.state:state},"director.timeline.storyboard.insert");
      nP(insertion.startFrame/iK.timeline.displayFps);rr({kind:"storyboard"});re({kind:"storyboard"});return true;
    },onChangeStoryboardTrack:d8,`);
  factories['53401'] = source;
};
