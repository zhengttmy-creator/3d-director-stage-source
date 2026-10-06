const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

module.exports = function patchPoseLibrary(factories) {
  let source = factories['53401'];
  const changes = [];
  const replace = (label, before, after) => {
    assert.equal(source.split(before).length, 2, 'Pose library patch anchor: ' + label);
    source = source.replace(before, after);
    changes.push(label);
  };
  replace('pose helpers', 'function p4(e){', fs.readFileSync(path.join(__dirname, 'pose-library-runtime.js'), 'utf8') + '\nfunction p4(e){');
  replace('pose persistence hook output', 'return{savedMotions:h,hydrated:b,saveMotion:q,', `let __localCommitPose=(0,n.useCallback)(async request=>{
    if(!b||f.current)throw Error("\\u672c\\u5730\\u52a8\\u4f5c\\u5e93\\u6b63\\u5728\\u5904\\u7406");
    p.current?.abort();const controller=new AbortController;f.current=controller;H(true);
    try{const storage={motions:h,port:window.localDirectorMotionLibrary,operation:m.current,compact:wR,signal:controller.signal,isCurrent:()=>d.current===c,onSaved:v};return await (request.kind==="save"?__localPersistPoseMotion({...storage,motion:request.motion}):__localManagePoseMotion({...storage,...request,inUseMotionIds:new Set(i.map(clip=>clip.motionId))}));}
    finally{if(f.current===controller){f.current=void 0;H(false);}}
  },[b,h,c,i]);return{savePoseMotion:motion=>__localCommitPose({kind:"save",motion}),renamePoseMotion:(id,name)=>__localCommitPose({kind:"rename",id,name}),deletePoseMotion:id=>__localCommitPose({kind:"delete",id}),savedMotions:h,hydrated:b,saveMotion:q,`);
  replace('workspace pose persistence hook', '{savedMotions:i$,hydrated:i0,renameSavedMotion:i1,', '{savedMotions:i$,savePoseMotion:__localSavePoseMotion,renamePoseMotion:__localRenamePoseMotion,deletePoseMotion:__localDeletePoseMotion,hydrated:i0,renameSavedMotion:i1,');
  replace('pose workspace commands', 'd0=(0,n.useCallback)(()=>{var e,t,r;if(!rC)', `__localReadPose=(0,n.useCallback)(()=>{
    const target=iK.objects.find(object=>object.id===(rC?.objectId??oP?.id));
    return __localCreatePoseMotion({pose:$.current?.copyPose(),target,name:rC?.displayName??((target?.name??"\\u4eba\\u7269")+" \\u59ff\\u52bf"),durationSec:rC?.durationSec??1,existing:i$.find(motion=>motion.id===rC?.localPoseId)});
  },[iK.objects,rC,oP,i$]),__localStorePose=(0,n.useCallback)(async()=>{
    const capturedSession=rC;
    const motion=await __localSavePoseMotion(__localReadPose());
    rI(previous=>__localAttachSavedPoseSession(previous,capturedSession,motion.id));
    iT("\\u59ff\\u52bf\\u5df2\\u4fdd\\u5b58\\u5230\\u672c\\u5730");return motion;
  },[__localReadPose,__localSavePoseMotion,iT,rC]),__localExportPose=(0,n.useCallback)(()=>{i7(__localReadPose());return true;},[__localReadPose,i7]),d0=(0,n.useCallback)(()=>{var e,t,r;if(!rC)`);
  replace('custom pose editor commands', 'children:[(0,i.jsx)("button",{type:"button",onClick:d0,', 'children:[(0,i.jsx)(__LocalPoseCommands,{scope:"editor",onSave:__localStorePose,onExport:__localExportPose,disabled:!i0||nu}),(0,i.jsx)("button",{type:"button",onClick:d0,');
  replace('picker pose command props', 'onCreateCustomPose:oP?md:void 0}', 'onCreateCustomPose:oP?md:void 0,onSaveLocalPose:__localStorePose,onExportLocalPose:motion=>i7(motion),onRenameLocalPose:async(id,name)=>{await __localRenamePoseMotion(id,name);iT("\\u59ff\\u52bf\\u5df2\\u91cd\\u547d\\u540d")},onDeleteLocalPose:async id=>{await __localDeletePoseMotion(id);iT("\\u672c\\u5730\\u59ff\\u52bf\\u5df2\\u5220\\u9664")}}');
  replace('picker pose command bindings', 'onCreateCustomPose:A,onImportMotion:localImport}=e,w=', 'onCreateCustomPose:A,onImportMotion:localImport,onSaveLocalPose:localSavePose,onExportLocalPose:localExportPose,onRenameLocalPose:localRenamePose,onDeleteLocalPose:localDeletePose}=e,w=');
  replace('picker pose source state', 'let[S,P]=(0,n.useState)("pose"===r?"static-pose":"motion"),', 'let[localPoseSource,setLocalPoseSource]=(0,n.useState)("poses");let[S,P]=(0,n.useState)("pose"===r?"static-pose":"motion"),');
  replace('saved pose card metadata', 'source:"mine",name:e.name,meta:o.motionLibrarySourceLabels[e.source],durationSec:e.durationSec,previewFps:pe(e)', 'source:"mine",name:e.name,localPose:__localIsStaticPoseMotion(e),meta:o.motionLibrarySourceLabels[e.source],durationSec:e.durationSec,previewFps:pe(e)');
  replace('picker static catalog filtering', 'G="preset"===j?B.preset:B.mine,U=I?z:void 0,', 'G=("preset"===j?B.preset:B.mine).filter(entry=>{const pose=entry.localPose||__localIsPoseCatalog(entry.catalogAsset);return "static-pose"===S?("poses"===localPoseSource?pose:!pose):!pose}),U=I?z:void 0,');
  replace('fixed pose preset direct insert', 'q=(e,t)=>{if("path-traversal"===r||"motion"===S)', 'q=(e,t)=>{if("static-pose"===S&&__localIsPoseCatalog(e.catalogAsset)){k.current.open&&k.current.editable&&!k.current.applying&&y({kind:"static-pose",selection:t,sourceTimeSec:0});return}if("path-traversal"===r||"motion"===S)');
  replace('pose toolbar', '(0,i.jsxs)("div",{className:"flex min-h-0 flex-1 flex-col",children:[(0,i.jsxs)("div",{className:"flex items-end justify-between gap-4 px-5 pt-4",', '"static-pose"===S&&(0,i.jsx)(__LocalPosePickerTools,{source:localPoseSource,onSource:value=>{W();setLocalPoseSource(value)},onSave:localSavePose,onRead:localImport?file=>{W();g(false);localImport(file)}:void 0,onExport:I?.kind==="saved"&&localExportPose?()=>localExportPose(u.find(motion=>motion.id===I.id)):void 0,selected:I?.kind==="saved"?u.find(motion=>motion.id===I.id):void 0,onRename:localRenamePose,onDelete:localDeletePose,onClear:W,disabled:!a||o||!m}),(0,i.jsxs)("div",{className:"flex min-h-0 flex-1 flex-col",children:[(0,i.jsxs)("div",{className:"flex items-end justify-between gap-4 px-5 pt-4",');
  replace('separate static and dynamic counts', 'label:p.motionPickerPresetTab,count:O.total,onSelect:()=>Q("preset")', 'label:p.motionPickerPresetTab,count:"preset"===j?O.assets.filter(asset=>"static-pose"===S&&"poses"===localPoseSource?__localIsPoseCatalog(asset):!__localIsPoseCatalog(asset)).length:void 0,onSelect:()=>Q("preset")');
  replace('my pose tab label and count', 'label:p.motionPickerMineTab,count:u.length,onSelect:()=>Q("mine")', 'label:"static-pose"===S&&"poses"===localPoseSource?"\\u6211\\u7684\\u59ff\\u52bf":p.motionPickerMineTab,count:u.filter(motion=>"static-pose"===S&&"poses"===localPoseSource?__localIsStaticPoseMotion(motion):!__localIsStaticPoseMotion(motion)).length,onSelect:()=>Q("mine")');
  replace('avoid duplicate static import entry', '"mine"===j&&localImport&&(0,i.jsx)("span",', '"mine"===j&&"static-pose"!==S&&localImport&&(0,i.jsx)("span",');
  replace('fixed pose presets do not need frame scrubbing', '"path-traversal"!==r&&"static-pose"===S&&(0,i.jsx)(p7,', '"path-traversal"!==r&&"static-pose"===S&&("frames"===localPoseSource||"mine"===j)&&(0,i.jsx)(p7,');
  replace('my pose preview terminology', 'sourceTimeSec:R,copy:p,previewCanvasSource:v,', 'sourceTimeSec:R,copy:"poses"===localPoseSource?{...p,motionPickerSelectMotionHint:"\\u9009\\u62e9\\u59ff\\u52bf",motionLibraryPreview:"\\u59ff\\u52bf\\u9884\\u89c8",motionPickerFrame:()=>"\\u9759\\u6001\\u59ff\\u52bf"}:p,previewCanvasSource:v,');
  replace('pose header title', 'children:[p.motionPickerFromMotion,(0,i.jsx)(ui.A,', 'children:["poses"===localPoseSource?"\\u59ff\\u52bf\\u9884\\u8bbe":p.motionPickerFromMotion,(0,i.jsx)(ui.A,');
  replace('remove fixed pose frame hint', '(0,i.jsx)("span",{className:"mt-1 block text-[9px] leading-4 text-content-secondary",children:p.motionPickerFromMotionDescription})', '"poses"!==localPoseSource&&(0,i.jsx)("span",{className:"mt-1 block text-[9px] leading-4 text-content-secondary",children:p.motionPickerFromMotionDescription})');
  replace('pose library title', '(0,i.jsx)("h3",{className:"text-[11px] font-medium text-content-secondary",children:p.motionPickerLibraryTitle})', '(0,i.jsx)("h3",{className:"text-[11px] font-medium text-content-secondary",children:"static-pose"===S&&"poses"===localPoseSource?"\\u59ff\\u52bf\\u5e93":p.motionPickerLibraryTitle})');
  replace('remove fixed pose library hint', '(0,i.jsx)("p",{className:"mt-1 text-[9px] text-content-muted",children:"static-pose"===S&&"path-traversal"!==r?p.motionPickerFromMotionDescription:p.motionLibraryHint})', '!("static-pose"===S&&"poses"===localPoseSource)&&(0,i.jsx)("p",{className:"mt-1 text-[9px] text-content-muted",children:"static-pose"===S&&"path-traversal"!==r?p.motionPickerFromMotionDescription:p.motionLibraryHint})');
  replace('pose search accessible label', '"aria-label":p.motionLibrarySearch,value:s,', '"aria-label":"static-pose"===S&&"poses"===localPoseSource?"\\u641c\\u7d22\\u59ff\\u52bf":p.motionLibrarySearch,value:s,');
  replace('pose search placeholder', 'placeholder:p.motionLibrarySearch,className:', 'placeholder:"static-pose"===S&&"poses"===localPoseSource?"\\u641c\\u7d22\\u59ff\\u52bf":p.motionLibrarySearch,className:');
  replace('keep JSON download URL alive', 'a.click(),URL.revokeObjectURL(r)},[]),Z=(0,n.useCallback)', 'a.click(),window.setTimeout(()=>URL.revokeObjectURL(r),60000)},[]),Z=(0,n.useCallback)');
  factories['53401'] = source;
  return {moduleId: '53401', changes};
};
