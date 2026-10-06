const assert = require('node:assert/strict');

module.exports = function patchEmptyCameraUi(factories) {
  let source = factories['53401'];
  const replace = (label, before, after) => {
    assert.equal(source.split(before).length, 2, 'Empty camera UI anchor changed: ' + label);
    source = source.replace(before, after);
  };
  replace('timeline delete prop', 'onPreviewStoryboard:__localPreviewStoryboard,onChangeStoryboardTrack:B,',
    'onPreviewStoryboard:__localPreviewStoryboard,onDeleteStoryboardCamera:__localDeleteStoryboardCamera,onChangeStoryboardTrack:B,');
  replace('shot delete prop', 'onPreview:__localPreviewStoryboard,onChange:B,onSelectCamera:G,',
    'onPreview:__localPreviewStoryboard,onDeleteCamera:__localDeleteStoryboardCamera,onChange:B,onSelectCamera:G,');
  replace('workspace delete callback', 'onPreviewStoryboard:()=>{rr({kind:"storyboard"});re({kind:"storyboard"})},',
    'onDeleteStoryboardCamera:cameraId=>{if(!C||rC||cO)return false;dN();return c4(cameraId)},onPreviewStoryboard:()=>{if(!il.cameras.length)return;rr({kind:"storyboard"});re({kind:"storyboard"})},');
  replace('shot owns deletion shortcuts', 'if(g_(e)&&e.target?.closest?.("[data-bone-key-id]"))return;',
    'if(g_(e)&&e.target?.closest?.("[data-bone-key-id]"))return;if(!P&&g_(e)&&!gZ(e.target)&&e.target?.closest?.("[data-director-shot-keyboard]"))return;');
  replace('exit deleted camera views', 'ib(value=>value?co(value,document.cameras.map(camera=>camera.id)):value);',
    'if(!document.cameras.length){ag(false);ah(null);aw(false);ib(value=>{if(value)rT(value.assetPanelWasOpen);return null})}else ib(value=>value?co(value,document.cameras.map(camera=>camera.id)):value);');
  replace('empty camera view lifecycle', 'c9=(0,n.useCallback)(()=>{if(0===il.cameras.length)return;',
    '__localEmptyCameraViewEffect=(0,n.useEffect)(()=>{if(il.cameras.length)return;ag(false);ah(null);aw(false);ib(value=>{if(value)rT(value.assetPanelWasOpen);return null})},[il.cameras.length,rT]),c9=(0,n.useCallback)(()=>{if(0===il.cameras.length)return;');
  replace('monitor creation', '?void 0:{visible:!0,collapsed:aA,rightInset:52*!rE,width:ak,label:',
    '?void 0:{visible:!0,empty:!il.cameras.length,addDisabled:!C||!!rC||cO,onAddCamera:()=>{if(C&&!rC&&!cO){dN();cI({kind:"current-view",presetId:"current-view"})}},collapsed:il.cameras.length?aA:false,rightInset:52*!rE,width:ak,label:');
  replace('monitor render guard', 'p.visible=!!((null==f?void 0:f.visible)&&!f.collapsed',
    'p.visible=!!((null==f?void 0:f.visible)&&!f.empty&&!f.collapsed');
  replace('empty monitor activation', 'type:"button",onClick:q.onActivate,className:',
    'type:"button",disabled:q.empty,onClick:q.onActivate,className:');
  replace('empty monitor label', 'children:j})]}),"pending"===J.monitorMode',
    'children:q.empty?"相机":j})]}),q.empty&&(0,i.jsx)("div",{"data-testid":"director-stage-camera-empty",className:"pointer-events-none absolute inset-0 z-[2] grid place-items-center bg-surface text-[12px] text-content-muted",children:"暂无相机"}),"pending"===J.monitorMode');
  replace('empty monitor dropdown', '!e.cameraPresetPlacement&&!e.cameraShotTargetPointPlacement&&q.options',
    '!q.empty&&!e.cameraPresetPlacement&&!e.cameraShotTargetPointPlacement&&q.options');
  replace('monitor toolbar', 'children:(0,i.jsx)("button",{type:"button",onClick:q.onToggleCollapsed,"aria-label":q.collapseLabel,',
    'children:(0,i.jsxs)(i.Fragment,{children:[q.onAddCamera&&(0,i.jsxs)("button",{type:"button",disabled:q.addDisabled,onClick:q.onAddCamera,"aria-label":"添加相机",title:"从当前导演视角添加相机","data-testid":"director-stage-monitor-add-camera","data-camera-monitor-drag-exclude":true,className:"flex h-6 shrink-0 items-center gap-1 rounded px-2 text-[11px] text-content outline-none hover:bg-surface-hover disabled:opacity-40",children:[(0,i.jsx)(mS.A,{size:13}),"添加相机"]}),(0,i.jsx)("button",{type:"button",onClick:q.onToggleCollapsed,"aria-label":q.collapseLabel,');
  replace('monitor toolbar close', 'children:(0,i.jsx)(up.A,{size:11})})}),(0,i.jsx)("div",{role:"slider",tabIndex:0,"aria-label":q.resizeLabel,',
    'children:(0,i.jsx)(up.A,{size:11})})]})}),(0,i.jsx)("div",{role:"slider",tabIndex:0,"aria-label":q.resizeLabel,');
  replace('empty collapse disabled', 'onClick:q.onToggleCollapsed,"aria-label":q.collapseLabel,',
    'onClick:q.onToggleCollapsed,disabled:q.empty,"aria-label":q.collapseLabel,');
  replace('capture disabled', 'captureCount:iK.captures.length,disabled:cO,onCapture:m6,',
    'captureCount:iK.captures.length,disabled:cO,captureDisabled:!il.cameras.length,onCapture:m6,');
  replace('capture button prop', 'captureCount:s=0,disabled:l=!1,onCapture:c,',
    'captureCount:s=0,disabled:l=!1,captureDisabled:__localNoCamera=!1,onCapture:c,');
  replace('capture button only', 'icon:cj.A,label:t,busy:a,disabled:l||a,onClick:c,',
    'icon:cj.A,label:t,busy:a,disabled:l||a||__localNoCamera,onClick:c,');
  replace('capture callback guard', 'm7=(0,n.useCallback)(async()=>{var e,t;if(aH)return;',
    'm7=(0,n.useCallback)(async()=>{var e,t;if(aH||!il.cameras.length)return;');
  replace('capture callback dependency', '[v,iO,a2,aH,Q.captureDefaultName,', '[il.cameras.length,v,iO,a2,aH,Q.captureDefaultName,');
  replace('export dialog guard', 'onExportVideo:()=>{var e;null==B',
    'onExportVideo:()=>{var e;if(!il.cameras.length)return;null==B');
  replace('export disabled', 'exportDisabled:sC,onClose:pb', 'exportDisabled:sC||!il.cameras.length,onClose:pb');
  replace('export existing dialog', 'open:sA,durationSec:oL.durationSec,', 'open:sA&&il.cameras.length>0,durationSec:oL.durationSec,');
  replace('export start guard', 'onStart:()=>{sF()},onCancel:sO,', 'onStart:()=>{if(il.cameras.length)sF()},onCancel:sO,');
  // The renderer keeps an internal camera for editor navigation, never an authored shot.
  replace('empty renderer handles', 'state:c2,runtimeObjectSources:rC?ss:iK.objects,',
    'state:il.cameras.length?c2:{...c2,sceneCamera:{...c2.sceneCamera,cameraHelperVisible:false,targetHelperVisible:false}},runtimeObjectSources:rC?ss:iK.objects,');
  replace('only show authored camera models', 'r.cameraModel.visible=w||!c&&A.showCameraModel,',
    'r.cameraModel.visible=w||!c&&A.showCameraModel&&(!Array.isArray(t.shotCameras)||t.shotCameras.some(camera=>camera.id===r.cameraId)),');
  replace('empty evaluator camera collection', 'sceneCamera:r.sample(a)}}):[{cameraId:e.sceneCamera.id,sceneCamera:m.sample(a)}]',
    'sceneCamera:r.sample(a)}}):e.multiCamera?[]:[{cameraId:e.sceneCamera.id,sceneCamera:m.sample(a)}]');
  factories['53401'] = source;
};
