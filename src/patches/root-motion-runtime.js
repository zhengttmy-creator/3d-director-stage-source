function __localRootMotionCycles(timeSec, durationSec) {
  return Number.isFinite(timeSec) && Number.isFinite(durationSec) && durationSec > 0
    ? Math.floor(Math.max(0, timeSec) / durationSec) : 0;
}

function s6(motion, timeSec) {
  const sample = __localSampleWrappedMotion(motion, timeSec);
  const cycles = motion.loop && sample.locomotionMode === 'embedded'
    ? __localRootMotionCycles(timeSec, motion.durationSec) : 0;
  if (!cycles) return sample;
  const first = motion.keyframes[0].rootTranslation;
  const last = motion.keyframes.at(-1).rootTranslation;
  if (!first && !last) return sample;
  const translation = {x: 0, y: 0, z: 0, ...sample.rootTranslation};
  for (const axis of ['x', 'z']) {
    translation[axis] = (sample.rootTranslation?.[axis] || 0) + cycles * ((last?.[axis] || 0) - (first?.[axis] || 0));
  }
  return {...sample, rootTranslation: translation};
}

function __localApplyAssetCycleOffset(runtime, player, sample) {
  if (!sample.loop || sample.locomotionMode !== 'embedded' || sample.pathTraversal) return;
  const cycles = __localRootMotionCycles(sample.unwrappedTimeSec, sample.durationSec);
  const root = runtime.bones[0];
  if (!cycles || !root) return;
  if (!player.localCycleDisplacement) {
    // Retargeted root tracks already use the target skeleton's local axes and units.
    const track = player.clip.tracks.find(track => track.name === root.uuid + '.position');
    if (!track) return;
    const interpolant = track.createInterpolant();
    const first = Array.from(interpolant.evaluate(0));
    const last = interpolant.evaluate(player.clip.duration);
    player.localCycleDisplacement = Array.from(last, (value, index) => value - first[index]);
  }
  const delta = player.localCycleDisplacement;
  root.position.x += cycles * delta[0];
  root.position.z += cycles * delta[2];
}

function __localHeldMotion(group, frame) {
  let completed;
  for (const entry of group.clips) {
    if (entry.endFrame <= frame && (!completed || entry.endFrame >= completed.endFrame)) completed = entry;
  }
  const clip = completed?.clip;
  if (!clip || clip.locomotionMode !== 'embedded' || clip.motionUsage === 'path-traversal' ||
      clip.staticPoseTimeSec !== undefined || clip.customPose) return;
  return {kind: 'single', objectId: group.objectId, clip, timelineFrame: completed.endFrame};
}
