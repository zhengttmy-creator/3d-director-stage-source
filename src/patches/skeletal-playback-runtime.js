function __localBonePlaybackTimeline(timeline, session) {
  if (!session?.boneAnimation) return timeline;
  const source = timeline.clips.find(clip => clip.id === session.clipId) || session.draftClip;
  if (!source) return timeline;
  const projected = __localBoneEditorClip(source, session);
  // The scheduler rounds source offsets to frames; editor keys already use local display time.
  const offsetTimeSec=Math.round((projected.offsetTimeSec||0)*timeline.displayFps)/timeline.displayFps;
  const clip={...projected,offsetTimeSec,
    boneTiming:{offsetTimeSec,speed:projected.speed||1}};
  return {...timeline, durationSec:Math.max(timeline.durationSec,clip.startTimeSec+clip.durationSec),
    clips:timeline.clips.some(item=>item.id===clip.id)
      ? timeline.clips.map(item=>item.id===clip.id?clip:item) : [...timeline.clips,clip]};
}

function __localBonePlaybackBounds(session) {
  const start = Math.max(0,Math.min(30,session.startTimeSec));
  return {start,end:Math.min(30,start+Math.max(0,session.durationSec))};
}

function __localBonePlaybackSession(session, pose, fps) {
  if (!session.boneDirty) return session;
  const clean = __localNormalizeBonePose(pose);
  if (!clean) throw Error('\u4eba\u7269\u9aa8\u9abc\u5c1a\u672a\u5c31\u7eea');
  const anchor = session.boneKeys.find(key=>key.id===session.poseContinuation?.anchorKeyId);
  if (anchor && Math.round(anchor.timeSec*fps)===Math.round(session.keyTimeSec*fps)) return {...session,boneDirty:false};
  let keys = session.boneKeys;
  if (!keys.length && session.keyTimeSec>0) keys=__localUpsertBoneKey(keys,session.baselinePose,0,fps);
  return {...session,boneKeys:__localUpsertBoneKey(keys,clean,session.keyTimeSec,fps),boneDirty:false};
}

function __localBonePlaybackSpace(event) {
  return g0(event)==='space' && !event.altKey && !event.ctrlKey && !event.metaKey && !event.shiftKey &&
    !gZ(event.target) && !!event.target?.closest?.('[data-bone-key-id], [data-motion-clip-id], [data-motion-clip-draft], [data-testid="director-stage-bone-editor"]');
}

function __localUseBonePlayback({session,setSession,store,active,timeRef,seek,tools,controller,fps,notice,scope}) {
  const identity = session?.boneAnimation ? session.clipId||session.draftClip?.id : undefined;
  const previous = n.useRef({identity,active:false,revision:tools.getInteractionVersion?.()||0});
  const latest = n.useRef();
  latest.current={session,setSession,store,active,timeRef,seek,tools,controller,fps,notice,scope};
  n.useEffect(()=>{
    const before = previous.current;
    const revision=tools.getInteractionVersion?.()||0;
    previous.current={identity,active,revision};
    if (before.active && before.identity && before.identity!==identity) {
      store.setActive(false);
      return;
    }
    if (before.active && !active && identity && before.identity===identity && before.revision===revision) {
      // Restore editable joints from the same interpolated frame shown by the player.
      tools.time(timeRef.current-session.startTimeSec);
    }
  },[identity,active,scope]);
  n.useEffect(()=>()=>{
    if (previous.current.active && previous.current.identity) store.setActive(false);
  },[store,scope]);
  return {toggle:()=>{
    const current=latest.current,editing=current.session;
    if (!editing?.boneAnimation) return;
    if (current.store.getSnapshot()) {current.store.setActive(false);return}
    try {
      const next=__localBonePlaybackSession(editing,current.controller.current?.copyPose(),current.fps);
      const {start,end}=__localBonePlaybackBounds(next);
      if (!Number.isFinite(start) || !Number.isFinite(end) || end<=start) throw Error('\u8bf7\u8f93\u5165\u6709\u6548\u7247\u6bb5\u65f6\u957f');
      if (next!==editing) current.setSession(next);
      if (current.timeRef.current<start || current.timeRef.current>=end) current.seek(start);
      current.store.setActive(true);
    } catch(error) {current.notice(error.message)}
  }};
}
