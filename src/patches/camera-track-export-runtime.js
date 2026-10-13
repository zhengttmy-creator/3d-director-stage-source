function __localCameraTrackExportPlan(options) {
  const fps = rq(options.displayFps);
  const cameras = Array.isArray(options.document?.cameras) ? options.document.cameras : [];
  const cameraIds = new Set(cameras.map(camera => camera.id));
  const clips = rO(options.storyboard).clips.filter(clip => clip.enabled !== false);
  // Camera order is layer order: the first enabled camera covering a frame wins.
  const firstCamera = cameras.find(camera => clips.some(clip => clip.cameraId === camera.id && clip.startFrame === 0))
    ?? cameras.find(camera => clips.some(clip => clip.cameraId === camera.id)) ?? cameras[0];
  const endFrame = clips.reduce((latest, clip) => Math.max(latest, clip.endFrame), 0);
  const plan = {
    source: {kind: 'storyboard'}, cameraId: firstCamera?.id ?? '',
    sceneCamera: firstCamera ? t0(firstCamera) : tF(),
    cameraCutTrack: {version: 1, clips}, storyboardAvailable: clips.length > 0,
    cameraAvailable: cameras.length > 0, displayFps: fps, endFrame,
    durationSec: endFrame / fps, shotCount: clips.length, exportReady: false,
  };
  if (!cameras.length) return {...plan, exportErrorCode: 'no-camera',
    exportError: '暂无相机，请先添加相机和拍摄片段。'};
  if (!clips.length) return {...plan, exportErrorCode: 'no-shots',
    exportError: '请先在「镜头剪辑」添加并启用拍摄片段，再导出镜头轨道。'};
  const missing = clips.find(clip => !cameraIds.has(clip.cameraId));
  if (missing) return {...plan, exportErrorCode: 'missing-camera',
    exportError: '镜头轨道中有片段对应的相机已不存在，请重新选择相机或删除该片段。'};
  let coveredThrough = 0;
  // Validate the union, not individual cuts: a short upper layer must not shrink
  // coverage supplied by a longer lower layer, and row order need not be chronological.
  for (const clip of [...clips].sort((a, b) => a.startFrame - b.startFrame || b.endFrame - a.endFrame)) {
    if (clip.startFrame > coveredThrough) {
      const from = Number((coveredThrough / fps).toFixed(3));
      const to = Number((clip.startFrame / fps).toFixed(3));
      return {...plan, exportErrorCode: 'gap', gap: {startFrame: coveredThrough, endFrame: clip.startFrame},
        exportError: `镜头轨道在 ${from}–${to} 秒没有启用的拍摄片段，请补齐该段后再导出。`};
    }
    coveredThrough = Math.max(coveredThrough, clip.endFrame);
  }
  return {...plan, exportReady: true};
}

function __localSampleCameraTrackExportFrame(evaluator, plan, timeSec) {
  if (!plan.exportReady) throw new Error(plan.exportError || '请先完善镜头轨道。');
  // Camera cut ends are exclusive. The final render must never fall back to an editor camera.
  const lastFrameTime = (plan.endFrame - 1) / plan.displayFps;
  const sampleTime = Math.max(0, Math.min(lastFrameTime, Number.isFinite(timeSec) ? timeSec : 0));
  return evaluator.sampleTime(sampleTime);
}
