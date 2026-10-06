const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const parser = require('@babel/parser');
const traverse = require('@babel/traverse').default;

module.exports = function patchEmptyCameras(factories) {
  let source = factories['53401'];
  const replace = (label, before, after) => {
    assert.equal(source.split(before).length, 2, 'Empty cameras patch anchor changed: ' + label);
    source = source.replace(before, after);
  };
  replace('runtime', 'function tY(e,t){',
    fs.readFileSync(path.join(__dirname, 'empty-cameras-runtime.js'), 'utf8') + '\nfunction tY(e,t){');
  replace('empty canonical document',
    'if(!Array.isArray(e.cameras)||0===e.cameras.length)return{ok:!1,reason:"invalid-document"};let r=[],a=new Set;',
    'if(!Array.isArray(e.cameras))return{ok:!1,reason:"invalid-document"};if(0===e.cameras.length)return e.outputCameraId===""?{ok:!0,document:{schemaVersion:3,cameras:[],outputCameraId:""}}:{ok:!1,reason:"invalid-document"};let r=[],a=new Set;');
  replace('empty preview session',
    'function t_(e){let t=arguments.length>1&&void 0!==arguments[1]?arguments[1]:e.outputCameraId;return ri(e,t)?',
    'function t_(e){let t=arguments.length>1&&void 0!==arguments[1]?arguments[1]:e.outputCameraId;return (e.cameras.length===0&&t===""||ri(e,t))?');
  replace('first camera output',
    'outputCameraId:"select-new"===t.outputPolicy?r.id:e.outputCameraId',
    'outputCameraId:0===e.cameras.length||"select-new"===t.outputPolicy?r.id:e.outputCameraId');
  replace('empty projection', 'function oO(e,t,r){let a=t$(t,r);',
    'function oO(e,t,r){if(t.cameras.length===0)return __localEmptyCameraProjection(e,t);let a=t$(t,r);');
  replace('empty preview source', 'function cr(e){let t=e.document.cameras.map(',
    'function cr(e){if(e.document.cameras.length===0)return __localEmptyCameraSource(e);let t=e.document.cameras.map(');
  replace('empty serialized camera validation',
    'if(!kT(e)||1!==e.schemaVersion||!Array.isArray(e.cameras)||0===e.cameras.length||!kF(e.outputCameraId))return!1;let t=new Set,r=0;',
    'if(!kT(e)||1!==e.schemaVersion||!Array.isArray(e.cameras))return!1;if(e.cameras.length===0)return e.outputCameraId==="";if(!kF(e.outputCameraId))return!1;let t=new Set,r=0;');
  replace('empty serialized camera decode', 'let i=function(e){let t=e.cameras.find(e=>"main"===e.role);',
    'let i=function(e){if(e.cameras.length===0&&e.outputCameraId==="")return __localDecodeEmptyCameraDocument();let t=e.cameras.find(e=>"main"===e.role);');
  replace('preserve single canonical camera identity',
    'if(1===e.cameras.length)return{sceneCamera:r,mainCameraTracks:kN(t.tracks)};let a=e.cameras.map(',
    'let a=e.cameras.map(');

  let serialization;
  traverse(parser.parse('(' + source + ')'), {ObjectProperty(entry) {
    const node = entry.node;
    if (node.key.name === 'cameras' && node.value.type === 'SequenceExpression' &&
        source.slice(node.value.start - 1, node.value.end - 1).includes('schemaVersion:1,cameras:[i,...n]')) {
      assert.equal(serialization, undefined, 'Camera serializer must be unique');
      serialization = node.value;
    }
  }});
  assert.ok(serialization, 'Camera serializer missing');
  source = source.slice(0, serialization.start - 1) + '__localEncodeCameraDocument(e)' + source.slice(serialization.end - 1);

  let deletion;
  traverse(parser.parse('(' + source + ')'), {VariableDeclarator(entry) {
    const node = entry.node;
    if (node.id.name === 'c4' && source.slice(node.start - 1, node.end - 1).includes('last-camera')) {
      assert.equal(deletion, undefined, 'Camera deletion callback must be unique');
      deletion = node;
    }
  }});
  assert.ok(deletion, 'Camera deletion callback missing');
  const callback = `c4=(0,n.useCallback)(cameraIds=>{
    const result=__localDeleteCameraInState(iK,cameraIds);
    if(!result.ok)return false;
    const document=result.document,deleted=new Set(result.deletedCameraIds);
    const activeRemoved=deleted.has(iH.current);
    const nextActive=document.cameras.some(camera=>camera.id===iH.current)?iH.current:document.outputCameraId;
    sQ(state=>__localDeleteCameraInState(state,cameraIds).state,"director.multi-camera.delete");
    const session=t_(document,nextActive);
    if(session.ok){iH.current=session.session.activePreviewCameraId;id(session.session)}
    ib(value=>value?co(value,document.cameras.map(camera=>camera.id)):value);
    let selected=a7.filter(cameraId=>document.cameras.some(camera=>camera.id===cameraId));
    if(!selected.length&&activeRemoved&&!iK.selectedObjectIds.length&&nextActive)selected=[nextActive];
    a6(selected);al(!iK.selectedObjectIds.length&&selected.length===1?"camera":void 0);
    iT(Q.deleted);return true;
  },[sQ,Q.deleted,iK,a7,iT])`;
  source = source.slice(0, deletion.start - 1) + callback + source.slice(deletion.end - 1);
  factories['53401'] = source;
};
