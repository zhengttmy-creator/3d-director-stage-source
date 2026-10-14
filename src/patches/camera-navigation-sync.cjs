const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const parser = require('@babel/parser');
const traverse = require('@babel/traverse').default;

module.exports = function patchCameraNavigationSync(factories) {
  let source = factories['53401'];
  const ast = parser.parse('(' + source + ')');
  const edits = [];
  let commits = 0, navigation = 0, persistenceCalls = 0;
  traverse(ast, {VariableDeclarator(entry) {
    const code = source.slice(entry.node.start - 1, entry.node.end - 1);
    if (entry.node.id.name === 'cx' && code.includes('timelineCameraSelectPart')) {
      commits++;
      const callback = entry.node.init.arguments[0];
      assert.equal(callback.params.length, 2);
      edits.push({start: callback.params[1].end - 1, end: callback.params[1].end - 1,
        text: ',__localCameraId'});
      entry.traverse({CallExpression(call) {
        if (call.node.callee.type !== 'Identifier' || call.node.callee.name !== 'sQ') return;
        assert.equal(call.node.arguments.length, 2);
        persistenceCalls++;
        edits.push({start: call.node.end - 2, end: call.node.end - 2, text: ',__localCameraId'});
      }});
    }
    if (entry.node.id.name === 'cA' && code.includes('e.ownerKey!==t') && code.includes('baseline')) {
      navigation++;
      // The viewport settles one navigation gesture before invoking this callback.
      // Persist through the usual authoring path so undo and frame keys stay grouped.
      edits.push({start: entry.node.init.start - 1, end: entry.node.init.end - 1, text: `(0,n.useCallback)(e=>{
        if(!C||!am||rC)return false;
        const cameraId=o3.activeCameraId??iO;
        if(!il.cameras.some(camera=>camera.id===cameraId))return false;
        const next={...sr,
          position:{...(sr.cameraLocked?sr.position:e.position)},
          target:{...(sr.targetLocked?sr.target:e.target)},
          fov:Number.isFinite(e.fov)?e.fov:sr.fov,
          roll:Number.isFinite(e.roll)?e.roll:sr.roll};
        t8(false);
        const changed=cx(next,"director.scene-camera.view",cameraId);
        ah(null);
        __localNavigationPreview.clear();
        return changed;
      },[C,am,rC,iO,o3.activeCameraId,il.cameras,sr,t8,cx,__localNavigationPreview])`});
    }
  }});
  assert.equal(commits, 1, 'Camera navigation authoring callback changed');
  assert.equal(persistenceCalls, 3, 'Camera navigation persistence routes changed');
  assert.equal(navigation, 1, 'Camera navigation draft callback changed');
  for (const edit of edits.sort((a, b) => b.start - a.start))
    source = source.slice(0, edit.start) + edit.text + source.slice(edit.end);
  const replace = (label, before, after) => {
    assert.equal(source.split(before).length, 2, 'Camera navigation preview anchor changed: ' + label);
    source = source.replace(before, after);
  };
  replace('preview store and inspector', 'function bG(e){',
    fs.readFileSync(path.join(__dirname, 'camera-navigation-preview-runtime.js'), 'utf8') + '\nfunction bG(e){');
  replace('workspace live preview store', 'sa=(0,n.useMemo)(()=>{var e;let t;return t=(e={boundaryKey:J',
    '__localNavigationPreview=(0,n.useMemo)(__localCreateCameraNavigationPreviewStore,[]),sa=(0,n.useMemo)(()=>{var e;let t;return t=(e={boundaryKey:J');
  replace('expire previews across camera or time changes', '},[iO,o8,J,sr,ej]);(0,n.useEffect)(()=>{am?ah',
    '},[iO,o8,J,sr,ej]);(0,n.useEffect)(()=>{__localNavigationPreview.clear();return()=>__localNavigationPreview.clear()},[__localNavigationPreview,sa,am]);(0,n.useEffect)(()=>{am?ah');
  replace('viewport gesture preview', 'r.sceneCameraPreview?yr(M,r,oD(r.state.sceneCamera,e)):ye(M,e),null==(t=r.onCameraPreview)',
    'r.sceneCameraPreview?(yr(M,r,oD(r.state.sceneCamera,e)),r.onSceneCameraNavigationPreview?.(oD(r.state.sceneCamera,e))):ye(M,e),null==(t=r.onCameraPreview)');
  replace('publish inspector preview', 'onSceneCameraPreviewChange:cA,', `onSceneCameraPreviewChange:cA,
    onSceneCameraNavigationPreview:e=>{
      if(!C||!am||rC||cO)return;
      const cameraId=o3.activeCameraId??iO;
      if(!il.cameras.some(camera=>camera.id===cameraId))return;
      __localNavigationPreview.publish({ownerKey:sa,cameraId,camera:{...sr,
        position:{...(sr.cameraLocked?sr.position:e.position)},
        target:{...(sr.targetLocked?sr.target:e.target)},fov:e.fov,roll:e.roll}});
    },`);
  replace('inspector subscription', '(0,i.jsx)(pg,{docked:!0,embedded:!0,hideClose:!0,copy:Q,state:sp,',
    '(0,i.jsx)(__LocalCameraNavigationInspector,{navigationPreview:{store:__localNavigationPreview,ownerKey:sa,cameraId:o3.activeCameraId??iO,active:C&&am&&!rC&&!cO},docked:!0,embedded:!0,hideClose:!0,copy:Q,state:sp,');
  factories['53401'] = source;
};
