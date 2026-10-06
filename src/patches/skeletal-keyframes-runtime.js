const __localBonePreviousIcon=r(11119).A, __localBoneNextIcon=r(80154).A, __localBoneKeyIcon=r(48934).A;

function __localNormalizeBonePose(value) {
  if (!value || typeof value.signature !== 'string' || !value.signature || !Array.isArray(value.rotations) || !value.rotations.length) return;
  const seen = new Set();
  const vector = value => value && ['x', 'y', 'z'].every(axis => Number.isFinite(value[axis]));
  const rotations = [];
  for (const item of value.rotations) {
    if (!item || !Number.isInteger(item.boneIndex) || item.boneIndex < 0 || seen.has(item.boneIndex) || !vector(item.rotation)) return;
    const q = item.bindWorldRotation;
    if (!vector(q) || !Number.isFinite(q.w) || Math.hypot(q.x, q.y, q.z, q.w) < 1e-8) return;
    seen.add(item.boneIndex);
    rotations.push({boneIndex:item.boneIndex, rotation:{...item.rotation}, bindWorldRotation:{x:q.x,y:q.y,z:q.z,w:q.w}});
  }
  if (value.rootTranslation !== undefined && !vector(value.rootTranslation)) return;
  return {signature:value.signature, rotations, ...(value.rootTranslation ? {rootTranslation:{...value.rootTranslation}} : {})};
}

function __localBoneClipData(clip) {
  const result = {};
  if (Array.isArray(clip.boneKeyframes)) {
    const times = new Map();
    for (const key of clip.boneKeyframes.slice(0, 2000)) {
      if (!key) continue;
      const pose = __localNormalizeBonePose(key.pose);
      if (pose && typeof key.id === 'string' && Number.isFinite(key.timeSec) && key.timeSec >= 0 && key.timeSec <= 30) {
        const timeSec = Math.round(key.timeSec * 1e7) / 1e7;
        times.set(timeSec, {id:key.id, timeSec, pose});
      }
    }
    const keys = [...times.values()].sort((a,b) => a.timeSec-b.timeSec);
    if (keys.length && keys.every(key => key.pose.signature === keys[0].pose.signature)) {
      result.boneKeyframes = keys;
      if (Number.isFinite(clip.boneTiming?.offsetTimeSec) && Number.isFinite(clip.boneTiming?.speed) && clip.boneTiming.speed>0) {
        result.boneTiming={offsetTimeSec:clip.boneTiming.offsetTimeSec,speed:clip.boneTiming.speed};
      }
    }
  }
  const locked = __localNormalizeBonePose(clip.poseLock?.pose);
  if (locked) result.poseLock = {timeSec:Number.isFinite(clip.poseLock.timeSec) ? clip.poseLock.timeSec : 0, pose:locked};
  const continuation = clip.poseContinuation;
  if (continuation && result.boneKeyframes?.some(key=>key.id===continuation.anchorKeyId)) {
    result.poseContinuation = {anchorKeyId:continuation.anchorKeyId,
      transitionFrames:rJ(continuation.transitionFrames),sourceClipId:String(continuation.sourceClipId||'')};
  }
  const anchor = __localNormalizeBonePose(clip.poseContinuationAnchor);
  if (anchor) result.poseContinuationAnchor = anchor;
  if (Number.isFinite(clip.poseCutTransitionFrames)) result.poseCutTransitionFrames=rJ(clip.poseCutTransitionFrames);
  return result;
}

function __localCutToPose(clips, clipId, timelineTime, pose, fps) {
  const clip = clips.find(item=>item.id===clipId);
  const clean = __localNormalizeBonePose(pose);
  if (!clip || !clean) throw Error('\u65e0\u6cd5\u8bfb\u53d6\u5f53\u524d\u52a8\u4f5c');
  const start = Math.round(clip.startTimeSec*fps), end = Math.round((clip.startTimeSec+clip.durationSec)*fps);
  const frame = Math.round(timelineTime*fps);
  if (frame<start || frame>=end || frame>=30*fps) throw Error('\u8bf7\u5c06\u64ad\u653e\u5934\u79fb\u5230\u8981\u5b9a\u683c\u7684\u52a8\u4f5c\u5185');
  const next = clips.filter(item=>item.id!==clipId && item.objectId===clip.objectId && item.startTimeSec>=end/fps-1e-7)
    .sort((a,b)=>a.startTimeSec-b.startTimeSec)[0];
  const duration = Math.min(Math.round(fps),Math.round((next?.startTimeSec??30)*fps)-frame);
  const continuation = {...lt(clip.objectId,clean,frame/fps,duration/fps,'\u59ff\u52bf\u63a5\u7eed'),
    durationSec:duration/fps,transitionInFrames:0,boneKeyframes:__localUpsertBoneKey([],clean,0,fps),boneTiming:{offsetTimeSec:0,speed:1}};
  continuation.poseContinuation = {anchorKeyId:continuation.boneKeyframes[0].id,transitionFrames:8,sourceClipId:clip.id};
  return {clip:continuation,clips:clips.flatMap(item=>item.id!==clipId?[item]:frame===start?[]:[{...item,durationSec:(frame-start)/fps,
    poseCutTransitionFrames:clip.poseCutTransitionFrames??Math.min(end-start,rJ(clip.transitionInFrames))}]).concat(continuation)};
}

function __localLinkContinuationClips(clips, fps) {
  const groups = new Map(), replacements = new Map();
  for (const clip of clips) {const group=groups.get(clip.objectId)||[];group.push(clip);groups.set(clip.objectId,group)}
  for (const group of groups.values()) {
    group.sort((a,b)=>a.startTimeSec-b.startTimeSec);
    for (let index=1;index<group.length;index++) {
      const previous=group[index-1], clip=group[index];
      if (!previous.poseContinuation || clip.poseContinuation || clip.motionUsage==='path-traversal' ||
          Math.round(clip.startTimeSec*fps)<Math.round((previous.startTimeSec+previous.durationSec)*fps)) continue;
      const anchor=__localSampleBoneClip(previous,__localBoneLocalTime(previous,previous.startTimeSec+previous.durationSec));
      if (anchor) replacements.set(clip.id,{...clip,poseContinuationAnchor:__localNormalizeBonePose(anchor),
        transitionInFrames:previous.poseContinuation.transitionFrames});
    }
  }
  return clips.map(clip=>replacements.get(clip.id)||clip);
}

function __localBoneLocalTime(clip, timelineSec) {
  const local=Math.max(0, Math.min(clip.durationSec, timelineSec - clip.startTimeSec));
  const timing=clip.boneTiming;
  return timing ? Math.max(0,((clip.offsetTimeSec||0)-timing.offsetTimeSec+local*(clip.speed||1))/timing.speed) : local;
}

function __localBoneDisplayKeys(clip) {
  const timing=clip.boneTiming;
  return (clip.boneKeyframes||[]).map(key=>({...key,timeSec:timing?
    (key.timeSec*timing.speed+timing.offsetTimeSec-(clip.offsetTimeSec||0))/(clip.speed||1):key.timeSec}));
}

function __localBoneEditorClip(clip, session) {
  if (!clip || !session?.boneAnimation || clip.id !== (session.clipId || session.draftClip?.id)) return clip;
  return {...clip, startTimeSec:session.startTimeSec,
    durationSec:Number.isFinite(session.durationSec) && session.durationSec>0 ? session.durationSec : clip.durationSec,
    motionName:session.displayName, boneKeyframes:session.boneKeys,
    // Editor keys already use displayed clip time, including trimmed or retimed actions.
    boneTiming:{offsetTimeSec:clip.offsetTimeSec||0,speed:clip.speed||1}};
}

function __localIsBoneAnchor(session) {
  return !!session?.poseContinuation && !!session.boneKeys?.some(key=>
    key.id===session.poseContinuation.anchorKeyId && Math.abs(key.timeSec-session.keyTimeSec)<1e-6);
}

function __localMoveBoneKey(keys, keyId, timeSec, durationSec, fps) {
  if (!Number.isFinite(timeSec) || !Number.isFinite(durationSec) || !(fps>0)) return keys;
  const key=keys.find(key=>key.id===keyId);
  const frame=Math.max(0,Math.min(Math.floor(durationSec*fps+1e-7),Math.round(timeSec*fps)));
  if (!key || frame===Math.round(key.timeSec*fps) || keys.some(key=>key.id!==keyId&&Math.round(key.timeSec*fps)===frame)) return keys;
  return keys.map(key=>key.id===keyId?{...key,timeSec:frame/fps}:key).sort((a,b)=>a.timeSec-b.timeSec);
}

function __localSampleBoneClip(clip, timeSec) {
  if (clip.poseLock) return {...clip.poseLock.pose, locomotionMode:'embedded'};
  const keys = clip.boneKeyframes;
  if (!keys?.length) return;
  if (keys.length === 1) return {...keys[0].pose, locomotionMode:'embedded'};
  // Reuse the engine's quaternion interpolation and bind-space conversion.
  return s6({durationSec:Math.max(clip.durationSec, keys.at(-1).timeSec), loop:false,
    locomotion:{mode:'embedded'}, transferMode:undefined,
    keyframes:keys.map(key => ({timeSec:key.timeSec,pose:key.pose,rootTranslation:key.pose.rootTranslation}))}, timeSec);
}

function __localUpsertBoneKey(keys, pose, timeSec, fps) {
  const clean = __localNormalizeBonePose(pose);
  if (!clean) throw Error('\u65e0\u6cd5\u8bfb\u53d6\u9aa8\u9abc\u59ff\u52bf');
  const frame = Math.round(timeSec*fps);
  const previous = keys.find(key => Math.round(key.timeSec*fps) === frame);
  return [...keys.filter(key => Math.round(key.timeSec*fps) !== frame),
    {id:previous?.id || 'bone-key-'+crypto.randomUUID(),timeSec:frame/fps,pose:clean}].sort((a,b) => a.timeSec-b.timeSec);
}

function __localCaptureRuntimePose(runtime) {
  if (!runtime.rigSignature || !runtime.bones.length) return;
  const bindRotations = l0(runtime.bones, runtime.bindQuaternions);
  const root = runtime.bones[0], bind = runtime.bindPositions.get(root);
  return {signature:runtime.rigSignature,
    rootTranslation:{x:root.position.x-(bind?.x||0),y:root.position.y-(bind?.y||0),z:root.position.z-(bind?.z||0)},
    rotations:runtime.bones.map((bone,index) => ({boneIndex:index,rotation:Ad(runtime,bone),
      bindWorldRotation:{x:bindRotations[index].x,y:bindRotations[index].y,z:bindRotations[index].z,w:bindRotations[index].w}}))};
}

function __LocalBoneClipTools({clip,fps,onEdit,onLock,onJoin,onSettings}) {
  return i.jsxs('div',{className:'mt-3 flex flex-col gap-2 border-t border-stroke pt-3',children:[
    i.jsxs('button',{type:'button',className:__localPoseButtonClass,onClick:onEdit,
      'data-testid':'director-stage-edit-bone-keys',children:[i.jsx(ck.A,{size:13}), '\u7f16\u8f91\u9aa8\u9abc\u5173\u952e\u5e27']}),
    i.jsxs('button',{type:'button',className:__localPoseButtonClass,
      'data-testid':'director-stage-lock-action-pose',onClick:onLock,
      children:[i.jsx(clip.poseLock ? gA.A : ck.A,{size:13}),clip.poseLock?'\u89e3\u9664\u65e7\u7248\u59ff\u52bf\u9501\u5b9a':'\u5728\u6b64\u5e27\u7ed3\u675f\u5e76\u63a5\u7eed']}),
    clip.poseContinuation && i.jsxs(i.Fragment,{children:[
      ...[['\u63a5\u7eed\u7247\u6bb5\u65f6\u957f\uff08\u79d2\uff09','durationSec',clip.durationSec,1/fps,30-clip.startTimeSec],
        ['\u8854\u63a5\u8fc7\u6e21\uff08\u79d2\uff09','transitionSec',clip.poseContinuation.transitionFrames/fps,0,24/fps]].map(([label,field,value,min,max])=>
        i.jsxs('label',{className:'flex items-center justify-between gap-2 text-[11px] text-content-secondary',children:[label,
          i.jsx('input',{type:'number','aria-label':label,min,max,step:1/fps,defaultValue:Number(value.toFixed(4)),
            className:'h-8 w-20 rounded-md border border-stroke bg-surface px-2 text-content',
            onBlur:event=>{const value=event.target.valueAsNumber;if(Number.isFinite(value))onSettings({[field]:value})},
            onKeyDown:event=>{if(event.key==='Enter')event.currentTarget.blur()}})]},field+':'+value)),
      i.jsxs('button',{type:'button',className:__localPoseButtonClass,'data-testid':'director-stage-join-motion',onClick:onJoin,
        children:[i.jsx(__localBoneNextIcon,{size:13}),'\u8854\u63a5\u4e0b\u4e00\u4e2a\u52a8\u4f5c']})]})]});
}

function __LocalBoneMarkers({clip,session,fps,pixelsPerFrame,onEdit,onDelete,onMove}) {
  clip = __localBoneEditorClip(clip,session);
  const gesture=n.useRef(null),ignoreClick=n.useRef(false);
  const [preview,setPreview]=n.useState(null);
  const keys=__localBoneDisplayKeys(clip);
  const shown=preview?__localMoveBoneKey(keys,preview.id,preview.timeSec,clip.durationSec,fps):keys;
  const release=(event,cancel=false)=>{
    const drag=gesture.current;
    if(!drag||event.pointerId!==drag.pointerId)return;
    event.stopPropagation();gesture.current=null;setPreview(null);
    if(event.currentTarget.hasPointerCapture?.(event.pointerId))event.currentTarget.releasePointerCapture(event.pointerId);
    ignoreClick.current=cancel||drag.moved;
    if(!cancel&&drag.moved&&drag.timeSec!==drag.startTimeSec)onMove?.(drag.id,drag.timeSec);
  };
  const editing = session?.boneAnimation && clip.id === (session.clipId || session.draftClip?.id);
  return i.jsxs(i.Fragment,{children:[
    ...shown.filter(key => key.timeSec >= 0 && key.timeSec <= clip.durationSec).map(key => i.jsx('button',{
      type:'button','data-bone-key-id':key.id,'aria-label':'\u9aa8\u9abc\u5173\u952e\u5e27 '+Math.round(key.timeSec*fps)+'f',
      title:'\u9aa8\u9abc\u5173\u952e\u5e27 '+Math.round(key.timeSec*fps)+'f',
      'aria-pressed':!!editing && Math.round(key.timeSec*fps)===Math.round(session.keyTimeSec*fps),
      onPointerDown:event=>{
        event.stopPropagation();ignoreClick.current=false;
        if(event.button!==0||event.isPrimary===false||!onMove||!(pixelsPerFrame>0))return;
        event.preventDefault();event.currentTarget.focus({preventScroll:true});
        gesture.current={id:key.id,pointerId:event.pointerId,startX:event.clientX,startTimeSec:key.timeSec,timeSec:key.timeSec,moved:false,keys};
        event.currentTarget.setPointerCapture(event.pointerId);
      },
      onPointerMove:event=>{
        const drag=gesture.current;
        if(!drag||event.pointerId!==drag.pointerId)return;
        event.stopPropagation();
        const delta=event.clientX-drag.startX;
        if(!drag.moved&&Math.abs(delta)<3)return;
        drag.moved=true;
        const moved=__localMoveBoneKey(drag.keys,drag.id,drag.startTimeSec+Math.round(delta/pixelsPerFrame)/fps,clip.durationSec,fps);
        drag.timeSec=moved.find(key=>key.id===drag.id).timeSec;
        setPreview({id:drag.id,timeSec:drag.timeSec});
      },
      onPointerUp:event=>release(event),onPointerCancel:event=>release(event,true),onLostPointerCapture:event=>release(event,true),
      onClick:event=>{event.stopPropagation();if(ignoreClick.current){ignoreClick.current=false;return}onEdit(key.timeSec)},
      onKeyDown:event=>{if(event.key==='Delete'||event.key==='Backspace'){event.preventDefault();event.stopPropagation();onDelete(key.id)}},
      style:{position:'absolute',zIndex:5,left:'clamp(8px, '+(100*key.timeSec/clip.durationSec)+'%, calc(100% - 8px))',
        bottom:1,width:14,height:14,padding:0,background:'transparent',border:0,transform:'translateX(-50%)',touchAction:'none',cursor:onMove?'ew-resize':'pointer'},
      children:i.jsx('span',{style:{display:'block',width:7,height:7,margin:3,transform:'rotate(45deg)',
        background:editing && Math.round(key.timeSec*fps)===Math.round(session.keyTimeSec*fps)?'#ffffff':'#86d7bc',border:'1px solid #baf6df'}})
    },key.id))]});
}

function __LocalBoneEditor({session,fps,onTime,onRecord,onDelete}) {
  const frame = Math.round(session.keyTimeSec*fps);
  const keys = session.boneKeys || [];
  const previous = [...keys].reverse().find(key=>Math.round(key.timeSec*fps)<frame);
  const next = keys.find(key=>Math.round(key.timeSec*fps)>frame);
  const atKey = keys.some(key=>Math.round(key.timeSec*fps)===frame);
  const anchor = __localIsBoneAnchor(session);
  return i.jsxs('div',{className:'mt-2 flex flex-wrap items-center gap-2',
    'data-testid':'director-stage-bone-editor',children:[
      i.jsx('span',{className:'text-[11px] text-content-secondary',children:'\u9aa8\u9abc\u5173\u952e\u5e27'}),
      i.jsx('input',{type:'number',min:0,max:session.durationSec,step:1/fps,value:Number(session.keyTimeSec.toFixed(4)),
        'aria-label':'\u9aa8\u9abc\u5173\u952e\u5e27\u65f6\u95f4',className:'h-8 w-24 rounded-md border border-stroke bg-surface px-2 text-[11px] text-content',
        onChange:event=>{if(event.target.value!==''&&Number.isFinite(event.target.valueAsNumber))onTime(event.target.valueAsNumber)}}),
      i.jsx('span',{className:'text-[10px] text-content-muted',children:frame+'f / '+keys.length+' \u5e27'}),
      i.jsx('button',{type:'button',className:__localPoseButtonClass,disabled:!previous,title:'\u4e0a\u4e00\u5173\u952e\u5e27',
        'aria-label':'\u4e0a\u4e00\u9aa8\u9abc\u5173\u952e\u5e27',onClick:()=>onTime(previous.timeSec),children:i.jsx(__localBonePreviousIcon,{size:13})}),
      i.jsx('button',{type:'button',className:__localPoseButtonClass,disabled:!next,title:'\u4e0b\u4e00\u5173\u952e\u5e27',
        'aria-label':'\u4e0b\u4e00\u9aa8\u9abc\u5173\u952e\u5e27',onClick:()=>onTime(next.timeSec),children:i.jsx(__localBoneNextIcon,{size:13})}),
      i.jsxs('button',{type:'button',className:__localPoseButtonClass,disabled:anchor,'data-testid':'director-stage-record-bone-key',onClick:onRecord,
        children:[i.jsx(__localBoneKeyIcon,{size:13}),anchor?'\u5b9a\u683c\u8d77\u70b9':atKey?'\u66f4\u65b0\u5173\u952e\u5e27':'\u6dfb\u52a0\u5173\u952e\u5e27']}),
      i.jsx('button',{type:'button',className:__localPoseButtonClass,disabled:!atKey||anchor,title:'\u5220\u9664\u9aa8\u9abc\u5173\u952e\u5e27',
        'aria-label':'\u5220\u9664\u9aa8\u9abc\u5173\u952e\u5e27',onClick:onDelete,children:i.jsx(__localPoseIcons.delete,{size:13})})]});
}

function __localUseBoneEditing({state,session,setSession,controller,sampleFrame,seek,stop,select,commit,finish,notice,scope,openMotion}) {
  const latest = n.useRef();
  latest.current = {state,session,scope};
  const request = n.useRef(0);
  const interaction = n.useRef(0);
  n.useEffect(()=>()=>{request.current++},[scope]);
  const fps = state.timeline.displayFps;
  const capture = async (objectId,timeSec,override) => {
    const frame = sampleFrame(Math.round(timeSec*fps));
    const value = override ? {...frame,motionPoses:{...frame.motionPoses,[objectId]:{kind:'single',sample:override}}} : frame;
    const result = await controller.current?.captureEvaluatedPerformanceFrame(value);
    const pose = result?.skeletalPoses?.[objectId];
    if (!pose) throw Error('\u4eba\u7269\u9aa8\u9abc\u5c1a\u672a\u5c31\u7eea');
    return {pose,jointTransforms:Object.fromEntries(Object.entries(result.jointTransforms).filter(([id])=>id.startsWith(objectId+'::')))};
  };
  const run = async operation => {try {await operation()} catch(error) {notice(error?.message||'\u9aa8\u9abc\u7f16\u8f91\u5931\u8d25')}};
  const valid = token => token === request.current && latest.current.scope === scope;
  const begin = (objectId,clipId,timelineTime) => run(async()=>{
    interaction.current++;
    if (session?.boneAnimation && session.objectId===objectId && clipId===(session.clipId||session.draftClip?.id)) {
      await time(timelineTime-session.startTimeSec);return;
    }
    const target = state.objects.find(object=>object.id===objectId);
    if (!target?.rigged || target.locked) return;
    const clip = state.timeline.clips.find(clip=>clip.id===clipId);
    if (clip?.poseLock) {notice('\u8bf7\u5148\u89e3\u9664\u59ff\u52bf\u9501\u5b9a');return}
    stop();
    const token = ++request.current;
    const initialSession=session;
    const startTimeSec = clip?.startTimeSec ?? Math.min(30-1/fps,Math.round(timelineTime*fps)/fps);
    const durationSec = clip?.durationSec ?? Math.min(1,30-startTimeSec);
    const keyTimeSec = Math.round(Math.max(0,Math.min(clip?.boneKeyframes?.length?durationSec:Math.max(0,durationSec-1/fps),timelineTime-startTimeSec))*fps)/fps;
    const isCurrent = () => valid(token) && latest.current.session===initialSession &&
      latest.current.state.selectedObjectIds===state.selectedObjectIds &&
      latest.current.state.timeline===state.timeline &&
      latest.current.state.objects.find(object=>object.id===objectId)===target &&
      latest.current.state.timeline.clips.find(item=>item.id===clipId)===clip;
    let boneKeys=clip?__localBoneDisplayKeys(clip).filter(key=>key.timeSec>=0&&key.timeSec<=durationSec):[];
    const linked=clip?.boneKeyframes?.length ? __localLinkContinuationClips(state.timeline.clips,fps).find(item=>item.id===clipId):undefined;
    let alignedKeys=false;
    if (linked?.poseContinuationAnchor && linked.motionUsage!=='path-traversal') {
      const source=__localSampleBoneClip(linked,__localBoneLocalTime(linked,startTimeSec));
      const continuation={anchor:linked.poseContinuationAnchor,source,identity:linked};
      const sourceKeys=boneKeys.some(key=>Math.round(key.timeSec*fps)===0)
        ? boneKeys : __localUpsertBoneKey(boneKeys,source,0,fps);
      const baked=[];
      // Captured edits and existing keys must share the same root coordinates and heading.
      for (const key of sourceKeys) {
        if (!isCurrent()) return;
        const value=await capture(objectId,startTimeSec+Math.min(key.timeSec,Math.max(0,durationSec-1/fps)),
          {...key.pose,__localPoseContinuation:continuation});
        if (!isCurrent()) return;
        baked.push({...key,pose:value.pose});
      }
      boneKeys=baked;
      alignedKeys=true;
    }
    const sampleAt = time => alignedKeys
      ? __localSampleBoneClip({...clip,boneKeyframes:boneKeys},time)
      : time===durationSec&&clip?.boneKeyframes?.length
        ? __localSampleBoneClip(clip,__localBoneLocalTime(clip,startTimeSec+time)):undefined;
    const current = await capture(objectId,startTimeSec+Math.min(keyTimeSec,Math.max(0,durationSec-1/fps)),sampleAt(keyTimeSec));
    if (!isCurrent()) return;
    const initial = keyTimeSec>0 ? await capture(objectId,startTimeSec,sampleAt(0)) : current;
    if (!isCurrent()) return;
    select({mode:'pose',selectedObjectIds:[objectId],selectedJointId:undefined});
    seek(startTimeSec+keyTimeSec);
    let poseContinuation=clip?.poseContinuation;
    if(poseContinuation && !boneKeys.some(key=>key.id===poseContinuation.anchorKeyId)) {
      boneKeys=__localUpsertBoneKey(boneKeys,initial.pose,0,fps);
      poseContinuation={...poseContinuation,anchorKeyId:boneKeys[0].id};
    }
    setSession({objectId,clipId:clip?.id,startTimeSec,durationSec,keyTimeSec,boneAnimation:true,
      poseContinuation,
      displayName:clip?.motionName||'\u9aa8\u9abc\u52a8\u753b',jointTransforms:current.jointTransforms,lockedJointIds:[],
      boneKeys,baselinePose:initial.pose,boneDirty:false,
      ...(clip?{}:{draftClip:lt(objectId,current.pose,startTimeSec,durationSec,'\u9aa8\u9abc\u52a8\u753b')})});
  });
  const time = nextTime => run(async()=>{
    if (!session?.boneAnimation || !Number.isFinite(nextTime)) return;
    interaction.current++;
    stop();
    const token = ++request.current;
    const keyTimeSec = Math.round(Math.max(0,Math.min(session.durationSec,nextTime))*fps)/fps;
    const clip = state.timeline.clips.find(clip=>clip.id===session.clipId) || session.draftClip;
    const sample = session.boneKeys.length ? __localSampleBoneClip({...clip,boneKeyframes:session.boneKeys},keyTimeSec)
      : !session.clipId ? {...session.baselinePose,locomotionMode:'embedded'} : undefined;
    const result = await capture(session.objectId,session.startTimeSec+Math.min(keyTimeSec,Math.max(0,session.durationSec-1/fps)),sample);
    if (!valid(token) || latest.current.session !== session) return;
    setSession({...session,keyTimeSec,jointTransforms:result.jointTransforms,boneDirty:false});
    seek(session.startTimeSec+keyTimeSec);
  });
  const readKeys = () => {
    if(__localIsBoneAnchor(session)) throw Error('\u5b9a\u683c\u59ff\u52bf\u5df2\u4fdd\u62a4\uff0c\u8bf7\u5728\u5176\u4ed6\u5e27\u4fee\u6539\u59ff\u52bf');
    const pose = controller.current?.copyPose();
    let keys = session.boneKeys;
    if (!keys.length && session.keyTimeSec>0) keys=__localUpsertBoneKey(keys,session.baselinePose,0,fps);
    return __localUpsertBoneKey(keys,pose,session.keyTimeSec,fps);
  };
  const record = () => {interaction.current++;stop();try {setSession({...session,boneKeys:readKeys(),boneDirty:false})} catch(error) {notice(error.message)}};
  const remove = () => {
    interaction.current++;
    stop();
    if(__localIsBoneAnchor(session))return;
    setSession({...session,boneDirty:false,boneKeys:session.boneKeys.filter(key=>Math.round(key.timeSec*fps)!==Math.round(session.keyTimeSec*fps))});
  };
  const save = () => {
    if (!session?.boneAnimation) return false;
    interaction.current++;
    stop();
    try {
      const keys = session.boneDirty ? readKeys() : session.boneKeys;
      if(!session.clipId&&!keys.length){notice('\u8bf7\u5148\u6dfb\u52a0\u9aa8\u9abc\u5173\u952e\u5e27');return false}
      if (!Number.isFinite(session.durationSec) || session.durationSec<=0) throw Error('\u8bf7\u8f93\u5165\u6709\u6548\u7247\u6bb5\u65f6\u957f');
      const durationSec = Math.min(30-session.startTimeSec,Math.round(Math.max(1/fps,session.durationSec,keys.at(-1)?.timeSec||0)*fps)/fps);
      const old = state.timeline.clips.find(clip=>clip.id===session.clipId);
      const clip = {...(old||session.draftClip),motionName:session.displayName.trim()||'\u9aa8\u9abc\u52a8\u753b',durationSec,boneKeyframes:keys,
        boneTiming:{offsetTimeSec:old?.offsetTimeSec||0,speed:old?.speed||1},
        ...(session.poseContinuation?{poseContinuation:session.poseContinuation}:{})};
      if (state.timeline.clips.some(other=>other.id!==clip.id && other.objectId===clip.objectId &&
        other.startTimeSec<clip.startTimeSec+durationSec-1e-7 && other.startTimeSec+other.durationSec>clip.startTimeSec+1e-7)) {
        notice('\u52a8\u4f5c\u7247\u6bb5\u4e0e\u540e\u7eed\u52a8\u4f5c\u91cd\u53e0');return false;
      }
      commit(current=>({...current,timeline:{...current.timeline,durationSec:Math.max(current.timeline.durationSec,clip.startTimeSec+durationSec),
        clips:old?current.timeline.clips.map(item=>item.id===clip.id?clip:item):[...current.timeline.clips,clip]}}),'director.timeline.bone-keyframes');
      finish();seek(session.startTimeSec+session.keyTimeSec);notice('\u9aa8\u9abc\u5173\u952e\u5e27\u5df2\u4fdd\u5b58');return true;
    } catch(error) {notice(error.message);return false}
  };
  const lock = (clipId,timelineTime) => run(async()=>{
    interaction.current++;
    const clip = state.timeline.clips.find(clip=>clip.id===clipId);
    if (!clip) return;
    stop();
    if (clip.poseLock) {
      commit(current=>({...current,timeline:{...current.timeline,clips:current.timeline.clips.map(item=>{
        if(item.id!==clipId)return item;const {poseLock,...rest}=item;return rest;
      })}}),'director.timeline.unlock-pose');return;
    }
    const token = ++request.current;
    const timeSec = Math.round(timelineTime*fps)/fps;
    if(timeSec<clip.startTimeSec || timeSec>=clip.startTimeSec+clip.durationSec) throw Error('\u8bf7\u5c06\u64ad\u653e\u5934\u79fb\u5230\u8981\u5b9a\u683c\u7684\u52a8\u4f5c\u5185');
    const initialTimeline=state.timeline;
    const result = await capture(clip.objectId,timeSec);
    if (!valid(token) || latest.current.state.timeline!==initialTimeline) return;
    const cut=__localCutToPose(state.timeline.clips,clipId,timeSec,result.pose,fps);
    commit(current=>({...current,timeline:{...current.timeline,clips:cut.clips,
      durationSec:Math.max(current.timeline.durationSec,cut.clip.startTimeSec+cut.clip.durationSec)}}),'director.timeline.cut-to-pose');
    select({mode:'pose',selectedObjectIds:[clip.objectId],selectedJointId:undefined});
    seek(timeSec);
    setSession({objectId:clip.objectId,clipId:cut.clip.id,startTimeSec:timeSec,durationSec:cut.clip.durationSec,keyTimeSec:0,
      boneAnimation:true,poseContinuation:cut.clip.poseContinuation,displayName:cut.clip.motionName,jointTransforms:result.jointTransforms,
      lockedJointIds:[],boneKeys:cut.clip.boneKeyframes,baselinePose:result.pose,boneDirty:false});
    notice('\u5df2\u622a\u65ad\u52a8\u4f5c\u5e76\u4fdd\u7559\u5b9a\u683c\u8d77\u70b9');
  });
  const deleteKey = (clipId,keyId) => {
    interaction.current++;
    stop();
    if (session?.boneAnimation && clipId===(session.clipId||session.draftClip?.id)) {
      if(session.poseContinuation?.anchorKeyId===keyId){notice('\u5b9a\u683c\u8d77\u70b9\u5df2\u4fdd\u62a4');return}
      setSession({...session,boneKeys:session.boneKeys.filter(key=>key.id!==keyId),boneDirty:false});return;
    }
    if(state.timeline.clips.find(clip=>clip.id===clipId)?.poseContinuation?.anchorKeyId===keyId){notice('\u5b9a\u683c\u8d77\u70b9\u5df2\u4fdd\u62a4');return}
    commit(current=>({...current,timeline:{...current.timeline,clips:current.timeline.clips.map(clip=>
      clip.id===clipId?{...clip,boneKeyframes:(clip.boneKeyframes||[]).filter(key=>key.id!==keyId)}:clip)}}),'director.timeline.delete-bone-keyframe');
  };
  const moveKey = (clipId,keyId,timeSec) => run(async()=>{
    interaction.current++;
    const editing=session?.boneAnimation && clipId===(session.clipId||session.draftClip?.id);
    const clip=state.timeline.clips.find(clip=>clip.id===clipId)||(editing?session.draftClip:undefined);
    if(!clip||state.objects.find(object=>object.id===clip.objectId)?.locked)return;
    const keys=editing?session.boneKeys:__localBoneDisplayKeys(clip);
    const moved=__localMoveBoneKey(keys,keyId,timeSec,editing?session.durationSec:clip.durationSec,fps);
    if(moved===keys)return;
    stop();
    const keyTimeSec=moved.find(key=>key.id===keyId).timeSec;
    if(editing){
      const token=++request.current;
      const pose=__localSampleBoneClip({...clip,boneKeyframes:moved},keyTimeSec);
      const result=await capture(session.objectId,session.startTimeSec+keyTimeSec,pose);
      if(!valid(token)||latest.current.session!==session)return;
      setSession({...session,boneKeys:moved,keyTimeSec,jointTransforms:result.jointTransforms,boneDirty:false});
      seek(session.startTimeSec+keyTimeSec);
    }else{
      const timing=clip.boneTiming;
      const sourceTime=timing?((clip.offsetTimeSec||0)-timing.offsetTimeSec+keyTimeSec*(clip.speed||1))/timing.speed:keyTimeSec;
      let updated={...clip,boneKeyframes:clip.boneKeyframes.map(key=>key.id===keyId?{...key,timeSec:sourceTime}:key).sort((a,b)=>a.timeSec-b.timeSec)};
      if(sourceTime<0||sourceTime>30){
        // Rebase the authored time domain without dropping keys outside the visible trim.
        const first=Math.min(0,...moved.map(key=>key.timeSec)),last=Math.max(...moved.map(key=>key.timeSec));
        const scale=Math.max(1,(last-first)/30);
        updated={...clip,boneKeyframes:moved.map(key=>({...key,timeSec:Math.max(0,Math.min(30,(key.timeSec-first)/scale))})),
          boneTiming:{offsetTimeSec:(clip.offsetTimeSec||0)+first*(clip.speed||1),speed:scale*(clip.speed||1)}};
      }
      commit(current=>({...current,timeline:{...current.timeline,clips:current.timeline.clips.map(item=>item.id===clipId?updated:item)}}),
        'director.timeline.move-bone-keyframe');
      seek(clip.startTimeSec+keyTimeSec);
    }
  });
  const settings = (clipId,values) => {
    const clip=state.timeline.clips.find(item=>item.id===clipId);
    if(!clip?.poseContinuation)return;
    const durationSec=values.durationSec===undefined?clip.durationSec:Math.max(1,Math.round(values.durationSec*fps))/fps;
    if(!Number.isFinite(durationSec)||clip.startTimeSec+durationSec>30 || state.timeline.clips.some(other=>other.id!==clipId&&other.objectId===clip.objectId&&
      other.startTimeSec<clip.startTimeSec+durationSec-1e-7&&other.startTimeSec+other.durationSec>clip.startTimeSec+1e-7)) {
      notice('\u7247\u6bb5\u8d85\u51fa\u7a7a\u95f2\u65f6\u95f4\u6216 30 \u79d2\u4e0a\u9650');return;
    }
    if(__localBoneDisplayKeys(clip).some(key=>key.timeSec>durationSec+1e-7)){notice('\u7247\u6bb5\u672b\u5c3e\u4ecd\u6709\u9aa8\u9abc\u5173\u952e\u5e27');return}
    const updated={...clip,durationSec,poseContinuation:{...clip.poseContinuation,
      transitionFrames:values.transitionSec===undefined?clip.poseContinuation.transitionFrames:rJ(values.transitionSec*fps)}};
    commit(current=>({...current,timeline:{...current.timeline,durationSec:Math.max(current.timeline.durationSec,clip.startTimeSec+durationSec),
      clips:current.timeline.clips.map(item=>item.id===clipId?updated:item)}}),'director.timeline.continuation-settings');
  };
  const join = clipId => {
    interaction.current++;
    const clip=state.timeline.clips.find(item=>item.id===clipId);
    if(!clip?.poseContinuation)return;
    const end=clip.startTimeSec+clip.durationSec;
    if(end>=30){notice('\u8bf7\u5148\u7f29\u77ed\u63a5\u7eed\u7247\u6bb5\uff0c\u4e3a\u65b0\u52a8\u4f5c\u7559\u51fa\u65f6\u95f4');return}
    stop();finish();seek(end);openMotion?.(clip.objectId);
  };
  const convert = () => {
    interaction.current++;
    const pose=__localNormalizeBonePose(controller.current?.copyPose());
    if(!pose||!session)return;
    setSession({...session,boneAnimation:true,keyTimeSec:0,boneKeys:[],baselinePose:pose,boneDirty:false});
  };
  return {begin,time,record,remove,save,lock,deleteKey,moveKey,convert,settings,join,getInteractionVersion:()=>interaction.current};
}

function __localCreateSkeletalMotion(session,pose,target,existing,fps=30) {
  const base=__localCreatePoseMotion({pose,target,name:session.displayName,durationSec:session.durationSec,existing});
  let keys=__localUpsertBoneKey(session.boneKeys||[],pose,session.keyTimeSec,fps);
  if(keys[0].timeSec>0)keys=__localUpsertBoneKey(keys,session.baselinePose,0,fps);
  const duration=Math.max(base.durationSec,keys.at(-1).timeSec,0.05);
  if(keys.length===1||keys.at(-1).timeSec<duration)keys=[...keys,{timeSec:duration,pose:keys.at(-1).pose}];
  return g7({...base,durationSec:duration,keyframes:keys.map(key=>({timeSec:key.timeSec,
    pose:{signature:key.pose.signature,rotations:key.pose.rotations},rootTranslation:key.pose.rootTranslation}))});
}
