function __localManualCameraSignature(camera, tracks) {
  return JSON.stringify([eH.map(channel => eZ(camera, channel)), camera.aspectRatio,
    !!camera.cameraLocked, !!camera.targetLocked, camera.cameraHelperVisible, camera.targetHelperVisible,
    eH.map(channel => tracks[channel] || [])]);
}

function __localManualCameraPose(camera, values, channels = eH) {
  let result = {...camera, position: {...camera.position}, target: {...camera.target}};
  for (const channel of channels) {
    if (channel.startsWith('position.') && camera.cameraLocked || channel.startsWith('target.') && camera.targetLocked) continue;
    const [group, axis] = channel.split('.');
    const value = e3(channel, eZ(values, channel), eZ(camera, channel));
    if (group === 'lens') result[axis] = value;
    else result[group][axis] = value;
  }
  return result;
}

function __localManualCameraDraftValue(owner, camera, tracks, pose) {
  const sampled = eK(camera, tracks).sample(owner.frame);
  const current = __localManualCameraPose(sampled, pose);
  const channels = eH.filter(channel => Math.abs(eZ(current, channel) - eZ(sampled, channel)) > 1e-7);
  return channels.length ? {...owner, signature: __localManualCameraSignature(camera, tracks), camera: current, channels} : null;
}

// Settled edits are separate from both persistent tracks and per-frame navigation
// previews. Changing the viewport's camera during a held gesture cancels that gesture.
function __localUseManualCameraDraft({scope, cameraId, frame, cameras, playback, enabled}) {
  const [draft, setDraft] = (0,n.useState)(null);
  const value = (0,n.useRef)(draft);
  const owner = (0,n.useRef)(null);
  owner.current = {scope, cameraId, frame, cameras, playback, enabled};
  const replace = (0,n.useCallback)(next => {value.current = next; setDraft(next);}, []);
  const clear = (0,n.useCallback)(() => {if (value.current) replace(null);}, [replace]);
  const read = (0,n.useCallback)((id, atFrame) => {
    const current = owner.current, pending = value.current;
    if (!pending || !current.enabled || current.playback.getSnapshot() || current.cameraId !== id || current.frame !== atFrame
      || pending.scope !== current.scope || pending.cameraId !== id || pending.frame !== atFrame) return null;
    const authored = current.cameras.find(camera => camera.id === id);
    if (!authored || pending.signature !== __localManualCameraSignature(t0(authored), authored.tracks)) return null;
    return pending;
  }, []);
  const stage = (0,n.useCallback)((id, atFrame, camera, tracks, pose) => {
    const current = owner.current;
    if (!current.enabled || current.playback.getSnapshot() || current.cameraId !== id || current.frame !== atFrame) return false;
    replace(__localManualCameraDraftValue({scope: current.scope, cameraId: id, frame: atFrame}, camera, tracks, pose));
    return true;
  }, [replace]);
  const authored = cameras.find(camera => camera.id === cameraId);
  const signature = authored ? __localManualCameraSignature(t0(authored), authored.tracks) : '';
  (0,n.useEffect)(() => {if (value.current && !read(cameraId, frame)) clear();}, [scope, cameraId, frame, signature, enabled, read, clear]);
  (0,n.useEffect)(() => playback.subscribe(() => {if (playback.getSnapshot()) clear();}), [playback, clear]);
  return {read, stage, replace, clear, displayed: read(cameraId, frame)?.camera || null};
}

function __localManualCameraEdit(camera, tracks, displayed, incoming, channels) {
  const next = __localManualCameraPose(displayed, incoming, channels);
  const changed = channels.some(channel => Math.abs(eZ(next, channel) - eZ(displayed, channel)) > 1e-7);
  if (!changed) return {changed: false, camera, pending: null};
  const animated = eH.some(channel => tracks[channel]?.length);
  return animated ? {changed: true, camera, pending: next}
    : {changed: true, camera: __localManualCameraPose(camera, next, channels), pending: null};
}

function __localRecordManualCameraChannels({editable, poseEditing, targetPicking, playing, cameraId, frame, draft, commit, select}, channels) {
  if (!editable || poseEditing || targetPicking || playing || !cameraId || !Number.isFinite(frame)) return false;
  channels = [...new Set(channels)].filter(channel => eH.includes(channel));
  if (!channels.length) return false;
  frame = Math.max(0, Math.round(frame));
  const pending = draft.read(cameraId, frame);
  let refs = [], remainder;
  commit(state => {
    if (channels.some(channel => channel.startsWith('target.') ? state.sceneCamera.targetLocked : state.sceneCamera.cameraLocked)) return state;
    const pose = pending?.camera || eK(state.sceneCamera, state.timeline.cameraTracks).sample(frame);
    const result = eJ(state.sceneCamera, state.timeline.cameraTracks, frame,
      Object.fromEntries(channels.map(channel => [channel, eZ(pose, channel)])));
    refs = channels.map(channel => ({kind: 'camera-property', cameraId, channel, keyframeId: result.keyframes[channel].id}));
    if (pending) remainder = __localManualCameraDraftValue({scope: pending.scope, cameraId, frame}, result.camera, result.tracks, pending.camera);
    return {...state, sceneCamera: result.camera, timeline: {...state.timeline, cameraTracks: result.tracks,
      durationSec: Math.max(state.timeline.durationSec, frame / state.timeline.displayFps)}};
  }, 'director.timeline.record-camera-keyframe', cameraId);
  if (refs.length) {
    if (pending) draft.replace(remainder);
    select(refs);
  }
  return refs.length > 0;
}
