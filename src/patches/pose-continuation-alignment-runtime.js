function le(clip, frame, fps, motions, options) {
  const sample = __localSampleUnalignedClip(clip, frame, fps, motions, options);
  const anchor = clip.poseContinuationAnchor;
  if (!sample || !anchor || clip.motionUsage === 'path-traversal' || sample.pathTraversal) return sample;
  const source = __localSampleUnalignedClip(clip, clip.startTimeSec * fps, fps, motions, options);
  if (!source || source.pathTraversal) return sample;
  return {...sample, __localPoseContinuation:{anchor, source, identity:clip}};
}

function x5(scene, runtime, state, sample) {
  const continuation = sample?.__localPoseContinuation;
  const root = runtime.bones[0];
  if (!continuation || !root || sample.pathTraversal ||
      continuation.anchor.signature !== runtime.rigSignature) {
    return __localApplyUnalignedMotion(scene, runtime, state, sample);
  }
  const cache = runtime.localPoseContinuationCache ??= new WeakMap();
  let alignment = cache.get(continuation.identity);
  if (!alignment) {
    // Evaluate both references through the real retargeter so units and bind spaces agree.
    x2(runtime);
    if (!__localApplyUnalignedMotion(scene, runtime, state, continuation.source)) {
      x2(runtime);
      return __localApplyUnalignedMotion(scene, runtime, state, sample);
    }
    const sourcePosition = root.position.clone();
    const sourceRotation = root.quaternion.clone();
    x2(runtime);
    if (!__localApplyUnalignedMotion(scene, runtime, state, continuation.anchor)) {
      x2(runtime);
      return __localApplyUnalignedMotion(scene, runtime, state, sample);
    }
    const anchorPosition = root.position.clone();
    const difference = root.quaternion.clone().multiply(sourceRotation.invert()).normalize();
    const yawLength = Math.hypot(difference.y, difference.w);
    const yaw = yawLength > 1e-8
      ? new so.PTz(0, difference.y / yawLength, 0, difference.w / yawLength)
      : new so.PTz();
    alignment = {sourcePosition, anchorPosition, yaw};
    cache.set(continuation.identity, alignment);
  }
  x2(runtime);
  if (!__localApplyUnalignedMotion(scene, runtime, state, sample)) return false;
  root.position.sub(alignment.sourcePosition).applyQuaternion(alignment.yaw).add(alignment.anchorPosition);
  root.quaternion.premultiply(alignment.yaw).normalize();
  runtime.root.updateMatrixWorld(true);
  return true;
}
