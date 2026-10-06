function __localCatalogModelKind(entry) {
  return entry?.localAssetKind === 'model' || String(entry?.assetId || '').startsWith('folder-models-') ? 'model' : 'character';
}

function __localIsFolderProp(object) {
  return object?.asset?.provider === 'catalog' && String(object.asset.assetId || '').startsWith('folder-models-');
}

function __localSampleCatalogMotion(motion, timeSec, loop, locomotionMode, pathTraversal) {
  if (Array.isArray(motion.keyframes)) return {...s6({...motion, loop}, timeSec), locomotionMode};
  return {kind: 'asset', motionId: motion.id, assetPath: motion.assetPath,
    localTimeSec: loop ? la(timeSec, motion.durationSec) : Math.min(motion.durationSec, Math.max(0, timeSec)),
    durationSec: motion.durationSec, loop, locomotionMode,
    ...(pathTraversal ? {pathTraversal} : {}),
  };
}

function __localCreateCatalogModel(entry, resolved) {
  if (!resolved || resolved.assetId !== entry.assetId || !resolved.mediaUrl?.trim()) throw Error('\u672c\u5730\u6a21\u578b\u8d44\u6e90\u65e0\u6548');
  const kind = __localCatalogModelKind(entry);
  const extension = resolved.extension?.toLowerCase();
  if (!['.fbx', '.glb', '.gltf'].includes(extension)) throw Error('\u6a21\u578b\u4ec5\u652f\u6301 FBX\u3001GLB \u548c GLTF');
  if (kind === 'character' && extension !== '.fbx') throw Error('\u4eba\u7269\u9700\u8981\u6807\u51c6 Mixamo FBX \u9aa8\u67b6');
  const resources = Object.fromEntries(Object.entries(resolved.resources || {}).filter(([, value]) => typeof value === 'string'));
  return {
    id: kind + '-' + crypto.randomUUID(), name: entry.displayName, kind: 'model', source: 'imported',
    rigged: false, visible: true, locked: false, opacity: 1,
    ...(kind === 'character' ? {color: iv()} : {placementAnchor: 'bottom-center-v1'}),
    transform: {position: {x: 0, y: 0, z: 0}, rotation: {x: 0, y: 0, z: 0}, scale: {x: 1, y: 1, z: 1}},
    asset: {provider: 'catalog', assetId: resolved.assetId, mediaUrl: resolved.mediaUrl, extension,
      ...(typeof resolved.revisionId === 'string' ? {revisionId: resolved.revisionId} : {}),
      ...(Object.keys(resources).length ? {resources} : {}),
    },
  };
}

async function __localLoadFolderPose(resolved, entry, signal) {
  if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
  const url = new URL(resolved.mediaUrl, window.location.href);
  if (url.origin !== window.location.origin) throw Error('\u59ff\u52bf\u6587\u4ef6\u5fc5\u987b\u6765\u81ea\u672c\u5730\u8d44\u4ea7\u6587\u4ef6\u5939');
  if (entry && entry.assetId !== resolved.assetId) throw Error('DIRECTOR_STAGE_CATALOG_MOTION_ID_MISMATCH');
  const response = await fetch(url.href, {signal, credentials: 'omit'});
  if (!response.ok) throw Error('\u59ff\u52bf\u6587\u4ef6\u8bfb\u53d6\u5931\u8d25: ' + response.status);
  const payload = await response.json();
  if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
  if (payload?.format !== 'octo-director-motion' || payload.version !== 1 || !payload.motion) throw Error('\u4e0d\u652f\u6301\u7684\u59ff\u52bf JSON \u683c\u5f0f');
  const source = payload.motion;
  if (tb(source.skeletonId) !== th || source.skeletonVersion !== 1) throw Error('\u59ff\u52bf\u9700\u8981\u6807\u51c6 Mixamo \u9aa8\u67b6');
  const motion = g7({...source, id: resolved.assetId, name: entry?.displayName || source.name,
    source: 'imported', motionUsage: entry?.motionUsage || 'direct'});
  if (!motion || motion.keyframes.some(frame => frame.pose.rotations.some(rotation => rotation.boneIndex >= lV.length))) throw Error('\u59ff\u52bf\u6570\u636e\u65e0\u6548');
  return Object.freeze({...motion, description: entry?.description || motion.name,
    fps: Number.isFinite(source.fps) && source.fps > 0 ? Math.min(120, Math.max(1, source.fps)) : 30,
    thumbnailPath: entry?.thumbnailUrl || '', expiresAtMs: resolved.expiresAtMs,
    catalogAssetId: resolved.assetId});
}
