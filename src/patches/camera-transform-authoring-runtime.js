function __localCameraTransformChannels() {
  return ['position.x', 'position.y', 'position.z', 'rotation.x', 'rotation.y', 'rotation.z', 'lens.fov'];
}

function __localCameraTransformPose(camera, incoming, channels = __localCameraTransformChannels()) {
  const position = {...camera.position}, rotation = __localCameraRotation(camera);
  let fov = camera.fov;
  if (!camera.cameraLocked) for (const channel of channels) {
    if (!__localCameraTransformChannels().includes(channel)) continue;
    const [group, axis] = channel.split('.');
    const value = e3(channel, eZ(incoming, channel), eZ(camera, channel));
    if (group === 'position') position[axis] = value;
    else if (group === 'rotation') rotation[axis] = value;
    else fov = value;
  }
  return __localCameraWithTransform({...camera, fov}, {position, rotation});
}

function __localCameraTransformDraftValue(owner, camera, tracks, pose) {
  const sampled = eK(camera, tracks).sample(owner.frame);
  const current = __localCameraTransformPose(sampled, pose);
  const channels = __localCameraTransformChannels().filter(channel => Math.abs(eZ(current, channel) - eZ(sampled, channel)) > 1e-7);
  return channels.length ? {...owner, signature: __localManualCameraSignature(camera, tracks), camera: current, channels} : null;
}

function __localCameraTransformEdit(camera, tracks, displayed, incoming, channels) {
  const next = __localCameraTransformPose(displayed, incoming, channels);
  const changed = channels.some(channel => Math.abs(eZ(next, channel) - eZ(displayed, channel)) > 1e-7);
  if (!changed) return {changed: false, camera, pending: null};
  return __localCameraTransformChannels().some(channel => tracks[channel]?.length)
    ? {changed: true, camera, pending: next}
    : {changed: true, camera: __localCameraTransformPose(camera, next, channels), pending: null};
}
