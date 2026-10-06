const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

module.exports = function patchSkeletalKeyframes(factories) {
  let source = factories['53401'];
  const replace = (label,before,after) => {
    assert.equal(source.split(before).length,2,'Skeletal keyframes anchor: '+label);
    source=source.replace(before,after);
  };
  replace('helpers','function le(e,t,r,a,i){',fs.readFileSync(path.join(__dirname,'skeletal-keyframes-runtime.js'),'utf8')+'\nfunction le(e,t,r,a,i){');
  replace('evaluate authored bones','function le(e,t,r,a,i){var n,o,s,l,c;',
    'function le(e,t,r,a,i){var n,o,s,l,c;let __boneSample=__localSampleBoneClip(e,__localBoneLocalTime(e,t/r));if(__boneSample)return __boneSample;');
  replace('derive current continuation anchors','function lB(e){var t,r,a;',
    'function lB(e){e={...e,timeline:{...e.timeline,clips:__localLinkContinuationClips(e.timeline.clips,e.timeline.displayFps)}};var t,r,a;');
  replace('hold final continuation pose','if (!clip || clip.locomotionMode',
    'if (clip?.poseContinuation) return {kind:"single",objectId:group.objectId,clip,timelineFrame:completed.endFrame};\n  if (!clip || clip.locomotionMode');
  replace('blend after held gaps','l=!!(n&&n.endFrame===a.frameClip.startFrame);',
    'l=!!(n&&(n.endFrame===a.frameClip.startFrame||n.clip.poseContinuation&&n.endFrame<a.frameClip.startFrame));');
  replace('use exact last authored pose','from:{clip:n.clip,timelineFrame:n.endFrame-1}',
    'from:{clip:n.clip,timelineFrame:n.endFrame-(n.clip.poseContinuation?0:1)}');
  replace('preserve blend before cut','o=Math.min(a.frameClip.durationFrames,a.frameClip.transitionInFrames),s=t-a.frameClip.startFrame',
    'o=a.clip.poseCutTransitionFrames??Math.min(a.frameClip.durationFrames,a.frameClip.transitionInFrames),s=t-a.frameClip.startFrame');
  replace('capture normalization frame rate','d=Math.round(iq(e.displayFps,1,120,o.displayFps)),u=[]',
    'd=Math.round(iq(e.displayFps,1,120,o.displayFps)),__localClipFps=d,u=[]');
  replace('one frame cuts survive normalization','durationSec:iq(e.durationSec,.05,3600,1)',
    'durationSec:iq(e.durationSec,Math.min(.05,1/__localClipFps),3600,1)');
  replace('stage normalization','return r&&(u.customPose=r),l&&(u.motionName=l),[u]',
    'return r&&(u.customPose=r),l&&(u.motionName=l),Object.assign(u,__localBoneClipData(e)),[u]');
  replace('document pose encode','kind:"custom-pose",pose:kN(e.customPose),...t,',
    'kind:"custom-pose",pose:kN(e.customPose),...__localBoneClipData(e),...t,');
  replace('document motion encode','let a={id:r.id,objectId:r.objectId,motion:(t=e.source,',
    'let a={...__localBoneClipData(e),id:r.id,objectId:r.objectId,motion:(t=e.source,');
  replace('document pose decode','source:"builtin",customPose:kN(e.pose),motionName:e.motionName,',
    'source:"builtin",customPose:kN(e.pose),...__localBoneClipData(e),motionName:e.motionName,');
  replace('retain trimmed skeletal pose offset','startFrame:r.startFrame,sourceInFrame:0,durationFrames:r.durationFrames',
    'startFrame:r.startFrame,sourceInFrame:e.boneKeyframes?.length?r.sourceInFrame:0,durationFrames:r.durationFrames');
  replace('restore trimmed skeletal pose offset','startTimeSec:r0(e.startFrame,d),offsetTimeSec:0,durationSec:r0(e.durationFrames,d)',
    'startTimeSec:r0(e.startFrame,d),offsetTimeSec:e.boneKeyframes?.length?r0(e.sourceInFrame,d):0,durationSec:r0(e.durationFrames,d)');
  replace('document motion decode','let r={id:e.id,objectId:e.objectId,motionId:e.motion.resourceId,',
    'let r={...__localBoneClipData(e),id:e.id,objectId:e.objectId,motionId:e.motion.resourceId,');
  replace('capture evaluated bones','objectTransforms:t,jointTransforms:i}}catch{return null}finally',
    'objectTransforms:t,jointTransforms:i,skeletalPoses:Object.fromEntries([...e.runtimes.entries()].flatMap(([id,runtime])=>{const pose=__localCaptureRuntimePose(runtime);return pose?[[id,pose]]:[]}))}}catch{return null}finally');
  replace('workspace hook','d0=(0,n.useCallback)(()=>{var e,t,r;if(!rC)return!1;',
    '__localBoneTools=__localUseBoneEditing({state:iK,session:rC,setSession:rI,controller:$,sampleFrame:oZ.sampleFrame,seek:nP,stop:dN,select:iE,commit:sQ,finish:dY,notice:iT,scope:S,openMotion:id=>ue(id)}),d0=(0,n.useCallback)(()=>{var e,t,r;if(rC?.boneAnimation)return __localBoneTools.save();if(!rC)return!1;');
  replace('joint gesture dirty','{...t,jointTransforms:{...t.jointTransforms,...e}}:t)',
    '__localIsBoneAnchor(t)?t:{...t,boneDirty:!!t.boneAnimation,jointTransforms:{...t.jointTransforms,...e}}:t)');
  replace('joint inspector dirty','{...e,jointTransforms:t.jointTransforms,lockedJointIds:t.lockedJointIds}:e)',
    '__localIsBoneAnchor(e)?e:{...e,boneDirty:!!e.boneAnimation,jointTransforms:t.jointTransforms,lockedJointIds:t.lockedJointIds}:e)');
  replace('save hook dependency','[dY,sQ,Q.customPoseAdded,Q.customPoseSaved,Q.motionPickerCustomPoseName,Q.poseCopyNoTarget,dH,rC,nG,nP,iT])',
    '[__localBoneTools,dY,sQ,Q.customPoseAdded,Q.customPoseSaved,Q.motionPickerCustomPoseName,Q.poseCopyNoTarget,dH,rC,nG,nP,iT])');
  replace('avoid static pose overwrite','sd=(null==rC?void 0:rC.clipId)?',
    'sd=!rC?.boneAnimation&&(null==rC?void 0:rC.clipId)?');
  replace('editor title','children:Q.customPoseEditorTitle}',
    'children:rC.boneAnimation?"\\u7f16\\u8f91\\u9aa8\\u9abc\\u52a8\\u753b":Q.customPoseEditorTitle}');
  replace('compact bone help','className:"mt-1 text-[10px] leading-4 text-content-muted",children:Q.customPoseEditorHint',
    'className:rC.boneAnimation?"hidden":"mt-1 text-[10px] leading-4 text-content-muted",children:Q.customPoseEditorHint');
  replace('compact name','children:Q.customPoseEditorName}),(0,i.jsx)("input",{"aria-label":Q.customPoseEditorName,value:rC.displayName,',
    'children:rC.boneAnimation?"\\u540d\\u79f0":Q.customPoseEditorName}),(0,i.jsx)("input",{"aria-label":Q.customPoseEditorName,style:rC.boneAnimation?{width:84}:void 0,value:rC.displayName,');
  replace('compact duration','children:Q.customPoseEditorDuration}),(0,i.jsx)("input",{"aria-label":Q.customPoseEditorDuration,type:"number",',
    'children:rC.boneAnimation?"\\u65f6\\u957f":Q.customPoseEditorDuration}),(0,i.jsx)("input",{"aria-label":Q.customPoseEditorDuration,style:rC.boneAnimation?{width:64}:void 0,type:"number",');
  replace('editor controls','children:Q.customPoseEditorHint})]})}),(0,i.jsxs)("div",{className:"mt-3 flex flex-wrap',
    'children:Q.customPoseEditorHint})]})}),rC.boneAnimation?(0,i.jsx)(__LocalBoneEditor,{session:rC,fps:iK.timeline.displayFps,onTime:__localBoneTools.time,onRecord:__localBoneTools.record,onDelete:__localBoneTools.remove}):(0,i.jsx)("button",{type:"button",className:__localPoseButtonClass,onClick:__localBoneTools.convert,children:"\\u8f6c\\u4e3a\\u9aa8\\u9abc\\u52a8\\u753b"}),(0,i.jsxs)("div",{className:"mt-3 flex flex-wrap');
  replace('local animated motion save','return __localCreatePoseMotion({pose:$.current?.copyPose(),target,',
    'if(rC?.boneAnimation)return __localCreateSkeletalMotion(rC,$.current?.copyPose(),target,i$.find(motion=>motion.id===rC.localPoseId),iK.timeline.displayFps);return __localCreatePoseMotion({pose:$.current?.copyPose(),target,');
  replace('export frame rate','[iK.objects,rC,oP,i$]', '[iK.objects,iK.timeline.displayFps,rC,oP,i$]');
  replace('persist animated motion','if (!normalized || !__localIsStaticPoseMotion(normalized)) throw Error(',
    'if (!normalized) throw Error(');
  replace('locked clip label','let u=tl.get(t.id),m=t.transitionInFrames??8,',
    'if(t.poseLock)d="[\\u5b9a\\u683c] "+d;let u=tl.get(t.id),m=t.transitionInFrames??8,');
  replace('locked clip state','"data-motion-clip-id":t.id,"data-custom-pose-clip":',
    '"data-motion-clip-id":t.id,"data-pose-locked":t.poseLock?"true":void 0,"data-pose-continuation":t.poseContinuation?"true":void 0,"data-custom-pose-clip":');
  replace('action context menu','onPointerDown:e=>tZ(e,t,"move"),className:',
    'onContextMenu:event=>{event.preventDefault();event.stopPropagation();X(t.id);tt({clipId:t.id,anchor:event.currentTarget})},onPointerDown:e=>tZ(e,t,"move"),className:');
  replace('protect continuation left edge','"aria-label":`${d} start`,onPointerDown:e=>tZ(e,t,"start"),',
    '"aria-label":`${d} start`,disabled:!!t.poseContinuation,style:t.poseContinuation?{pointerEvents:"none",opacity:0}:void 0,onPointerDown:e=>tZ(e,t,"start"),');
  replace('join at requested boundary','k=r4(t.timeline.clips,w,{displayFps:t.timeline.displayFps,requestedStartFrame:v,placement:i})',
    'k=r4(t.timeline.clips,w,{displayFps:t.timeline.displayFps,requestedStartFrame:v,placement:t.timeline.clips.some(clip=>clip.objectId===l.id&&clip.poseContinuation&&r_((clip.startTimeSec+clip.durationSec),t.timeline.displayFps)===v)?"exact":i})');
  replace('skeletal clip classification','f="path-traversal"===r.motionUsage,h=function(e){',
    'f="path-traversal"===r.motionUsage,h=r.boneKeyframes?.length?(r.poseContinuation?"\\u59ff\\u52bf\\u63a5\\u7eed":"\\u9aa8\\u9abc\\u52a8\\u753b"):function(e){');
  replace('single skeletal edit command','({poseClip:g,pathTraversal:f,copy:s}),v=c?',
    '({poseClip:g,pathTraversal:f,copy:s}),v=c&&!r.boneKeyframes?.length?');
  replace('visible Mixamo import','"mine"===T&&(0,i.jsxs)(i.Fragment,{children:[(0,i.jsx)("input",{ref:V,type:"file",accept:".fbx,.json,.octomotion.json,application/json",',
    '(0,i.jsxs)(i.Fragment,{children:[(0,i.jsx)("input",{ref:V,type:"file",accept:".fbx,.json,.octomotion.json,application/json",');
  replace('timeline callbacks','onEditPoseClip:q,onSetMotionClipLoop:Y,',
    'onEditPoseClip:q,boneEditorSession:__localBoneSession,onEditBoneClip:__localEditBone,onLockPoseClip:__localLockPose,onJoinMotionClip:__localJoinMotion,onContinuationSettings:__localContinuationSettings,onDeleteBoneKey:__localDeleteBone,onMoveBoneKey:__localMoveBone,onSetMotionClipLoop:Y,');
  replace('workspace timeline callbacks','onEditPoseClip:d_,onSetMotionClipLoop:dB,',
    'onEditPoseClip:id=>{const clip=iK.timeline.clips.find(clip=>clip.id===id);clip?.boneKeyframes?.length?__localBoneTools.begin(clip.objectId,id,ek.current):d_(id)},boneEditorSession:rC,onEditBoneClip:(id,time)=>{const clip=__localBoneEditorClip(iK.timeline.clips.find(clip=>clip.id===id)||(rC?.draftClip?.id===id?rC.draftClip:undefined),rC);if(clip)__localBoneTools.begin(clip.objectId,id,time===undefined?ek.current:clip.startTimeSec+time)},onLockPoseClip:id=>__localBoneTools.lock(id,ek.current),onJoinMotionClip:__localBoneTools.join,onContinuationSettings:__localBoneTools.settings,onDeleteBoneKey:__localBoneTools.deleteKey,onMoveBoneKey:__localBoneTools.moveKey,onSetMotionClipLoop:dB,');
  replace('settings callbacks','onLoopChange:l,onEditPose:c,onClose:d}=e,',
    'onLoopChange:l,onEditPose:c,onEditBones:__localEditBones,onLockPose:__localLockPose,onJoinMotion:__localJoinMotion,onContinuationSettings:__localContinuationSettings,displayFps:__localFps,onClose:d}=e,');
  replace('settings tools','children:s.pathLoopHint})]})]}),b)}',
    'children:s.pathLoopHint})]}),__localEditBones&&(0,i.jsx)(__LocalBoneClipTools,{clip:r,fps:__localFps,onEdit:__localEditBones,onLock:__localLockPose,onJoin:__localJoinMotion,onSettings:__localContinuationSettings})]}),b)}');
  replace('settings wiring','onEditPose:q?()=>{tt(void 0),q(td.id)}:void 0,onClose:',
    'displayFps:g.displayFps,onEditBones:__localEditBone?()=>{tt(void 0);__localEditBone(td.id)}:void 0,onLockPose:()=>{tt(void 0);__localLockPose(td.id)},onJoinMotion:()=>{tt(void 0);__localJoinMotion(td.id)},onContinuationSettings:values=>__localContinuationSettings(td.id,values),onEditPose:q?()=>{tt(void 0),q(td.id)}:void 0,onClose:');
  // Place markers outside the clipped label so both their hit areas and handles remain usable.
  replace('clip marker layer','bg-white/0 hover:bg-white/28"})]},t.id)})),',
    'bg-white/0 hover:bg-white/28"}),"object-action"===e.kind&&(0,i.jsx)(__LocalBoneMarkers,{clip:t,session:__localBoneSession,fps:g.displayFps,pixelsPerFrame:th.pixelsPerFrame,onMove:(id,time)=>__localMoveBone(t.id,id,time),onEdit:time=>__localEditBone(t.id,time),onDelete:id=>__localDeleteBone(t.id,id)})]},t.id)})),');
  replace('live draft clip','motionClipDraft:(null==rC?void 0:rC.clipId)||null==rC?void 0:rC.draftClip,',
    'motionClipDraft:rC&&!rC.clipId?__localBoneEditorClip(rC.draftClip,rC):void 0,');
  replace('draft marker prop','function hd(e){let{draftId:t,label:r,leftPx:a,widthPx:n,',
    'function hd(e){let{boneMarkers:__localDraftBoneMarkers,draftId:t,label:r,leftPx:a,widthPx:n,');
  replace('draft marker layer','"data-motion-clip-draft":t,"data-timeline-draft":"true","data-timeline-interaction-layer":"clips","data-timeline-layer-z":10,className:"absolute top-1 z-20 h-7 min-w-5",style:{left:`${a}px`,width:`${Math.max(1,n)}px`},children:[',
    '"data-motion-clip-draft":t,"data-timeline-draft":"true","data-timeline-interaction-layer":"clips","data-timeline-layer-z":10,className:"absolute top-1 z-20 h-7 min-w-5",style:{left:`${a}px`,width:`${Math.max(1,n)}px`},children:[__localDraftBoneMarkers,');
  replace('draft marker wiring','(0,i.jsx)(hd,{draftId:k.id,label:u,leftPx:d.left,widthPx:d.width,',
    '(0,i.jsx)(hd,{draftId:k.id,label:u,leftPx:d.left,widthPx:d.width,boneMarkers:"object-action"===e.kind&&(0,i.jsx)(__LocalBoneMarkers,{clip:k,session:__localBoneSession,fps:g.displayFps,pixelsPerFrame:th.pixelsPerFrame,onMove:(id,time)=>__localMoveBone(k.id,id,time),onEdit:time=>__localEditBone(k.id,time),onDelete:id=>__localDeleteBone(k.id,id)}),');
  // Project only the rendered strip; drag commands retain their committed clip as the baseline.
  replace('live saved strip','r.map(t=>{var r;let a=r_(t.startTimeSec,g.displayFps)',
    'r.map(t=>{var r;const __localSavedBoneClip=t;t=__localBoneEditorClip(t,__localBoneSession);let a=r_(t.startTimeSec,g.displayFps)');
  for(const edge of ['move','start','end']) replace('saved strip drag '+edge,'onPointerDown:e=>tZ(e,t,"'+edge+'"),',
    'onPointerDown:e=>tZ(e,__localSavedBoneClip,"'+edge+'"),');
  replace('action row key button','children:V}):V,__localKeyProps&&',
    'children:V}):V,"object-action"===u.kind&&__localKeyProps?.onEditBones&&(0,i.jsx)("button",{type:"button",className:"grid size-6 shrink-0 place-items-center rounded-md text-content-secondary hover:bg-surface-hover",title:"\\u6dfb\\u52a0\\u9aa8\\u9abc\\u5173\\u952e\\u5e27","aria-label":"\\u6dfb\\u52a0\\u9aa8\\u9abc\\u5173\\u952e\\u5e27",onClick:event=>{event.stopPropagation();__localKeyProps.onEditBones(u.object.id)},children:(0,i.jsx)(__localBoneKeyIcon,{size:13})}),__localKeyProps&&');
  replace('row callback prop','onRecordRowKeyframe:__localRecordRow,manualKeyEditable:',
    'onBeginObjectBoneEdit:__localBeginObjectBone,onRecordRowKeyframe:__localRecordRow,manualKeyEditable:');
  replace('row callback wiring','manualKeyProps:{clock:k,playback:S,editable:',
    'manualKeyProps:{onEditBones:__localBeginObjectBone,clock:k,playback:S,editable:');
  replace('workspace row callback','onRecordRowKeyframe:__localRow=>{',
    'onBeginObjectBoneEdit:objectId=>{if(rC?.boneAnimation&&rC.objectId===objectId){__localBoneTools.record();return}const clip=iK.timeline.clips.find(clip=>clip.objectId===objectId&&ek.current>=clip.startTimeSec&&ek.current<clip.startTimeSec+clip.durationSec);__localBoneTools.begin(objectId,clip?.id,ek.current)},onRecordRowKeyframe:__localRow=>{');
  replace('seek while editing','onTimeChange:e=>{t8(!1),nP(e)},onEditPoseClip:',
    'onTimeChange:e=>{t8(!1);rC?.boneAnimation?__localBoneTools.time(e-rC.startTimeSec):nP(e)},onEditPoseClip:');
  replace('bone marker owns delete key','if(S||d)return;if(P)return void function(e,t,r){',
    'if(S||d)return;if(g_(e)&&e.target?.closest?.("[data-bone-key-id]"))return;if(P)return void function(e,t,r){');
  factories['53401']=source;
};
