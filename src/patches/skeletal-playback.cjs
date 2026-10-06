const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

module.exports = function patchSkeletalPlayback(factories) {
  let source=factories['53401'];
  const replace=(label,before,after)=>{
    assert.equal(source.split(before).length,2,'Skeletal playback anchor: '+label);
    source=source.replace(before,after);
  };
  replace('helpers','function __localBoneEditorClip(clip, session) {',
    fs.readFileSync(path.join(__dirname,'skeletal-playback-runtime.js'),'utf8')+'\nfunction __localBoneEditorClip(clip, session) {');
  replace('preview timeline','oZ=(0,n.useMemo)(()=>lB({sceneCamera:oD.sceneCamera,sceneObjects:iX.objects,timeline:iX.timeline,',
    '__localBonePlaybackActive=hC(tZ)&&!!rC?.boneAnimation,__localBonePreviewTimeline=(0,n.useMemo)(()=>__localBonePlaybackTimeline(iX.timeline,rC),[iX.timeline,rC]),oZ=(0,n.useMemo)(()=>lB({sceneCamera:oD.sceneCamera,sceneObjects:iX.objects,timeline:__localBonePreviewTimeline,');
  replace('preview evaluator dependencies','[il,iX.objects,iX.timeline,oD.cameraCutTrack,oD.cameraId,oD.sceneCamera,nh,i$])',
    '[il,iX.objects,__localBonePreviewTimeline,oD.cameraCutTrack,oD.cameraId,oD.sceneCamera,nh,i$])');
  replace('animated sample visible','if(!rC||"performance"!==ej)return sl;',
    'if(!rC||__localBonePlaybackActive||"performance"!==ej)return sl;');
  replace('animated sample dependency','[sl,rC,ej])','[sl,rC,ej,__localBonePlaybackActive])');
  replace('playback object mode','e=rC?"pose":"object",t=rC?iK.selectedJointId:void 0,r=(null==rC?void 0:rC.jointTransforms)??w3,',
    'e=rC&&!__localBonePlaybackActive?"pose":"object",t=rC&&!__localBonePlaybackActive?iK.selectedJointId:void 0,r=__localBonePlaybackActive?w3:(null==rC?void 0:rC.jointTransforms)??w3,');
  replace('viewport state dependency','[so.sceneCamera,ss,rC,iK,ej])',
    '[so.sceneCamera,ss,rC,iK,ej,__localBonePlaybackActive])');
  replace('controller playback','timelinePlayback:"performance"!==ej||rC?void 0:su,',
    'timelinePlayback:"performance"!==ej||rC&&!__localBonePlaybackActive?void 0:su,');
  replace('pose gizmo while playing','poseEditorActive:!!rC,','poseEditorActive:!!rC&&!__localBonePlaybackActive,');
  replace('editor playback property','__LocalBoneEditor,{session:rC,fps:iK.timeline.displayFps,',
    '__LocalBoneEditor,{session:rC,playing:__localBonePlaybackActive,fps:iK.timeline.displayFps,');
  replace('editor playback argument','function __LocalBoneEditor({session,fps,onTime,onRecord,onDelete}) {',
    'function __LocalBoneEditor({session,playing=false,fps,onTime,onRecord,onDelete}) {');
  replace('editor time while playing',"i.jsx('input',{type:'number',min:0,max:session.durationSec,step:1/fps,value:Number(session.keyTimeSec.toFixed(4)),",
    "i.jsx('input',{type:'number',disabled:playing,min:0,max:session.durationSec,step:1/fps,value:Number(session.keyTimeSec.toFixed(4)),");
  replace('previous key while playing','disabled:!previous,title:', 'disabled:playing||!previous,title:');
  replace('next key while playing','disabled:!next,title:', 'disabled:playing||!next,title:');
  replace('record key while playing',"disabled:anchor,'data-testid':'director-stage-record-bone-key',",
    "disabled:playing||anchor,'data-testid':'director-stage-record-bone-key',");
  replace('remove key while playing','disabled:!atKey||anchor,title:', 'disabled:playing||!atKey||anchor,title:');
  replace('row key pauses before recording','if(rC?.boneAnimation&&rC.objectId===objectId){__localBoneTools.record();return}',
    'if(rC?.boneAnimation&&rC.objectId===objectId){if(__localBonePlaybackActive){__localBonePlayback.toggle();return}__localBoneTools.record();return}');
  replace('preview hook','openMotion:id=>ue(id)}),d0=(0,n.useCallback)',
    'openMotion:id=>ue(id)}),__localBonePlayback=__localUseBonePlayback({session:rC,setSession:rI,store:tZ,active:__localBonePlaybackActive,timeRef:ek,seek:nP,tools:__localBoneTools,controller:$,fps:iK.timeline.displayFps,notice:iT,scope:S}),d0=(0,n.useCallback)');
  replace('play button','onTogglePlayback:()=>{if(!rC){',
    'onTogglePlayback:()=>{if(rC?.boneAnimation)return __localBonePlayback.toggle();if(!rC){');
  replace('keyboard dispatch','dispatchTimelineCommand:pl,dispatchHistoryNavigation:ch,',
    'dispatchTimelineCommand:command=>{if(rC?.boneAnimation&&command.type==="playback.toggle")return __localBonePlayback.toggle();pl(command)},dispatchHistoryNavigation:ch,');
  replace('keyboard dependencies','[ec,c7,dy,db,ps,ch,pl,uc,mW,c8,ul,dA,m4])',
    '[ec,c7,dy,db,ps,ch,pl,uc,mW,c8,ul,dA,m4,rC,__localBonePlayback])');
  replace('marker space','if(P)return void function(e,t,r){',
    'if(!P&&__localBonePlaybackSpace(e)){e.preventDefault();e.stopPropagation();if(!e.repeat)f.dispatchTimelineCommand({type:"playback.toggle"});return}if(P)return void function(e,t,r){');
  replace('editor playback bounds','store:tZ,clock:tY,timeRef:ek,durationSec:oV,loop:oR.loop,',
    'store:tZ,clock:tY,timeRef:ek,durationSec:rC?.boneAnimation?__localBonePlaybackBounds(rC).end:oV,loop:rC?.boneAnimation?false:oR.loop,');
  factories['53401']=source;
};
