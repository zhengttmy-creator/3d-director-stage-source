function __localMergeBackgroundImages(original, local) {
  const images = new Map();
  for (const image of [...(original || []), ...(local || [])]) {
    if (image?.assetId && !images.has(image.assetId)) images.set(image.assetId, image);
  }
  return [...images.values()];
}

function __localBackgroundImage(asset) {
  if (!asset?.assetId || !asset.mediaUrl || !Number.isInteger(asset.width) || !Number.isInteger(asset.height) ||
      asset.width <= 0 || asset.height <= 0) throw Error('\u56fe\u7247\u6570\u636e\u65e0\u6548');
  return {...asset, nodeId: 'local-background-' + asset.assetId};
}

function __localBackgroundFile(file) {
  const types = {'jpg': 'image/jpeg', 'jpeg': 'image/jpeg', 'png': 'image/png', 'webp': 'image/webp'};
  const type = file?.type || types[String(file?.name || '').split('.').pop().toLowerCase()];
  if (!Object.values(types).includes(type)) throw Error('\u4ec5\u652f\u6301 PNG\u3001JPG \u548c WebP \u56fe\u7247');
  if (!(file.size > 0)) throw Error('\u56fe\u7247\u6587\u4ef6\u4e3a\u7a7a');
  if (file.size > 16 * 1024 * 1024) throw Error('\u5355\u5f20\u56fe\u7247\u4e0d\u80fd\u8d85\u8fc7 16 MB');
  return file.type ? file : new File([file], file.name, {type, lastModified: file.lastModified});
}

async function __localReadBackgroundImages(catalog, signal) {
  if (!catalog?.listImages) throw Error('\u672c\u5730\u56fe\u7247\u5e93\u5c1a\u672a\u5c31\u7eea');
  let images = [], cursor;
  const visited = new Set();
  do {
    signal?.throwIfAborted();
    const page = await catalog.listImages({limit: 100, ...(cursor ? {cursor} : {})}, signal);
    signal?.throwIfAborted();
    if (!Array.isArray(page?.items)) throw Error('\u56fe\u7247\u5217\u8868\u65e0\u6548');
    images = __localMergeBackgroundImages(images, page.items.map(__localBackgroundImage));
    if (!page.hasMore) return images;
    if (!page.cursor || visited.has(page.cursor)) throw Error('\u56fe\u7247\u5217\u8868\u5206\u9875\u5931\u8d25');
    cursor = page.cursor;
    visited.add(cursor);
  } while (true);
}

async function __localSaveBackgroundImages(files, port, onSaved) {
  const images = [], errors = [];
  for (const original of Array.from(files || [])) {
    try {
      const file = __localBackgroundFile(original);
      if (!port?.saveCaptures) throw Error('\u672c\u5730\u56fe\u7247\u5e93\u5c1a\u672a\u5c31\u7eea');
      const [result] = await port.saveCaptures([file]);
      if (!result?.ok) throw Error('\u56fe\u7247\u65e0\u6cd5\u8bfb\u53d6\u6216\u4fdd\u5b58\uff0c\u8bf7\u68c0\u67e5\u6587\u4ef6\u540e\u91cd\u8bd5');
      const image = __localBackgroundImage(result.asset);
      images.push(image);
      onSaved?.(image);
    } catch (error) {
      errors.push((original?.name || '\u56fe\u7247') + '\uff1a' + error.message);
    }
  }
  return {images, errors};
}

function __localUseBackgroundImages(originalImages) {
  const [local, setLocal] = n.useState([]), [loading, setLoading] = n.useState(true);
  const [busy, setBusy] = n.useState(false), [error, setError] = n.useState(''), [notice, setNotice] = n.useState('');
  const [removed, setRemoved] = n.useState([]), [undo, setUndo] = n.useState(null);
  const lifetime = n.useRef({active: false, busy: false, request: null, generation: 0, removed: new Set(), knownLocal: new Set(), undo: null});
  for (const image of local) if (image.localBackgroundAsset === true) lifetime.current.knownLocal.add(image.assetId);
  const canRemove = n.useCallback(image => Boolean(image?.assetId && !lifetime.current.removed.has(image.assetId) &&
    (image.localBackgroundAsset === true || lifetime.current.knownLocal.has(image.assetId))), []);
  const refresh = n.useCallback(async () => {
    const state = lifetime.current;
    state.request?.abort();
    const request = new AbortController();
    const generation = ++state.generation;
    state.request = request;
    if (state.active) setLoading(true);
    try {
      const images = await __localReadBackgroundImages(window.localDirectorCaptures?.catalog, request.signal);
      if (state.active && state.generation === generation) setLocal(previous => __localMergeBackgroundImages(previous, images));
      return '';
    } catch (failure) {
      if (failure?.name === 'AbortError') return '';
      return '\u80cc\u666f\u5217\u8868\u8bfb\u53d6\u5931\u8d25\uff0c\u8bf7\u91cd\u8bd5';
    } finally {
      if (state.active && state.generation === generation) setLoading(false);
    }
  }, []);
  n.useEffect(() => {
    const state = lifetime.current;
    state.active = true;
    const generation = state.generation + 1;
    void refresh().then(message => { if (state.active && state.generation === generation) setError(message); });
    return () => { state.active = false; state.request?.abort(); state.generation++; };
  }, [refresh]);
  const upload = n.useCallback(async files => {
    const state = lifetime.current;
    if (!state.active || state.busy || !files?.length) return;
    state.busy = true;
    state.request?.abort();
    state.generation++;
    setBusy(true); setLoading(false); setError(''); setNotice('');
    try {
      const result = await __localSaveBackgroundImages(files, window.localDirectorCaptures?.port, image => {
        if (state.active) setLocal(previous => __localMergeBackgroundImages(previous, [image]));
      });
      if (!state.active) return;
      if (result.images.length) setNotice('\u5df2\u6dfb\u52a0 ' + result.images.length + ' \u5f20\u80cc\u666f');
      const refreshError = await refresh();
      if (state.active) setError([...result.errors, refreshError].filter(Boolean).join('\n'));
    } finally {
      state.busy = false;
      if (state.active) setBusy(false);
    }
  }, [refresh]);
  const remove = n.useCallback(async (image, onRemoved) => {
    const state = lifetime.current;
    if (!state.active || state.busy || !canRemove(image)) return;
    state.busy = true; state.request?.abort(); state.generation++;
    setBusy(true); setLoading(false); setError('');
    let failed = false;
    try {
      const port = window.localDirectorCaptures?.port;
      if (!port?.removeBackground) throw Error('Unavailable');
      await port.removeBackground(image.assetId);
      if (!state.active) return;
      state.removed.add(image.assetId); setRemoved([...state.removed]);
      state.undo = image; setUndo(image); setNotice('\u5df2\u5220\u9664\u80cc\u666f');
      try { onRemoved?.(image.assetId); }
      catch { setError('\u80cc\u666f\u5df2\u5220\u9664\uff0c\u573a\u666f\u663e\u793a\u66f4\u65b0\u5931\u8d25'); }
    } catch {
      failed = true;
      if (state.active) setError('\u5220\u9664\u80cc\u666f\u5931\u8d25\uff0c\u8bf7\u91cd\u8bd5');
    } finally {
      if (state.active) {
        const refreshError = await refresh();
        if (state.active && refreshError && !failed) setError(refreshError);
      }
      state.busy = false;
      if (state.active) setBusy(false);
    }
  }, [canRemove, refresh]);
  const undoRemove = n.useCallback(async () => {
    const state = lifetime.current, image = state.undo;
    if (!state.active || state.busy || !image) return;
    state.busy = true; state.request?.abort(); state.generation++;
    setBusy(true); setLoading(false); setError('');
    try {
      const port = window.localDirectorCaptures?.port;
      if (!port?.restoreBackground) throw Error('Unavailable');
      await port.restoreBackground(image.assetId);
      if (!state.active) return;
      state.removed.delete(image.assetId); setRemoved([...state.removed]);
      setLocal(previous => __localMergeBackgroundImages(previous, [image]));
      state.undo = null; setUndo(null); setNotice('\u5df2\u6062\u590d\u80cc\u666f');
    } catch {
      if (state.active) setError('\u6062\u590d\u80cc\u666f\u5931\u8d25\uff0c\u8bf7\u91cd\u8bd5');
    } finally {
      state.busy = false;
      if (state.active) setBusy(false);
    }
  }, []);
  const retry = n.useCallback(async () => {
    if (!lifetime.current.active || lifetime.current.busy) return;
    setError('');
    const state = lifetime.current, generation = state.generation + 1;
    const message = await refresh();
    if (state.active && state.generation === generation) setError(message);
  }, [refresh]);
  return {images: n.useMemo(() => __localMergeBackgroundImages(originalImages, local).filter(image => !removed.includes(image.assetId)), [originalImages, local, removed]),
    loading, busy, error, notice, upload, retry, remove, undoRemove, canRemove, undoAvailable: Boolean(undo)};
}

function __LocalBackgroundUpload({library, editable, empty, canCloseBackground, onCloseBackground}) {
  const input = n.useRef(null);
  return (0, i.jsxs)('div', {
    className: 'local-background-upload' + (empty ? ' local-background-upload-empty' : ''),
    'aria-busy': library.busy || library.loading,
    children: [
      (0, i.jsxs)('div', {className: 'local-background-upload-heading', children: [
        (0, i.jsx)('span', {children: '\u80cc\u666f\u56fe\u7247'}),
        (0, i.jsxs)('button', {type: 'button', className: 'local-background-upload-button',
          disabled: !editable || library.busy, onClick: () => input.current?.click(),
          children: [(0, i.jsx)(__localBackgroundUploadIcon.A, {size: 14, 'aria-hidden': true}),
            library.busy ? '\u6b63\u5728\u4e0a\u4f20' : '\u4e0a\u4f20\u80cc\u666f']}),
      ]}),
      (0, i.jsxs)('button', {type: 'button', className: 'local-background-close-button',
        disabled: !editable || !canCloseBackground, onClick: onCloseBackground,
        children: [(0, i.jsx)(__localBackgroundCloseIcon.A, {size: 14, 'aria-hidden': true}),
          '\u5173\u95ed\u80cc\u666f']}),
      (0, i.jsx)('input', {ref: input, type: 'file', hidden: true, multiple: true,
        accept: 'image/png,image/jpeg,image/webp,.png,.jpg,.jpeg,.webp', disabled: !editable || library.busy,
        'aria-label': '\u9009\u62e9\u80cc\u666f\u56fe\u7247', onChange: event => {
          const files = Array.from(event.target.files || []); event.target.value = ''; void library.upload(files);
        }}),
      library.loading && (0, i.jsx)('div', {className: 'local-background-upload-status', role: 'status', children: '\u6b63\u5728\u52a0\u8f7d\u80cc\u666f'}),
      (library.notice || library.undoAvailable) && (0, i.jsxs)('div', {className: 'local-background-upload-status', role: 'status', children: [
        (0, i.jsx)('span', {children: library.notice}),
        library.undoAvailable && (0, i.jsx)('button', {type: 'button', className: 'local-background-upload-undo',
          disabled: !editable || library.busy, onClick: library.undoRemove, children: '\u64a4\u9500\u5220\u9664'}),
      ]}),
      library.error && (0, i.jsxs)('div', {className: 'local-background-upload-error', role: 'alert', children: [
        (0, i.jsx)('span', {children: library.error}),
        (0, i.jsx)('button', {type: 'button', className: 'local-background-upload-retry',
          disabled: library.busy || library.loading, onClick: library.retry, children: '\u91cd\u8bd5'}),
      ]}),
    ],
  });
}

function __LocalBackgroundDeleteButton({image, library, editable, onRemoved}) {
  if (!library.canRemove(image)) return null;
  return (0, i.jsx)('button', {type: 'button', className: 'local-background-delete-button',
    title: '\u5220\u9664\u80cc\u666f', 'aria-label': '\u5220\u9664\u80cc\u666f ' + (image.title || ''),
    disabled: !editable || library.busy,
    onClick: event => { event.preventDefault(); event.stopPropagation(); void library.remove(image, onRemoved); },
    children: (0, i.jsx)(__localBackgroundDeleteIcon.A, {size: 14, 'aria-hidden': true})});
}
