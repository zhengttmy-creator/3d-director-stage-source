const assert = require('node:assert/strict');

module.exports = function patchCameraPositionAutoKey(factories) {
  let source = factories['53401'];
  const replace = (label, before, after) => {
    assert.equal(source.split(before).length, 2, 'Camera position auto-key patch anchor: ' + label);
    source = source.replace(before, after);
  };
  replace('camera position baseline helper', 'function eJ(e,t,r,a){', `
function __localAutoKeyCameraPosition(camera, tracks, frame, values) {
  if (frame > 0) {
    const initial = Object.fromEntries(Object.keys(values)
      .filter(channel => (channel.startsWith('position.') || channel.startsWith('target.')) && !tracks[channel]?.length)
      .map(channel => [channel, eZ(camera, channel)]));
    // Preserve the starting composition before authoring the first later key.
    if (Object.keys(initial).length) tracks = eJ(camera, tracks, 0, initial).tracks;
  }
  return eJ(camera, tracks, frame, values);
}
function eJ(e,t,r,a){`);
  replace('camera and target position commits',
    'if(l.add(d),o.some(e=>t.timeline.cameraTracks[e].length>0)){let t=eJ(r,a,n,Object.fromEntries(o.map(t=>[t,eZ(e,t)])));',
    'if(l.add(d),o.some(e=>t.timeline.cameraTracks[e].length>0)||n>0&&(c.startsWith("position.")||c.startsWith("target."))){let t=__localAutoKeyCameraPosition(r,a,n,Object.fromEntries(o.map(t=>[t,eZ(e,t)])));');
  factories['53401'] = source;
};
