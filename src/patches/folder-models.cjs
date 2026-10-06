const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

module.exports = function patchFolderModels(factories) {
  let source = factories['53401'];
  const changes = [];
  const replace = (label, before, after) => {
    assert.equal(source.split(before).length, 2, 'Folder model patch anchor: ' + label);
    source = source.replace(before, after);
    changes.push(label);
  };
  replace('folder model helpers', 'function c1(e){', fs.readFileSync(path.join(__dirname, 'folder-models-runtime.js'), 'utf8') + '\nfunction c1(e){');
  replace('catalog character and prop separation', 'U=p.filter(e=>G(e.displayName,e.description,e.nameFallback,e.descriptionFallback,u.assetSourcePreset)),V=', 'U=p.filter(e=>__localCatalogModelKind(e)==="character"&&G(e.displayName,e.description,e.nameFallback,e.descriptionFallback,u.assetSourcePreset)),localModels=p.filter(e=>__localCatalogModelKind(e)==="model"&&G(e.displayName,e.description,e.nameFallback)),V=');
  replace('asset toolbar mount', 'children:u.workspaceAssets}),(0,i.jsx)("button",', 'children:u.workspaceAssets,"data-local-asset-heading":"true"}),(0,i.jsx)("button",');
  replace('local model cards', 'testId:"director-stage-prop-assets",children:[!!K&&', 'testId:"director-stage-prop-assets",children:[!!(Q&&localModels.length)&&(0,i.jsxs)(i.Fragment,{children:[(0,i.jsx)(c6,{first:!0,children:"\\u672c\\u5730\\u6a21\\u578b"}),(0,i.jsx)("div",{className:"grid grid-cols-2 gap-2",children:localModels.map(entry=>(0,i.jsx)(c8,{image:entry.thumbnailUrl,icon:cS.A,label:entry.displayName,meta:f===entry.assetId?u.characterCatalogAdding:(entry.extension||"model").replace(".","").toUpperCase(),disabled:!v||!!f,assetId:entry.assetId,onClick:()=>b(entry)},entry.assetId))})]}),!!K&&');
  replace('prop list content version', 'contentVersion:`${H}:${T}:${V.length}:${W.length}`', 'contentVersion:`${H}:${T}:${V.length}:${W.length}:${localModels.length}:${g}`');
  replace('local model search empty state', '"props"===T&&0===W.length&&', '"props"===T&&0===W.length&&0===localModels.length&&');
  replace('all model search empty state', '"all"===T&&0===V.length&&0===W.length&&B', '"all"===T&&0===V.length&&0===W.length&&0===localModels.length&&B');
  replace('catalog model insertion', 'let i=`character-${crypto.randomUUID()}`,n={id:i,name:e.displayName,kind:"model",source:"imported",rigged:!1,visible:!0,locked:!1,opacity:1,color:iv(),transform:{position:{x:0,y:0,z:0},rotation:{x:0,y:0,z:0},scale:{x:1,y:1,z:1}},asset:{provider:"catalog",assetId:t.assetId,mediaUrl:t.mediaUrl,extension:t.extension}};return d({label:n.name,objects:[n],reason:"director.character.add-catalog",selection:"object",pendingCharacterValidationIds:[i]})', 'let n=__localCreateCatalogModel(e,t);return d({label:n.name,objects:[n],reason:__localCatalogModelKind(e)==="character"?"director.character.add-catalog":"director.object.add-catalog",selection:"object",pendingCharacterValidationIds:__localCatalogModelKind(e)==="character"?[n.id]:[]})');
  replace('FBX sidecar texture resolver', '"gltf"===o&&a.setURLModifier(', 'a.setURLModifier(');
  replace('unambiguous model texture paths', 'a.setURLModifier(e=>(function(e,t){if(t[e])return t[e];let r=AU(e);if(t[r])return t[r];let a=r.split(/[\\\\/]/).at(-1)??r,i=Object.entries(t).find(e=>{let[t]=e;return AU(t).split(/[\\\\/]/).at(-1)===a});return(null==i?void 0:i[1])??e})(e,i))', 'a.setURLModifier(e=>__localResolveModelResource(e,i))');
  replace('catalog failed model invalidation', '"catalog"===a.provider&&".fbx"===a.extension', '"catalog"===a.provider&&[".fbx",".glb",".gltf"].includes(a.extension)');
  replace('model source identity', 'return`${(null==(r=e.asset)?void 0:r.revisionId)??"missing"}:${JSON.stringify(o)}:${s}`', 'return`${e.asset?.assetId??""}:${e.asset?.mediaUrl??""}:${(null==(r=e.asset)?void 0:r.revisionId)??"missing"}:${JSON.stringify(o)}:${s}`');
  replace('folder prop skeleton authoring disabled', 'g=lJ(o),f=u.length>0,h=f?g??p:[]', 'g=lJ(o),f=u.length>0&&!__localIsFolderProp(e),h=f?g??p:[]');
  replace('saved folder props remain props', 'rigged:"model"===s&&"primitive"!==o&&"procedural"!==o&&"composite"!==o&&!0===e.rigged', 'rigged:"model"===s&&"primitive"!==o&&"procedural"!==o&&"composite"!==o&&!__localIsFolderProp(e)&&!0===e.rigged');
  replace('folder JSON pose resolver', 'let i=await e.resolveCharacterMotion({assetId:t},a),n=await p3(i,a)', 'let i=await e.resolveCharacterMotion({assetId:t},a);if([".octomotion.json",".json"].includes(i.extension?.toLowerCase()))return __localLoadFolderPose(i,r,a);let n=await p3(i,a)');
  replace('catalog timeline native pose sampling', 'return{kind:"asset",motionId:u.id,assetPath:u.assetPath,...void 0!==r&&e.motionUsage===ap?{pathTraversal:{sourceTimeSec:r,offsetTimeSec:e.offsetTimeSec}}:{},localTimeSec:(l=a,c=u.durationSec,n?la(l,c):Math.min(c,Math.max(0,l))),durationSec:u.durationSec,loop:n,locomotionMode:e.locomotionMode}', 'return __localSampleCatalogMotion(u,a,n,e.locomotionMode,void 0!==r&&e.motionUsage===ap?{sourceTimeSec:r,offsetTimeSec:e.offsetTimeSec}:void 0)');
  replace('catalog static preview native pose sampling', 'ov?{kind:"asset",motionId:ov.id,assetPath:ov.assetPath,localTimeSec:e,durationSec:ov.durationSec,loop:!1,locomotionMode:"in-place"}', 'ov?__localSampleCatalogMotion(ov,e,!1,"in-place")');
  replace('catalog animation preview native pose sampling', 'ov?{kind:"asset",motionId:ov.id,assetPath:ov.assetPath,localTimeSec:e%ov.durationSec,durationSec:ov.durationSec,loop:!0,locomotionMode:ov.locomotion.mode}', 'ov?__localSampleCatalogMotion(ov,e,!0,ov.locomotion.mode)');
  replace('catalog staging native pose application', 'sample:{kind:"asset",motionId:t.id,assetPath:t.assetPath,durationSec:t.durationSec,localTimeSec:a,loop:!1,locomotionMode:"in-place"}', 'sample:__localSampleCatalogMotion(t,a,!1,"in-place")');
  replace('folder static pose classification', "String(asset?.assetId || '').startsWith('local-pose-')", "(String(asset?.assetId || '').startsWith('local-pose-') || String(asset?.assetId || '').startsWith('folder-poses-'))");
  factories['53401'] = source;
  const resolver = 'return n?{mediaUrl:n.mediaUrl}:void 0';
  assert.equal(factories['51687'].split(resolver).length, 2, 'Folder model catalog resource resolver');
  factories['51687'] = factories['51687'].replace(resolver, 'return n?{mediaUrl:n.mediaUrl,...n.resources?{resources:n.resources}:{},...n.dimensions?{dimensions:n.dimensions}:{}}:void 0');
  return {moduleId: '53401/51687', changes};
};
