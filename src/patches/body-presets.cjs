const assert = require('node:assert/strict');

function __localIsBodyPresetAsset(asset) {
  return asset?.extension?.toLowerCase() === '.glb'
    && /^local-body-(male|female)-(standard|teen|child|slender|athletic|full)$/.test(asset?.assetId || '');
}

module.exports = function patchBodyPresets(factories) {
  let source = factories['53401'];
  const changes = [];
  const replace = (label, before, after) => {
    assert.equal(source.split(before).length, 2, 'Body preset patch anchor: ' + label);
    source = source.replace(before, after);
    changes.push(label);
  };
  replace('built-in body preset identity', 'function __localCatalogModelKind(entry) {',
    __localIsBodyPresetAsset.toString() + '\nfunction __localCatalogModelKind(entry) {');
  replace('built-in GLB character insertion', "if (kind === 'character' && extension !== '.fbx')",
    "if (kind === 'character' && extension !== '.fbx' && !__localIsBodyPresetAsset(resolved))");
  replace('body preset neutral material and floor placement', "{color: iv()} : {placementAnchor: 'bottom-center-v1'}",
    "(__localIsBodyPresetAsset(resolved) ? {color: '#d2d5d8', placementAnchor: 'bottom-center-v1'} : {color: iv()}) : {placementAnchor: 'bottom-center-v1'}");
  replace('body preset Mixamo rig recognition', 'v="fbx"===t.format&&f&&!!g',
    'v=("fbx"===t.format||"gltf"===t.format&&__localIsBodyPresetAsset(e.asset))&&f&&!!g');
  factories['53401'] = source;
  return {moduleId: '53401', changes};
};
