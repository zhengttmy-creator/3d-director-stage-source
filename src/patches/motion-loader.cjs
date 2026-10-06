const parser = require('@babel/parser');

const helperSource = `
const __localDirectorMotionCache = new Map();
async function __localDirectorLoadMotion(value) {
  const url = new URL(value, window.location.href);
  if (!url.pathname.endsWith('.motion.json')) return new pD.w().loadAsync(value);
  if (url.origin !== window.location.origin) throw Error('Local motion resources must be same-origin');
  let pending = __localDirectorMotionCache.get(url.href);
  if (!pending) {
    pending = fetch(url.href, {credentials:'omit'}).then(async response => {
      if (!response.ok) throw Error('Local motion download failed: ' + response.status);
      const payload = await response.json();
      const vector = (value, length) => Array.isArray(value) && value.length === length && value.every(Number.isFinite);
      if (payload.format !== 'local-director-animation-clip' || payload.version !== 1 || !Array.isArray(payload.bones) || payload.bones.length !== lV.length) throw Error('Invalid local motion reference rig');
      payload.bones.forEach((bone,index) => {
        const expected = lV[index];
        const parentIndex = lV.findIndex(parent => parent.name === expected.parentName);
        if (bone.name !== expected.name || bone.parentIndex !== parentIndex || !vector(bone.position,3) || !vector(bone.quaternion,4) || !vector(bone.scale,3) || bone.scale.some(value => value <= 0) || Math.hypot(...bone.quaternion) < 1e-8) throw Error('Invalid local motion bone ' + index);
      });
      const clip = payload.clip;
      const names = new Set(payload.bones.map(bone => bone.name));
      if (!clip || !Number.isFinite(clip.duration) || clip.duration <= 0 || clip.duration > 3600 || !Array.isArray(clip.tracks) || !clip.tracks.length || clip.tracks.length > 512) throw Error('Invalid local motion clip');
      let totalValues = 0;
      for (const track of clip.tracks) {
        if (typeof track.name !== 'string') throw Error('Invalid local motion track');
        const split = track.name.lastIndexOf('.');
        const property = track.name.slice(split+1);
        const width = property === 'quaternion' ? 4 : 3;
        if (!names.has(track.name.slice(0,split)) || !['position','quaternion','scale'].includes(property) || track.type !== (property === 'quaternion' ? 'quaternion' : 'vector') || !Array.isArray(track.times) || !track.times.length || track.times.length > 432001 || !Array.isArray(track.values) || track.values.length !== track.times.length * width || !track.values.every(Number.isFinite) || !track.times.every((time,index) => Number.isFinite(time) && time >= 0 && time <= clip.duration + 1e-5 && (!index || time >= track.times[index-1]))) throw Error('Invalid local motion track ' + track.name);
        totalValues += track.values.length;
        if (totalValues > 8000000) throw Error('Local motion exceeds data limit');
      }
      return payload;
    });
    __localDirectorMotionCache.set(url.href,pending);
    pending.catch(() => __localDirectorMotionCache.delete(url.href));
  }
  const payload = await pending;
  const group = new so.YJl();
  const bones = payload.bones.map(definition => {
    const bone = new so.$Kf();
    bone.name = definition.name;
    bone.position.fromArray(definition.position);
    bone.quaternion.fromArray(definition.quaternion).normalize();
    bone.scale.fromArray(definition.scale);
    return bone;
  });
  payload.bones.forEach((definition,index) => (definition.parentIndex < 0 ? group : bones[definition.parentIndex]).add(bones[index]));
  const clip = so.tz3.parse(payload.clip);
  if (!clip.validate()) throw Error('Local animation failed track validation');
  group.animations = [clip];
  group.updateMatrixWorld(true);
  return group;
}
`;

function replaceOnce(source, before, after) {
  if (source.split(before).length !== 2) throw new Error(`Expected exactly one motion loading patch target: ${before}`);
  return source.replace(before, after);
}

function patchMotionLoader(source) {
  if (source.includes('const __localDirectorMotionCache')) return source;
  let result = replaceOnce(source, 'let r=await new pD.w().loadAsync(e.mediaUrl);', 'let r=await __localDirectorLoadMotion(e.mediaUrl);');
  result = replaceOnce(result, 'a=new pD.w().loadAsync(i).catch', 'a=__localDirectorLoadMotion(i).catch');
  result = replaceOnce(result, 'async function p3(e,t){', helperSource + 'async function p3(e,t){');
  parser.parse(`(${result})`);
  return result;
}

module.exports = {patchMotionLoader, helperSource};
