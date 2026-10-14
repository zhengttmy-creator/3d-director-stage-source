// Cameras use the application's right-handed, Y-up coordinates. Angles are
// degrees in YXZ Euler order: X pitch, Y yaw, Z roll; forward is local -Z.
// Unwrapped authored angles are retained so 0 -> 720 performs two complete turns.
function __localIsCameraRotation(value) {
  return !!value && ['x', 'y', 'z'].every(axis => Number.isFinite(value[axis]));
}

function __localCameraNearestAngle(value, reference) {
  return Number.isFinite(reference) ? value + 360 * Math.round((reference - value) / 360) : value;
}

function __localCameraRotation(camera) {
  if (__localIsCameraRotation(camera.rotation)) return {...camera.rotation};
  return __localCameraRotationFromQuaternion(__localLegacyCameraQuaternion(camera));
}

function __localCameraRotationFromQuaternion(quaternion, referenceRotation) {
  const euler = new so.O9p().setFromQuaternion(quaternion, 'YXZ');
  const principal = {x: euler.x * 180 / Math.PI, y: euler.y * 180 / Math.PI, z: euler.z * 180 / Math.PI};
  if (!__localIsCameraRotation(referenceRotation)) return principal;
  // YXZ has equivalent solutions on either side of its pitch singularity.
  // Pick the solution nearest the authored angles before unwrapping full turns.
  const alternatives = [principal, {x: 180 - principal.x, y: principal.y + 180, z: principal.z + 180}];
  for (const item of alternatives) for (const axis of ['x', 'y', 'z'])
    item[axis] = __localCameraNearestAngle(item[axis], referenceRotation[axis]);
  const distance = item => ['x', 'y', 'z'].reduce((sum, axis) => sum + (item[axis] - referenceRotation[axis]) ** 2, 0);
  return distance(alternatives[0]) <= distance(alternatives[1]) ? alternatives[0] : alternatives[1];
}

function __localCameraQuaternion(camera) {
  const rotation = __localCameraRotation(camera);
  return new so.PTz().setFromEuler(new so.O9p(rotation.x * Math.PI / 180,
    rotation.y * Math.PI / 180, rotation.z * Math.PI / 180, 'YXZ'));
}

function __localCameraWithTransform(camera, changes = {}) {
  const position = changes.position ? {...changes.position} : {...camera.position};
  const rotation = __localIsCameraRotation(changes.rotation) ? {...changes.rotation} : __localCameraRotation(camera);
  const distance = Math.hypot(camera.target.x - camera.position.x,
    camera.target.y - camera.position.y, camera.target.z - camera.position.z);
  const forward = new so.Pq0(0, 0, -1).applyQuaternion(__localCameraQuaternion({...camera, rotation}));
  const length = distance > 1e-7 ? distance : 5;
  return {...camera, position, rotation, target: {x: position.x + forward.x * length,
    y: position.y + forward.y * length, z: position.z + forward.z * length}, roll: rotation.z,
    targetHelperVisible: false, targetLocked: false};
}

function __localCameraWithPosition(camera, position) {
  return __localCameraWithTransform(camera, {position});
}

function __localCameraWithRotation(camera, rotation) {
  return __localCameraWithTransform(camera, {rotation});
}

function __localCameraFromLegacyTarget(camera, referenceRotation) {
  const legacy = {...camera};
  delete legacy.rotation;
  const rotation = __localCameraRotationFromQuaternion(__localLegacyCameraQuaternion(legacy), referenceRotation);
  return __localCameraWithRotation(camera, rotation);
}

function __localCameraLegacyScene(canonical) {
  const scene = __localLegacyCameraProjection(canonical);
  delete scene.rotation;
  return scene;
}

function __localSimplifyCameraRotationKeys(keys, tolerance = 1e-4) {
  if (keys.length <= 2) return keys;
  const keep = new Set([0, keys.length - 1]);
  for (let index = 0; index < keys.length - 1; index++) if (keys[index].interpolation === 'hold') {
    keep.add(index); keep.add(index + 1);
  }
  const pending = [];
  const anchors = [...keep].sort((a,b) => a-b);
  for (let index = 1; index < anchors.length; index++) pending.push([anchors[index - 1], anchors[index]]);
  while (pending.length) {
    const [first,last] = pending.pop();
    if (last <= first + 1) continue;
    const start = keys[first], end = keys[last];
    let maximum = tolerance, selected = -1;
    for (let index = first + 1; index < last; index++) {
      const value = start.value + (end.value - start.value) * (keys[index].frame - start.frame) / (end.frame - start.frame);
      const error = Math.abs(keys[index].value - value);
      if (error > maximum) {maximum = error; selected = index;}
    }
    if (selected >= 0) {keep.add(selected); pending.push([first,selected],[selected,last]);}
  }
  return keys.filter((_, index) => keep.has(index));
}

function __localCameraPrepareCanonical(camera) {
  if (!camera || typeof camera !== 'object' || !camera.transform || !camera.target || !camera.lens || !camera.authoring) return camera;
  const tracks = {...camera.tracks};
  for (const channel of ['rotation.x', 'rotation.y', 'rotation.z']) if (tracks[channel] === undefined) tracks[channel] = [];
  if (__localIsCameraRotation(camera.transform.rotation)) {
    return {...camera, tracks, authoring: {...camera.authoring, targetHelperVisible: false, targetLocked: false}};
  }
  if (camera.transform.rotation !== undefined) return camera;
  if (!camera.transform.position || !camera.target.position || !Number.isFinite(camera.lens.roll)) return camera;
  const scene = __localCameraLegacyScene(camera);
  const rotation = __localCameraRotation(scene);
  const oldChannels = ['position.x', 'position.y', 'position.z', 'target.x', 'target.y', 'target.z', 'lens.roll'];
  const legacyKeys = oldChannels.flatMap(channel => Array.isArray(tracks[channel]) ? tracks[channel] : []);
  if (legacyKeys.some(key => !Number.isInteger(key.frame) || key.frame < 0 || !Number.isFinite(key.value))) return camera;
  const maxFrame = legacyKeys.reduce((maximum, key) => Math.max(maximum, key.frame), 0);
  if (legacyKeys.length && maxFrame <= 18000) {
    const sampler = __localLegacyCameraSampler(scene, tracks);
    let previous = rotation;
    let previousQuaternion;
    const createdAt = legacyKeys.find(key => typeof key.createdAt === 'string')?.createdAt || new Date(0).toISOString();
    for (let frame = 0; frame <= maxFrame; frame++) {
      const sampled = sampler.sample(frame);
      delete sampled.rotation;
      const next = __localCameraFromLegacyTarget(sampled, previous).rotation;
      const quaternion = __localLegacyCameraQuaternion(sampled);
      if (frame > 0 && previousQuaternion) {
        const mid = sampler.sample(frame - .5);
        delete mid.rotation;
        const midpoint = __localLegacyCameraQuaternion(mid);
        if (previousQuaternion.angleTo(midpoint) < 1e-8 && previousQuaternion.angleTo(quaternion) > 1e-7)
          for (const axis of ['x', 'y', 'z']) tracks['rotation.' + axis].at(-1).interpolation = 'hold';
      }
      for (const axis of ['x', 'y', 'z']) {
        const id = 'camera-rotation-migration-' + camera.id + '-' + axis + '-' + frame;
        tracks['rotation.' + axis].push({id, frame, value: next[axis], interpolation: 'linear', createdAt});
      }
      previous = next;
      previousQuaternion = quaternion;
    }
    for (const axis of ['x', 'y', 'z']) tracks['rotation.' + axis] = __localSimplifyCameraRotationKeys(tracks['rotation.' + axis]);
  } else if (legacyKeys.length) {
    // Reject an unreasonable legacy range instead of hanging or dropping motion.
    return camera;
  }
  for (const channel of ['target.x', 'target.y', 'target.z', 'lens.roll']) tracks[channel] = [];
  return {...camera, transform: {...camera.transform, rotation}, tracks,
    authoring: {...camera.authoring, targetHelperVisible: false, targetLocked: false}};
}

function __localCameraNativeSampler(camera, tracks) {
  const sampler = __localLegacyCameraSampler(camera, tracks);
  if (!__localIsCameraRotation(camera.rotation)) return sampler;
  const sample = frame => {
    const value = sampler.sample(frame);
    const rotation = {x: sampler.sampleChannel('rotation.x', frame),
      y: sampler.sampleChannel('rotation.y', frame), z: sampler.sampleChannel('rotation.z', frame)};
    return __localCameraWithRotation(value, rotation);
  };
  // Use numeric Euler distance for timing, not the object's shortest quaternion
  // arc: a 720-degree camera key is a deliberate two-turn movement.
  const numericGroup = eh(ef({tracks: {x: sampler.tracks['rotation.x'], y: sampler.tracks['rotation.y'], z: sampler.tracks['rotation.z']},
    sampleAxis: (axis, frame) => sampler.sampleChannel('rotation.' + axis, frame)}), 'scale', camera.rotation);
  const group = {...numericGroup, kind:'rotation', sample: frame=>sample(frame).rotation,
    sampleMany: frames=>frames.map(frame=>sample(frame).rotation)};
  return {...sampler, vectorGroups: {...sampler.vectorGroups, rotation: group},
    sampleChannel: (channel, frame) => channel.startsWith('target.') ? sample(frame).target[channel.slice(7)] : sampler.sampleChannel(channel, frame),
    sample, sampleMany: frames => frames.map(sample)};
}

function __localCameraRecordTransform(camera, tracks, frame, values, metadata) {
  const legacy = Object.keys(values).filter(channel => channel.startsWith('target.') || channel === 'lens.roll');
  if (!__localIsCameraRotation(camera.rotation) || !legacy.length)
    return __localLegacyCameraRecord(camera, tracks, frame, values, metadata);
  const sampled = eK(camera, tracks).sample(frame);
  const pose = {...sampled, position: {...sampled.position}, target: {...sampled.target}};
  for (const channel of Object.keys(values)) {
    const [group, axis] = channel.split('.');
    if (group === 'position' || group === 'target') pose[group][axis] = values[channel];
    else if (channel === 'lens.roll') pose.roll = values[channel];
  }
  const rotation = __localCameraFromLegacyTarget(pose, sampled.rotation).rotation;
  const next = {...values}, options = {...metadata};
  for (const channel of legacy) {delete next[channel]; delete options[channel];}
  const legacyOption = legacy.map(channel => metadata?.[channel]).find(Boolean);
  for (const axis of ['x', 'y', 'z']) {
    const channel = 'rotation.' + axis;
    if (!Object.hasOwn(next, channel)) next[channel] = rotation[axis];
    if (!options[channel] && legacyOption) options[channel] = {
      ...legacyOption, ...(legacyOption.id ? {id: legacyOption.id + '-' + channel} : {}), spatialTangents: undefined,
    };
  }
  const result = __localLegacyCameraRecord(camera, tracks, frame, next, options);
  // Legacy path writers consume keyframe objects by the channels they passed.
  // Keep these return aliases only; the stored tracks contain rotation keys.
  for (const channel of legacy) result.keyframes[channel] = result.keyframes['rotation.' + (channel === 'lens.roll' ? 'z' : channel.slice(-1))];
  return result;
}

function __localCameraConvertLegacyCommitTracks(camera, tracks, cameraId) {
  const oldChannels = ['target.x', 'target.y', 'target.z', 'lens.roll'];
  const keys = oldChannels.flatMap(channel => tracks[channel] || []);
  if (!keys.length || !__localIsCameraRotation(camera.rotation)) return tracks;
  const first = Math.min(...keys.map(key => key.frame)), last = Math.max(...keys.map(key => key.frame));
  const legacy = {...camera}; delete legacy.rotation;
  const canonical = __localLegacyCameraCreate({...legacy,id:cameraId||camera.id,name:'Legacy path'});
  canonical.tracks = {...tracks, 'rotation.x': [], 'rotation.y': [], 'rotation.z': []};
  const converted = __localCameraPrepareCanonical(canonical);
  if (!__localIsCameraRotation(converted.transform.rotation)) return tracks;
  const merged = {...tracks};
  const sampled = eK(t0(converted), converted.tracks);
  for (const channel of oldChannels) merged[channel] = [];
  for (const axis of ['x','y','z']) {
    const channel = 'rotation.' + axis;
    const inserted = converted.tracks[channel].filter(key => key.frame >= first && key.frame <= last);
    for (const frame of new Set([first,last])) if (!inserted.some(key=>key.frame===frame)) {
      const old=(tracks[channel]||[]).find(key=>key.frame===frame);
      inserted.push({id:old?.id||'camera-rotation-migration-'+canonical.id+'-'+axis+'-'+frame,frame,
        value:sampled.sampleChannel(channel,frame),interpolation:'linear',createdAt:old?.createdAt||keys[0].createdAt});
    }
    merged[channel] = [...(tracks[channel] || []).filter(key => key.frame < first || key.frame > last),...inserted].sort((a,b) => a.frame-b.frame);
  }
  return merged;
}
