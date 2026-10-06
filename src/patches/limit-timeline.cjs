const assert = require('node:assert/strict');

function localDirectorTimelineDuration(value, fallback = 20) {
  const candidate = Number.isFinite(value) ? value : Number.isFinite(fallback) ? fallback : 20;
  return Math.min(30, Math.max(0.1, candidate));
}

function localDirectorTimelineNotice() {
  return '\u65f6\u95f4\u8f74\u6700\u957f\u4e3a 30 \u79d2';
}

function localDirectorTimelineBounds(state) {
  const timeline = state?.timeline;
  const result = new Map();
  if (!timeline) return result;
  const fps = Number.isFinite(timeline.displayFps) && timeline.displayFps > 0 ? timeline.displayFps : 30;
  const add = (id, seconds) => {
    if (Number.isFinite(seconds) && seconds > 30 + 1e-7) result.set(id, seconds);
  };
  add('duration', timeline.durationSec);
  for (const clip of timeline.clips ?? []) {
    add('clip:' + clip.id + ':start', clip.startTimeSec);
    add('clip:' + clip.id + ':end', clip.startTimeSec + clip.durationSec);
  }
  const tracks = (prefix, value) => {
    for (const [channel, keys] of Object.entries(value ?? {})) {
      if (!Array.isArray(keys)) continue;
      for (const key of keys) add(prefix + ':' + channel + ':' + key.id, key.frame / fps);
    }
  };
  tracks('camera', timeline.cameraTracks);
  for (const [id, value] of Object.entries(timeline.objectTracks ?? {})) tracks('object:' + id, value);
  for (const camera of state.multiCamera?.cameras ?? []) tracks('multi-camera:' + camera.id, camera.tracks);
  for (const clip of timeline.cameraCutTrack?.clips ?? []) {
    add('cut:' + clip.id + ':start', clip.startFrame / fps);
    add('cut:' + clip.id + ':end', clip.endFrame / fps);
  }
  return result;
}

function localDirectorTimelineExceeds(previous, next) {
  const before = localDirectorTimelineBounds(previous);
  for (const [id, seconds] of localDirectorTimelineBounds(next)) {
    const earlier = before.get(id);
    // Existing out-of-range data may be retained or shortened, never silently removed.
    if (earlier === undefined || seconds > earlier + 1e-7) return true;
  }
  return false;
}

module.exports = function limitTimeline(factories) {
  let source = factories['53401'];
  assert.equal(typeof source, 'string', 'Missing director module 53401');
  assert(!source.includes('function localDirectorTimelineDuration('), 'Timeline limit patch is already installed');
  const changes = [];
  function replace(label, before, after) {
    const index = source.indexOf(before);
    assert(index >= 0, 'Timeline patch anchor missing: ' + label);
    assert.equal(source.indexOf(before, index + before.length), -1, 'Timeline patch anchor ambiguous: ' + label);
    source = source.slice(0, index) + after + source.slice(index + before.length);
    changes.push(label);
  }

  replace('duration submission',
    'r7(Number.isFinite(t)?Math.min(3600,Math.max(.1,t)):e.durationSec,r)',
    'r7(localDirectorTimelineDuration(t,e.durationSec),r)');
  replace('duration normalization',
    'h=iq(e.durationSec,.1,3600,o.durationSec)',
    'h=localDirectorTimelineDuration(e.durationSec,o.durationSec)');
  replace('duration control',
    'label:p.timelineDuration,value:g.durationSec,unit:p.timelineSeconds,min:tk,max:3600',
    'label:p.timelineDuration,value:g.durationSec,unit:p.timelineSeconds,min:Math.min(30,tk),max:30');

  replace('clip insertion boundary',
    'let i=at(e,a,r.displayFps);if(i)return au(e,r.displayFps,"collision",i);let n=r2(a,r.displayFps);return ad([...e,n],n,r.displayFps,a.startFrame!==ao(r.requestedStartFrame))}',
    'let localFps=rq(r.displayFps),localAvailable=30*localFps-a.startFrame,localOriginalDuration=a.durationFrames;if(localAvailable<Math.max(1,Math.round(.05*localFps)))return au(e,r.displayFps,"duration-limit");a.durationFrames=Math.min(a.durationFrames,localAvailable);let i=at(e,a,r.displayFps);if(i)return au(e,r.displayFps,"collision",i);let n=r2(a,r.displayFps);return ad([...e,n],n,r.displayFps,a.startFrame!==ao(r.requestedStartFrame)||a.durationFrames!==localOriginalDuration)}');
  replace('clip limit notice',
    'g("collision"===e.reason?f.timelineClipCollision:f.timelineEditFailed)',
    'g("duration-limit"===e.reason?localDirectorTimelineNotice():"collision"===e.reason?f.timelineClipCollision:f.timelineEditFailed)');
  replace('path timing validation',
    'e.endSec>3600||e.displayFps<=0||!Number.isInteger(e.pointCount)',
    'e.endSec>30||e.displayFps<=0||!Number.isInteger(e.pointCount)');
  replace('path timing defaults',
    'i=Math.min(Math.max(0,Number.isFinite(e.cursorSec)?e.cursorSec:0),Math.max(0,3600-a));return Object.freeze({startSec:i,endSec:Math.min(3600,i+a)})',
    'i=Math.min(Math.max(0,Number.isFinite(e.cursorSec)?e.cursorSec:0),Math.max(0,30-a));return Object.freeze({startSec:i,endSec:Math.min(30,i+a)})');
  replace('path start control',
    'type:"number",min:0,max:3600,step:1/o,value:p,onChange:e=>g(e.target.value)',
    'type:"number",min:0,max:30,step:1/o,value:p,onChange:e=>g(e.target.value)');
  replace('path end control',
    'type:"number",min:0,max:3600,step:1/o,value:f,onChange:e=>h(e.target.value)',
    'type:"number",min:0,max:30,step:1/o,value:f,onChange:e=>h(e.target.value)');
  replace('pose duration control',
    'type:"number",min:.05,max:3600,step:1/iK.timeline.displayFps,value:rC.durationSec',
    'type:"number",min:.05,max:30,step:1/iK.timeline.displayFps,value:rC.durationSec');

  replace('project update validation',
    'let i=g.current,n=nv(i),o=function(e,t){let r=np(e),a=iS(t(nf(r)))',
    'let i=g.current,localPrevious=nf(i),localNext=iS(e(localPrevious));if(localDirectorTimelineExceeds(localPrevious,localNext)){T.current(localDirectorTimelineNotice());return;}let n=nv(i),o=function(e,t){let r=np(e),a=t(nf(r))');
  replace('single updater evaluation',
    'performanceWorkspaces:[l],sharedLibrary:n}}(i,e),s=nv(o);Sr.has(t)',
    'performanceWorkspaces:[l],sharedLibrary:n}}(i,()=>localNext),s=nv(o);Sr.has(t)');

  const helpers = [localDirectorTimelineDuration, localDirectorTimelineNotice, localDirectorTimelineBounds, localDirectorTimelineExceeds]
    .map(fn => fn.toString()).join('\n');
  replace('local limit helpers', 'function rZ(e,t){', helpers + '\nfunction rZ(e,t){');
  factories['53401'] = source;
  return { moduleId: '53401', maximumSeconds: 30, changes, preservesExistingOverLimitContent: true };
};

module.exports.helpers = { localDirectorTimelineDuration, localDirectorTimelineBounds, localDirectorTimelineExceeds };
