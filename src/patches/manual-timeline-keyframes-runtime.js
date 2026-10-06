function __localCameraRowChannels(row) {
  if (row.kind === 'camera-group' && ['position', 'target'].includes(row.curve?.group)) {
    return ['x', 'y', 'z'].map(axis => row.curve.group + '.' + axis);
  }
  if (row.kind === 'camera-channel' && ['lens.fov', 'lens.roll'].includes(row.cameraTrack)) return [row.cameraTrack];
  return [];
}

function __localRecordCameraRowKeyframe(state, row, frame) {
  const channels = __localCameraRowChannels(row);
  const camera = state.sceneCamera;
  if (!channels.length || !Number.isFinite(frame) || channels.some(channel =>
    channel.startsWith('target.') ? camera.targetLocked : camera.cameraLocked)) return {state, refs: []};
  frame = Math.max(0, Math.round(frame));
  const sampled = eK(camera, state.timeline.cameraTracks).sample(frame);
  const result = eJ(camera, state.timeline.cameraTracks, frame,
    Object.fromEntries(channels.map(channel => [channel, eZ(sampled, channel)])));
  return {
    state: {...state, sceneCamera: result.camera, timeline: {...state.timeline,
      durationSec: Math.max(state.timeline.durationSec, frame / state.timeline.displayFps), cameraTracks: result.tracks}},
    refs: channels.map(channel => ({kind: 'camera-property', cameraId: row.cameraId,
      channel, keyframeId: result.keyframes[channel].id})),
  };
}

function __LocalTimelineKeyButton({row, clock, playback, editable, onRecord, tracks, camera, clips, fps}) {
  const time = hj(clock);
  const playing = hC(playback);
  const frame = Math.max(0, Math.round(time * fps));
  const objectGroup = row.kind === 'object-group' && ['position', 'rotation', 'scale'].includes(row.objectGroup);
  const channels = objectGroup ? ['x', 'y', 'z'].map(axis => tR(row.objectGroup, axis)) : __localCameraRowChannels(row);
  if (!channels.length || !onRecord) return null;
  const track = objectGroup ? tracks[row.object.id] : camera?.tracks;
  const active = channels.every(channel => track?.[channel]?.some(key => key.frame === frame));
  const locked = objectGroup ? row.object.locked || row.object.kind === 'environment' || row.object.kind === 'world'
    || row.objectGroup === 'rotation' && lL({object: row.object, clips, frame, displayFps: fps})
    : !camera || channels.some(channel => channel.startsWith('target.') ? camera.authoring.targetLocked : camera.authoring.cameraLocked);
  const disabled = !editable || playing || locked;
  const owner = objectGroup ? row.object.name : camera?.name;
  const label = `${owner || ''} \u00b7 ${row.label} \u00b7 \u6dfb\u52a0\u5173\u952e\u5e27`;
  const hint = !editable ? '\u5f53\u524d\u72b6\u6001\u4e0d\u53ef\u7f16\u8f91' : playing ? '\u8bf7\u5148\u6682\u505c\u64ad\u653e'
    : locked ? '\u5f53\u524d\u8f68\u9053\u5df2\u9501\u5b9a' : active ? '\u66f4\u65b0\u5f53\u524d\u5e27\u5173\u952e\u5e27' : '\u5728\u5f53\u524d\u5e27\u6dfb\u52a0\u5173\u952e\u5e27';
  return (0,i.jsx)('span', {className: 'ml-1 inline-grid size-6 shrink-0', title: hint,
    'data-director-stage-tooltip': hint, children: (0,i.jsx)('button', {
      type: 'button', 'aria-label': label, 'aria-pressed': active, disabled,
      'data-testid': 'director-stage-timeline-add-keyframe-' + row.id,
      onPointerDown: event => event.stopPropagation(),
      onClick: event => {event.preventDefault(); event.stopPropagation(); if (!disabled) onRecord(row);},
      className: ok('grid size-6 place-items-center rounded-md outline-none transition-colors hover:bg-accent/10 hover:text-accent focus-visible:ring-2 focus-visible:ring-accent/45 disabled:cursor-not-allowed disabled:opacity-45 disabled:hover:bg-transparent', active ? 'text-accent' : 'text-content-muted'),
      children: (0,i.jsx)(fO.A, {size: 12, strokeWidth: 1.8, fill: active ? 'currentColor' : 'none', 'aria-hidden': 'true'}),
    })});
}
