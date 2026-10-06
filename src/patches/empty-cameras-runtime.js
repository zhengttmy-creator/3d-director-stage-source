function __localEmptyCameraProjection(state, document) {
  const tracks = state.timeline.cameraTracks;
  const empty = eH.every(channel => Array.isArray(tracks?.[channel]) && tracks[channel].length === 0);
  return {...state, multiCamera: document,
    timeline: empty ? state.timeline : {...state.timeline, cameraTracks: eU(state.sceneCamera)}};
}

function __localEmptyCameraSource(options) {
  const fps = rq(options.displayFps);
  const durationSec = Number.isFinite(options.timelineDurationSec)
    ? Math.max(1 / fps, options.timelineDurationSec) : 1 / fps;
  return {source: {kind: 'camera', cameraId: ''}, cameraId: '', cameraAvailable: false,
    durationSec, sceneCamera: tF(), storyboardAvailable: false};
}

function __localEncodeCameraDocument(workspace) {
  const canonical = tX(workspace.multiCamera);
  if (canonical.ok) {
    const document = canonical.document;
    return {schemaVersion: 1, outputCameraId: document.outputCameraId,
      cameras: document.cameras.map(camera => ({id: camera.id,
        role: camera.id === document.outputCameraId ? 'main' : 'shot-camera', name: camera.name,
        transform: kN(camera.transform), target: kN(camera.target), lens: kN(camera.lens),
        tracks: kN(camera.tracks), ...(camera.binding ? {binding: kN(camera.binding)} : {})}))};
  }
  const camera = workspace.sceneCamera;
  return {schemaVersion: 1, outputCameraId: camera.id, cameras: [{id: camera.id, role: 'main', name: camera.id,
    transform: {position: kN(camera.position)}, target: {position: kN(camera.target)},
    lens: {fov: camera.fov, roll: camera.roll, aspectRatio: camera.aspectRatio},
    tracks: kN(workspace.kind === 'performance' ? workspace.timeline.cameraTracks : eU(camera))}]};
}

function __localDecodeEmptyCameraDocument() {
  const sceneCamera = {...tF(), cameraHelperVisible: false, targetHelperVisible: false};
  return {sceneCamera, mainCameraTracks: eU(sceneCamera),
    multiCamera: {schemaVersion: 3, cameras: [], outputCameraId: ''}};
}

function __localDeleteCameraInState(state, cameraIds) {
  const document = oE(state);
  const requested = new Set(typeof cameraIds === 'string' ? [cameraIds] : Array.isArray(cameraIds) ? cameraIds : []);
  const candidates = document.cameras.filter(camera => requested.has(camera.id));
  const deletedCameraIds = candidates.filter(camera => !camera.authoring.cameraLocked).map(camera => camera.id);
  if (!deletedCameraIds.length) return {ok: false,
    reason: candidates.length ? 'camera-locked' : 'camera-not-found', state, document, deletedCameraIds};
  const deleted = new Set(deletedCameraIds);
  const cameras = document.cameras.filter(camera => !deleted.has(camera.id));
  const outputCameraId = cameras.some(camera => camera.id === document.outputCameraId)
    ? document.outputCameraId : cameras[0]?.id ?? '';
  const nextDocument = {schemaVersion: 3, cameras, outputCameraId};
  const removedObjectIds = new Set(deletedCameraIds.map(tM));
  const cameraCutTrack = rO(state.timeline.cameraCutTrack, cameras.map(camera => camera.id));
  let nextState = {...state, multiCamera: nextDocument,
    selectedObjectIds: (state.selectedObjectIds ?? []).filter(id => !removedObjectIds.has(id)),
    selectionGroups: (state.selectionGroups ?? []).flatMap(group => {
      const objectIds = group.objectIds.filter(id => !removedObjectIds.has(id));
      return objectIds.length >= 2 ? [{...group, objectIds}] : [];
    }),
    timeline: {...state.timeline, cameraCutTrack}};
  // sQ projects the output camera after committing; projecting earlier would overwrite another active camera.
  if (!cameras.length) nextState = __localEmptyCameraProjection(nextState, nextDocument);
  return {ok: true, state: nextState, document: nextDocument, deletedCameraIds};
}
