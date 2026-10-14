const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const parser = require('@babel/parser');

module.exports = function patchCameraTransformModel(factories) {
  let source = factories['53401'];
  const replace = (label, before, after) => {
    assert.equal(source.split(before).length, 2, 'Camera transform anchor changed: ' + label);
    source = source.replace(before, after);
  };
  replace('camera channels', 'eH=["position.x","position.y","position.z","target.x","target.y","target.z","lens.fov","lens.roll"]',
    'eH=["position.x","position.y","position.z","target.x","target.y","target.z","lens.fov","lens.roll","rotation.x","rotation.y","rotation.z"]');
  const ast = parser.parse('(' + source + ')');
  const functions = new Map(ast.program.body[0].expression.body.body.filter(node => node.type === 'FunctionDeclaration')
    .map(node => [node.id.name, node]));
  const edits = [];
  const rewrite = (name, transform) => {
    const node = functions.get(name);
    assert.ok(node, 'Camera transform function ' + name);
    edits.push({start: node.start - 1, end: node.end - 1, text: transform(source.slice(node.start - 1, node.end - 1))});
  };
  rewrite('eK', code => code.replace('function eK(', 'function __localLegacyCameraSampler(')
    + '\nfunction eK(camera,tracks){return __localCameraNativeSampler(camera,tracks)}');
  rewrite('sp', code => code.replace('function sp(', 'function __localLegacyCameraQuaternion(')
    + '\nfunction sp(camera){return __localIsCameraRotation(camera.rotation)?__localCameraQuaternion(camera):__localLegacyCameraQuaternion.apply(null,arguments)}');
  rewrite('eZ', code => code.replace('function eZ(', 'function __localLegacyCameraChannel(')
    + '\nfunction eZ(camera,channel){return channel.startsWith("rotation.")?__localCameraRotation(camera)[channel.slice(9)]:__localLegacyCameraChannel(camera,channel)}');
  rewrite('e6', code => code.replace('function e6(', 'function __localLegacyCameraClone(')
    + '\nfunction e6(camera){const result=__localLegacyCameraClone(camera);if(__localIsCameraRotation(camera.rotation))result.rotation={...camera.rotation};return result}');
  rewrite('eW', code => code.replace('e[t].map(e7)', '(e[t]||[]).map(e7)'));
  rewrite('eJ', code => code.replace('function eJ(', 'function __localLegacyCameraRecord(')
    .replace('return eq(e)&&', 'return (eq(e)||e.startsWith("rotation."))&&')
    + '\nfunction eJ(camera,tracks,frame,values,metadata){return __localCameraRecordTransform(camera,tracks,frame,values,metadata)}');
  rewrite('t0', code => code.replace('function t0(', 'function __localLegacyCameraProjection(')
    + '\nfunction t0(camera){const result=__localLegacyCameraProjection(camera);return __localCameraWithRotation(result,__localIsCameraRotation(camera.transform.rotation)?camera.transform.rotation:__localCameraRotation(result))}');
  rewrite('t7', () => 'function t7(camera){return t0(camera)}');
  rewrite('t4', code => code.replace('function t4(', 'function __localLegacyCameraCanonical(')
    + '\nfunction t4(camera,migrate){const prepared=__localCameraPrepareCanonical(camera);const result=__localLegacyCameraCanonical(prepared,migrate);if(!result||!__localIsCameraRotation(prepared.transform.rotation))return;result.transform.rotation={...prepared.transform.rotation};result.authoring.targetHelperVisible=false;result.authoring.targetLocked=false;return result}');
  rewrite('t1', code => code.replace('function t1(', 'function __localLegacyCameraCommit(')
    + '\nfunction t1(document,edit){const scene=__localCameraWithTransform(edit.sceneCamera),tracks=__localCameraConvertLegacyCommitTracks(scene,edit.tracks,edit.cameraId);const result=__localLegacyCameraCommit(document,{...edit,sceneCamera:scene,tracks});if(result.ok){result.camera.transform.rotation={...scene.rotation};result.document.cameras=result.document.cameras.map(camera=>camera.id===edit.cameraId?result.camera:camera)}return result}');
  rewrite('re', code => code.replace('function re(', 'function __localLegacyCameraCreate(')
    + '\nfunction re(input){const result=__localLegacyCameraCreate(input);result.transform.rotation=__localCameraRotation(input);result.authoring.targetHelperVisible=false;result.authoring.targetLocked=false;return result}');
  rewrite('iH', code => code.replace('function iH(', 'function __localLegacyCameraNormalize(')
    + '\nfunction iH(input){const result=__localLegacyCameraNormalize(input);if(__localIsCameraRotation(input?.rotation))return __localCameraWithRotation(result,input.rotation);return result}');
  rewrite('iG', code => code.replace('function iG(', 'function __localLegacySceneCameraClone(')
    + '\nfunction iG(camera){const result=__localLegacySceneCameraClone(camera);if(__localIsCameraRotation(camera.rotation))result.rotation={...camera.rotation};return result}');
  rewrite('tZ', code => {
    const old = 'transform:{position:rl(i.position)}';
    assert.equal(code.split(old).length, 2, 'Singular legacy rotation migration');
    return code.replace(old, 'transform:{position:rl(i.position),...__localIsCameraRotation(i.rotation)?{rotation:{...i.rotation}}:{}}');
  });
  rewrite('ko', code => {
    const old = 'transform:{position:kN(t.position)}';
    if (code.includes('__localEncodeCameraDocument(e)')) return code;
    assert.equal(code.split(old).length, 2, 'Portable workspace camera export');
    return code.replace(old,'transform:{position:kN(t.position),...__localIsCameraRotation(t.rotation)?{rotation:kN(t.rotation)}:{}}');
  });
  if (functions.has('__localEncodeCameraDocument')) rewrite('__localEncodeCameraDocument', code => {
    const old = 'transform: {position: kN(camera.position)}';
    assert.equal(code.split(old).length, 2, 'Empty-compatible portable workspace camera export');
    return code.replace(old, 'transform: {position: kN(camera.position), ...__localIsCameraRotation(camera.rotation) ? {rotation:kN(camera.rotation)} : {}}');
  });
  rewrite('ks', code => {
    const old = 'position:kN(t.transform.position),target:kN(t.target.position)';
    assert.equal(code.split(old).length, 2, 'Portable workspace camera import');
    return code.replace(old,'position:kN(t.transform.position),...__localIsCameraRotation(t.transform.rotation)?{rotation:kN(t.transform.rotation)}:{},target:kN(t.target.position)');
  });
  rewrite('kp', code => {
    const tracks = 'eH.every(t=>Array.isArray(e[t])&&e[t].every(ky))';
    const transform = 'kT(a=s.transform)&&kb(a.position)';
    assert.equal(code.split(tracks).length,2,'Portable legacy camera track validation');
    assert.equal(code.split(transform).length,2,'Portable camera rotation validation');
    return code.replace(tracks,'eH.every(t=>t.startsWith("rotation.")&&e[t]===void 0||Array.isArray(e[t])&&e[t].every(ky))')
      .replace(transform,'kT(a=s.transform)&&kb(a.position)&&(a.rotation===void 0||kb(a.rotation))');
  });
  for (const edit of edits.sort((a,b) => b.start - a.start)) source = source.slice(0, edit.start) + edit.text + source.slice(edit.end);
  source = source.replace('function __localLegacyCameraSampler(',
    fs.readFileSync(path.join(__dirname, 'camera-transform-model-runtime.js'), 'utf8') + '\nfunction __localLegacyCameraSampler(');
  factories['53401'] = source;
};
