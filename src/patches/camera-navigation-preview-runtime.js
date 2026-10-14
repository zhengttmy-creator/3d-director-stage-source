function __localCreateCameraNavigationPreviewStore() {
  let snapshot = null;
  const listeners = new Set();
  const publish = value => {
    if (Object.is(snapshot, value)) return;
    snapshot = value;
    for (const listener of listeners) listener();
  };
  return {getSnapshot: () => snapshot, subscribe: listener => {
    listeners.add(listener); return () => listeners.delete(listener);
  }, publish, clear: () => publish(null)};
}

function __LocalCameraNavigationInspector({navigationPreview, ...props}) {
  const store = navigationPreview.store;
  const preview = n.useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
  const matches = navigationPreview.active && preview?.ownerKey === navigationPreview.ownerKey &&
    preview.cameraId === navigationPreview.cameraId;
  // Only the inspector sees the live gesture. Keeping the viewport's canonical
  // camera stable prevents navigation reconciliation from cancelling held input.
  return i.jsx(pg, {...props, state: matches ? {...props.state, sceneCamera: preview.camera} : props.state});
}
