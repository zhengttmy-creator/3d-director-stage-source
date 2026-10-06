const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

module.exports = function patchPoseContinuationAlignment(factories) {
  let source = factories['53401'];
  const replace = (label, before, after) => {
    assert.equal(source.split(before).length, 2, 'Pose continuation alignment anchor: ' + label);
    source = source.replace(before, after);
  };
  replace('clip sampler', 'function le(e,t,r,a,i){',
    fs.readFileSync(path.join(__dirname, 'pose-continuation-alignment-runtime.js'), 'utf8') +
    '\nfunction __localSampleUnalignedClip(e,t,r,a,i){');
  replace('skeleton renderer', 'function x5(e,t,r,a){', 'function __localApplyUnalignedMotion(e,t,r,a){');
  factories['53401'] = source;
};
