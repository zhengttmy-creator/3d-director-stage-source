const assert = require('node:assert/strict');

module.exports = function patchNewCameraSelection(factories) {
  let source = factories['53401'];
  const replace = (label, before, after) => {
    assert.equal(source.split(before).length, 2, 'New camera selection anchor changed: ' + label);
    source = source.replace(before, after);
  };
  // ny accepts the newly committed document; dt/nA would validate against the old
  // render's camera list and reject a camera created in this same event.
  replace('timeline creation owns the editing camera',
    'nP(insertion.startFrame/iK.timeline.displayFps);rr({kind:"storyboard"});re({kind:"storyboard"});return true;',
    `nP(insertion.startFrame/iK.timeline.displayFps);
      if(request.newCamera){ny(result.cameraId,result.state.multiCamera);de("camera");cP()}
      else rr({kind:"storyboard"});
      re({kind:"storyboard"});return true;`);
  // Asset presets already select their own camera, but left the main viewport in
  // director view (or retained an object selection). Finish entering camera control.
  replace('asset creation enters camera control',
    'ny(a.camera.id,a.document),!0)},[ny,a2,ii,sq,Q.cameraShotPresetLabels,Q.multiCameraGeneratedCameraName,il,iK.objects])',
    `ny(a.camera.id,a.document),iE({mode:"object",selectedObjectIds:[],selectedJointId:void 0}),a6([a.camera.id]),cP(),re({kind:"storyboard"}),!0)},[ny,a2,ii,sq,Q.cameraShotPresetLabels,Q.multiCameraGeneratedCameraName,il,iK.objects,iE,cP])`);
  factories['53401'] = source;
};
