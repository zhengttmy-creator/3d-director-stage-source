function __localAutoKeyTransformGroup(track, group, frame, value, base) {
  if (frame > 0) {
    const missing = ['x', 'y', 'z'].filter(axis => !track?.[tR(group, axis)]?.length);
    if (missing.length) {
      // A lone key is extrapolated backwards, so retain the initial pose first.
      const initial = tN(undefined, group, 0, base).track;
      track = {...track};
      for (const axis of missing) {
        const channel = tR(group, axis);
        track[channel] = initial[channel];
      }
    }
  }
  return tN(track, group, frame, value).track;
}

function eh(anchors, kind, fallback) {
  // Euler channels retain authored turns; the nonspatial sampler preserves easing.
  const sampler = __localSampleTransformGroup(anchors, kind === 'rotation' ? 'scale' : kind, fallback);
  return kind === 'rotation' ? Object.freeze({...sampler, kind}) : sampler;
}

function __localContinuousEuler(quaternion, reference) {
  const radians = Math.PI / 180;
  const prior = new so.PTz().setFromEuler(new so.O9p(
    reference.x * radians, reference.y * radians, reference.z * radians, 'XYZ'));
  let direct = 0, negated = 0;
  for (const axis of ['x', 'y', 'z', 'w']) {
    direct += (quaternion[axis] - prior[axis]) ** 2;
    negated += (quaternion[axis] + prior[axis]) ** 2;
  }
  // Avoid spurious rotation keys when only position or scale changed near a singularity.
  if (Math.min(direct, negated) < 1e-24) return {...reference};
  const {x, y, z, w} = quaternion;
  const degrees = 180 / Math.PI;
  const sinX = 2 * (x * w - y * z);
  const cosX = 1 - 2 * (x * x + y * y);
  const cosY = Math.hypot(sinX, cosX);
  const angleY = Math.atan2(2 * (x * z + y * w), cosY) * degrees;
  let angleX, angleZ;
  if (cosY > 1e-10) {
    angleX = Math.atan2(sinX, cosX) * degrees;
    angleZ = Math.atan2(2 * (z * w - x * y), 1 - 2 * (y * y + z * z)) * degrees;
  } else {
    // At the singularity only X +/- Z is defined; retain the last authored Z.
    angleZ = reference.z;
    angleX = Math.atan2(2 * (y * z + x * w), 1 - 2 * (x * x + z * z)) * degrees
      - Math.sign(angleY) * angleZ;
  }
  const candidates = [
    {x: angleX, y: angleY, z: angleZ},
    {x: angleX + 180, y: 180 - angleY, z: angleZ + 180},
  ];
  let best, bestDistance = Infinity;
  for (const candidate of candidates) {
    let distance = 0;
    for (const axis of ['x', 'y', 'z']) {
      candidate[axis] += 360 * Math.round((reference[axis] - candidate[axis]) / 360);
      distance += (candidate[axis] - reference[axis]) ** 2;
    }
    if (distance < bestDistance) {
      best = candidate;
      bestDistance = distance;
    }
  }
  return best;
}
