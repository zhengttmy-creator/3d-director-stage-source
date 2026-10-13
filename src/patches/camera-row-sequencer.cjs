const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const parser = require('@babel/parser');
const traverse = require('@babel/traverse').default;

module.exports = function patchCameraRows(factories) {
  let source = factories['53401'];
  const replace = (label, before, after) => {
    assert.equal(source.split(before).length, 2, 'Camera row patch anchor changed: ' + label);
    source = source.replace(before, after);
  };
  replace('shared runtime', 'function hL(e){',
    fs.readFileSync(path.join(__dirname, 'camera-row-sequencer-runtime.js'), 'utf8') + '\nfunction hL(e){');
  replace('shared timeline controller', 'return(0,i.jsxs)("div",{className:ok("pointer-events-auto absolute z-40 overflow-hidden"',
    `const __localCameraShots=__localUseCameraShotController({boundaryKey:u,editable:j,track:g.cameraCutTrack,
      cameras:h,previews:P,scale:th,scrollLeftPx:eJ.scrollLeft,clock:k,onInsert:__localInsertStoryboard,
      onPreview:__localPreviewStoryboard,onDeleteCamera:__localDeleteStoryboardCamera,onChange:B,onSelectCamera:G,
      onSeek:eC,onScrollLeftChange:tq,onGestureCancelChange:cancel=>{ey.current=cancel},scrollRef:eh,surfaceRef:eb,frameAtClientX:tQ});
    return(0,i.jsxs)("div",{className:ok("pointer-events-auto absolute z-40 overflow-hidden"`);
  replace('camera row shot layer', 'children:[!!y&&(s=fy(th,y.startFrame,y.endFrame)',
    'children:["camera-root"===e.kind&&!y&&(0,i.jsx)(__LocalCameraShotLane,{controller:__localCameraShots,cameraId:e.cameraId}),!!y&&(s=fy(th,y.startFrame,y.endFrame)');
  replace('keep keyframe summaries on child channels', 'v=e.aggregateKeyframes?fR(e.aggregateKeyframes,tx):void 0,b=e.cameraKeyframes?',
    'v=e.kind!=="camera-root"&&e.aggregateKeyframes?fR(e.aggregateKeyframes,tx):void 0,b=e.cameraKeyframes?');
  replace('keep preset groups out of shot lane', 'x=null==(t=e.cameraPresetGroups)?void 0:t.filter(e=>e.endFrame>=tx.startFrame&&e.startFrame<=tx.endFrame)',
    'x=e.kind==="camera-root"?void 0:null==(t=e.cameraPresetGroups)?void 0:t.filter(e=>e.endFrame>=tx.startFrame&&e.startFrame<=tx.endFrame)');
  replace('exclude cuts from marquee', 'e.target.closest("[data-motion-clip], [data-camera-keyframe]',
    'e.target.closest("[data-camera-shot], [data-motion-clip], [data-camera-keyframe]');
  replace('focused shot owns arrow nudges', 'if(!P&&g_(e)&&!gZ(e.target)&&e.target?.closest?.("[data-director-shot-keyboard]"))return;',
    `if(!P&&g_(e)&&!gZ(e.target)&&e.target?.closest?.("[data-director-shot-keyboard]"))return;if(!P&&!e.isComposing&&!e.ctrlKey&&!e.metaKey&&!e.altKey&&(e.key==="ArrowLeft"||e.key==="ArrowRight")&&e.target?.matches?.('[data-camera-shot][data-shot-editable="true"]'))return;`);
  replace('row header callback', 'onBeginObjectPath:O,onSelectObject:U,onSelectCamera:V,manualKeyProps:',
    'onBeginObjectPath:O,onSelectObject:U,onSelectCamera:V,onAddCameraShot:(anchor,cameraId)=>__localCameraShots.addMenu(anchor,cameraId),shotEditable:j,shotController:__localCameraShots,manualKeyProps:');
  replace('receive row add', 'onSelectCamera:R,manualKeyProps:__localKeyProps}=e',
    'onSelectCamera:R,onAddCameraShot:__localAddCameraShot,shotEditable:__localShotEditable=true,shotController:__localShotController,manualKeyProps:__localKeyProps}=e');
  replace('camera duration beside row title', 'children:V}):V,"object-action"===u.kind&&',
    'children:V}):V,"camera-root"===u.kind&&__localShotController&&(0,i.jsx)(__LocalCameraShotDuration,{controller:__localShotController,cameraId:u.cameraId}),"object-action"===u.kind&&');
  replace('row menu first entry', 'children:[(0,i.jsxs)(cf._2,{onSelect:()=>{let e=T.current;e&&j(e)}',
    'children:[__localAddCameraShot&&(0,i.jsxs)(cf._2,{disabled:!__localShotEditable,onSelect:()=>{const anchor=T.current;if(anchor)window.requestAnimationFrame(()=>__localAddCameraShot(anchor,u.cameraId))},"data-testid":"director-stage-add-camera-shot",children:[(0,i.jsx)(pR.A,{size:13,"aria-hidden":"true"}),"添加拍摄片段"]}),(0,i.jsxs)(cf._2,{onSelect:()=>{let e=T.current;e&&j(e)}');
  // Replace only the actual footer call. The old single-lane component remains available to old patch-only fixtures.
  let footer;
  traverse(parser.parse('(' + source + ')'), {CallExpression(entry) {
    if (entry.node.arguments[0]?.name === 'hk' && entry.node.arguments[1]?.type === 'ObjectExpression') {
      assert.equal(footer, undefined, 'A single camera-cut footer must exist'); footer = entry.node;
    }
  }});
  assert.ok(footer, 'Camera-cut footer call is missing');
  source = source.slice(0, footer.start - 1) + '(0,i.jsx)(__LocalCameraShotFooter,{controller:__localCameraShots})' + source.slice(footer.end - 1);
  factories['53401'] = source;
};
