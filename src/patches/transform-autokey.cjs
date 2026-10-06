const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

module.exports = function patchTransformAutoKey(factories) {
  let source = factories['53401'];
  const replace = (label, before, after) => {
    assert.equal(source.split(before).length, 2, 'Transform auto-key patch anchor: ' + label);
    source = source.replace(before, after);
  };
  replace('initial transform keys', 'function tN(e,t,r,a){',
    fs.readFileSync(path.join(__dirname, 'transform-autokey-runtime.js'), 'utf8') + '\nfunction tN(e,t,r,a){');
  replace('continuous Euler rotation sampling', 'function eh(e,t,r){', 'function __localSampleTransformGroup(e,t,r){');
  replace('gizmo initial Euler angles',
    'quaternion:a.root.quaternion.clone(),scale:a.root.scale.clone()',
    'quaternion:a.root.quaternion.clone(),rotation:{...r.transform.rotation},scale:a.root.scale.clone()');
  replace('gizmo continuous Euler preview and commit',
    'let i=AH(t.root),n=()=>a.lightKind?',
    'let i=AH(t.root);i.rotation=__localContinuousEuler(t.root.quaternion,a.rotation);a.rotation={...i.rotation};let n=()=>a.lightKind?');
  replace('transform commits after frame zero',
    'a||c?(l=tN(l,e,n,o[e]).track,i=!0):s={...s,[e]:{...o[e]}}',
    'a||c||n>0||"rotation"===e||"scale"===e?(l=c?tN(l,e,n,o[e]).track:__localAutoKeyTransformGroup(l,e,n,o[e],s[e]),i=!0):s={...s,[e]:{...o[e]}}');
  factories['53401'] = source;
};
