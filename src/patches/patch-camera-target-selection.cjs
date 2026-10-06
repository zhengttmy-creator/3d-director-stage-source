const assert = require('node:assert/strict');

module.exports = function patchCameraTargetSelection(factories) {
  let source = factories['53401'];
  const replace = (label, before, after) => {
    assert.equal(source.split(before).length, 2, 'Camera target selection anchor changed: ' + label);
    source = source.replace(before, after);
  };

  // List and timeline clicks must use the same subject picker as viewport clicks.
  replace('selection routing',
    'dc=(0,n.useCallback)(function(e,t){let r=arguments.length>2&&void 0!==arguments[2]&&arguments[2];',
    'dc=(0,n.useCallback)(function(e,t){if(cO){cH&&cq(e.find(e=>cU.some(t=>t.objectId===e)));return}let r=arguments.length>2&&void 0!==arguments[2]&&arguments[2];');
  replace('selection dependencies', '},[nB,rC,A.objects]),dd=',
    '},[nB,rC,A.objects,cO,cH,cq,cU]),dd=');
  replace('object list routing',
    'dd=(0,n.useCallback)((e,t)=>{if(rC&&rC.objectId!==e)return;',
    'dd=(0,n.useCallback)((e,t)=>{if(cO){dc([e],"replace");return}if(rC&&rC.objectId!==e)return;');
  replace('object list dependencies', '},[rC,dl,dc,iK.objects]),du=',
    '},[rC,dl,dc,iK.objects,cO]),du=');
  replace('subject highlight', 'selectedIds:iK.selectedObjectIds,activeSceneId:iK.activeSceneId',
    'selectedIds:cO?c2.selectedObjectIds:iK.selectedObjectIds,activeSceneId:iK.activeSceneId');
  factories['53401'] = source;
};
