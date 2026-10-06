const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

module.exports = function patchRootMotion(factories) {
  let source = factories['53401'];
  const changes = [];
  const replace = (label, before, after) => {
    assert.equal(source.split(before).length, 2, 'Root motion patch anchor: ' + label);
    source = source.replace(before, after);
    changes.push(label);
  };
  replace('continuous native root translation', 'function s6(e,t){',
    fs.readFileSync(path.join(__dirname, 'root-motion-runtime.js'), 'utf8') + '\nfunction __localSampleWrappedMotion(e,t){');
  replace('native catalog effective locomotion',
    'return {...s6({...motion, loop}, timeSec), locomotionMode};',
    'return s6({...motion, loop, locomotion: {...motion.locomotion, mode: pathTraversal ? "in-place" : locomotionMode}}, timeSec);');
  replace('unwrapped asset sample time',
    'durationSec: motion.durationSec, loop, locomotionMode,',
    'durationSec: motion.durationSec, loop, locomotionMode, unwrappedTimeSec: timeSec,');
  replace('native saved clip effective locomotion',
    'return{...s6(g===m.loop?m:{...m,loop:g},p),locomotionMode:e.locomotionMode}',
    'return s6({...m,loop:g,locomotion:{...m.locomotion,mode:e.motionUsage===ap?"in-place":e.locomotionMode}},p)');
  replace('bounded import preview',
    'sample:s6({...t,loop:r},e)',
    'sample:__localSampleWrappedMotion({...t,loop:r},e)');
  replace('retargeted asset cycle displacement',
    'p.mixer.setTime(g),d.root.updateMatrixWorld(!0),!0)',
    'p.mixer.setTime(g),__localApplyAssetCycleOffset(d,u,m),d.root.updateMatrixWorld(!0),!0)');
  replace('completed motion position hold',
    'if(r<0)continue;let a=e.clips[r],n=',
    'if(r<0){let held=__localHeldMotion(e,t);if(held)i.push(held);continue}let a=e.clips[r],n=');
  factories['53401'] = source;
  return {moduleId: '53401', changes};
};
