const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const parser = require('@babel/parser');
const traverse = require('@babel/traverse').default;

// Run after the rotation model and manual authoring patches. Targets remain an
// internal render/preset compatibility detail; users edit the camera transform.
module.exports = function patchCameraTransformUI(factories) {
  let source = factories['53401'];
  const replace = (label, before, after) => {
    assert.equal(source.split(before).length, 2, 'Camera transform UI anchor changed: ' + label);
    source = source.replace(before, after);
  };
  const ast = parser.parse('(' + source + ')');
  const edits = [];
  const found = {};
  traverse(ast, {FunctionDeclaration(entry) {
    const name = entry.node.id.name;
    if (!['ce', 'po', 'px', 'bB', 'mV', 'ho'].includes(name)) return;
    found[name] = (found[name] || 0) + 1;
    let code = source.slice(entry.node.start - 1, entry.node.end - 1);
    if (name === 'ce') code = 'function ce(labels){return __localCameraTransformGroups(labels)}';
    if (name === 'po') code = 'function po(props){return (0,i.jsx)(__LocalCameraTransformProperties,props)}';
    if (name === 'px') code = 'function px(props){return (0,i.jsx)(__LocalCameraTransformPanel,props)}';
    if (name === 'bB') code = `function bB(e){const visible=bH(e);return {
      showCameraModel:visible,showTargetModel:false,showAimLine:false,showTargetPath:false,
      showFrustum:visible&&e.cameraHelperVisible&&!e.cameraOverlapsEditor&&e.selectedPart==="camera",
      showCameraPath:visible&&e.spatialPathsEnabled&&e.hasSpatialPaths&&(e.cameraHelperVisible||e.motionPathOverviewVisible===true)
    }}`;
    if (name === 'mV' || name === 'ho') {
      const localEdits = [];
      entry.traverse({CallExpression(call) {
        const props = call.node.arguments[1];
        if (!props || props.type !== 'ObjectExpression') return;
        const testId = props.properties.find(property => property.key?.value === 'data-testid')?.value;
        const id = testId?.type === 'StringLiteral' ? testId.value : testId?.type === 'TemplateLiteral' ? testId.quasis[0].value.raw : '';
        if (name === 'mV' && id === 'director-stage-shot-camera-children-') {
          const expression = call.parentPath.node.type === 'LogicalExpression' ? call.parentPath.node : call.node;
          localEdits.push({start: expression.start - entry.node.start, end: expression.end - entry.node.start, text: 'null'});
          call.skip();
        } else if (name === 'mV' && id === 'director-stage-shot-camera-expand-') {
          localEdits.push({start: call.node.start - entry.node.start, end: call.node.end - entry.node.start,
            text: '(0,i.jsx)("span",{"aria-hidden":"true",className:"size-7 shrink-0"})'});
          call.skip();
        } else if (name === 'ho' && id === 'director-stage-add-camera-target-path') {
          localEdits.push({start: call.node.start - entry.node.start, end: call.node.end - entry.node.start, text: 'null'});
          call.skip();
        }
      }});
      assert.equal(localEdits.length, name === 'mV' ? 2 : 1, name + ' target UI nodes');
      for (const edit of localEdits.sort((a,b) => b.start - a.start)) code = code.slice(0,edit.start) + edit.text + code.slice(edit.end);
      if (name === 'ho') code = code.replace('u.id.endsWith(":target")?mM.A:', 'u.id.endsWith(":rotation")?uW.A:');
    }
    edits.push({start: entry.node.start - 1, end: entry.node.end - 1, text: code});
    entry.skip();
  }});
  for (const name of ['ce', 'po', 'px', 'bB', 'mV', 'ho']) assert.equal(found[name], 1, name + ' camera transform UI function');
  for (const edit of edits.sort((a,b) => b.start - a.start)) source = source.slice(0,edit.start) + edit.text + source.slice(edit.end);
  replace('runtime', 'function ce(labels)', fs.readFileSync(path.join(__dirname,'camera-transform-ui-runtime.js'),'utf8') + '\nfunction ce(labels)');
  replace('timeline rotation group', 'if("position"===e.id||"target"===e.id){', 'if("position"===e.id||"rotation"===e.id){');
  replace('timeline labels', 'camera:{position:p.sceneCameraPosition,target:p.sceneCameraTarget,lens:p.sceneCameraLens,fov:p.fov,roll:p.sceneCameraRoll}',
    'camera:{position:p.sceneCameraPosition,rotation:p.rotation,lens:p.sceneCameraLens,fov:p.fov}');
  replace('rotation curve label', '"position"===tI.group?p.sceneCameraPosition:p.sceneCameraTarget', '"position"===tI.group?p.sceneCameraPosition:p.rotation');
  replace('whole camera row key button', '["object-group","camera-group","camera-channel"].includes(u.kind)', '["object-group","camera-root","camera-group","camera-channel"].includes(u.kind)');
  replace('whole camera transform channels', 'function __localCameraRowChannels(row) {',
    'function __localCameraRowChannels(row) {\n  if(row.kind === "camera-root") return ["position", "rotation"].flatMap(group => ["x", "y", "z"].map(axis => group + "." + axis));');
  replace('manual row rotation channels', "['position', 'target'].includes(row.curve?.group)", "['position', 'rotation'].includes(row.curve?.group)");
  replace('manual row lens channels', "['lens.fov', 'lens.roll'].includes(row.cameraTrack)", "['lens.fov'].includes(row.cameraTrack)");
  const pickingModels = 'flatMap(e=>[e.cameraModel,e.targetModel]).filter(e=>e.visible)';
  assert.equal(source.split(pickingModels).length, 3, 'Camera pointer and hover picking models');
  source = source.replaceAll(pickingModels, 'flatMap(e=>[e.cameraModel]).filter(e=>e.visible)');
  replace('camera-only picking', '("camera"===m||"target"===m)&&"string"==typeof p', '"camera"===m&&"string"==typeof p');
  factories['53401'] = source;
};
