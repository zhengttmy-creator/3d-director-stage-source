const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

module.exports = function patchBackgroundUpload(factories) {
  let source = factories['53401'];
  const replace = (label, before, after) => {
    assert.equal(source.split(before).length, 2, 'Background upload patch anchor: ' + label);
    source = source.replace(before, after);
  };
  const runtime = fs.readFileSync(path.join(__dirname, 'background-upload-runtime.js'), 'utf8');
  replace('local catalog',
    'function cA(e){let{images:t,query:r,copy:a,editable:o,onChoose:s}=e,c=(0,ch.u)()',
    'const __localBackgroundUploadIcon=r(55001),__localBackgroundCloseIcon=r(79829),__localBackgroundDeleteIcon=r(5501);\n' + runtime + '\n' +
    'function cA(e){let{images:originalImages,query:r,copy:a,editable:o,onChoose:s,canCloseBackground,onCloseBackground,onRemoveBackgroundAsset,backgroundEditingAllowed}=e,backgroundLibrary=__localUseBackgroundImages(originalImages),t=backgroundLibrary.images,c=(0,ch.u)()');
  replace('upload entry',
    '(0,i.jsx)("p",{className:"mb-director-stage-asset-inset text-dreamina-cn-12 text-content-muted",children:a.assetCanvasImages})',
    '(0,i.jsx)(__LocalBackgroundUpload,{library:backgroundLibrary,editable:o,empty:0===t.length,canCloseBackground,onCloseBackground})');
  replace('empty search',
    '!b&&!x&&0===v.length&&(0,i.jsx)("p",{role:"status",className:"py-director-stage-asset-empty-block text-center text-dreamina-cn-12 text-content-muted",children:r.trim()?a.assetEmpty:a.assetNoCanvasImages})',
    '!b&&!x&&0===v.length&&!!r.trim()&&(0,i.jsx)("p",{role:"status",className:"py-director-stage-asset-empty-block text-center text-dreamina-cn-12 text-content-muted",children:a.assetEmpty})');
  replace('asset panel close props',
    'onAddBackground:w,cameraTargetSelection:k,',
    'onAddBackground:w,canCloseBackground,onCloseBackground,onRemoveBackgroundAsset,backgroundEditingAllowed,cameraTargetSelection:k,');
  replace('background library close props',
    '(cA,{images:h,query:H,copy:u,editable:v,onChoose:',
    '(cA,{images:h,query:H,copy:u,editable:v,canCloseBackground,onCloseBackground,onRemoveBackgroundAsset,backgroundEditingAllowed,onChoose:');
  replace('close scene background',
    'onAddBackground:(e,t,r,a)=>{mN(e,t,r,a)},onActivateBackground:',
    'onAddBackground:(e,t,r,a)=>{mN(e,t,r,a)},canCloseBackground:!!(C&&!rC&&!cO&&iK.objects.some(object=>object.kind==="background"&&object.visible!==false)),onCloseBackground:()=>{if(!C||rC||cO)return;dN();sQ(state=>({...state,objects:state.objects.map(object=>object.kind==="background"&&object.visible!==false?{...object,visible:false}:object)}),"director.background.close");iE(selection=>{const selectedObjectIds=selection.selectedObjectIds.filter(id=>!iK.objects.some(object=>object.id===id&&object.kind==="background"));return selectedObjectIds.length===selection.selectedObjectIds.length?selection:{...selection,selectedObjectIds,selectedJointId:void 0}})},onActivateBackground:');
  replace('delete uploaded scene background',
    'onActivateBackground:e=>{sQ(t=>({...t,objects:t.objects.map(t=>"background"===t.kind?{...t,visible:t.id===e}:t)}),',
    'backgroundEditingAllowed:!!(C&&!rC&&!cO),onRemoveBackgroundAsset:assetId=>{dN();sQ(state=>({...state,objects:state.objects.map(object=>object.kind==="background"&&object.asset?.assetId===assetId&&object.visible!==false?{...object,visible:false}:object)}),"director.background.remove-upload");iE(selection=>{const selectedObjectIds=selection.selectedObjectIds.filter(id=>!iK.objects.some(object=>object.id===id&&object.kind==="background"&&object.asset?.assetId===assetId));return selectedObjectIds.length===selection.selectedObjectIds.length?selection:{...selection,selectedObjectIds,selectedJointId:void 0}})},onActivateBackground:e=>{sQ(t=>({...t,objects:t.objects.map(t=>"background"===t.kind?{...t,visible:t.id===e}:t)}),');
  replace('image wrapper',
    'children:v.slice(24*A,(A+1)*24).map(e=>(0,i.jsxs)(cf.rI,{children:[',
    'children:v.slice(24*A,(A+1)*24).map(e=>(0,i.jsxs)("div",{className:"local-background-image",children:[(0,i.jsxs)(cf.rI,{children:[');
  replace('image delete action',
    ']})]},e.nodeId))}),!b&&!x&&y>0',
    ']})]}),(0,i.jsx)(__LocalBackgroundDeleteButton,{image:e,library:backgroundLibrary,editable:o&&backgroundEditingAllowed,onRemoved:onRemoveBackgroundAsset})]},e.nodeId))}),!b&&!x&&y>0');
  factories['53401'] = source;
};
