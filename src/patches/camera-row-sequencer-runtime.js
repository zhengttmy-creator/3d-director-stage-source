function __localUseCameraShotController(props) {
  const {track, cameras, scale, clock, boundaryKey, editable = true, onChange, onSelectCamera, onSeek,
    onPreview, onScrollLeftChange, onGestureCancelChange, scrollRef, surfaceRef, frameAtClientX} = props;
  const normalized = n.useMemo(() => rO(track, cameras.map(camera => camera.id)), [track, cameras]);
  const [draft, setDraft] = n.useState(null);
  const [menu, setMenu] = n.useState(null);
  const [selected, setSelected] = n.useState(null);
  const cancelGesture = n.useRef(null);
  const scroll = n.useRef(props.scrollLeftPx);
  scroll.current = props.scrollLeftPx;
  const time = clock.getSnapshot();
  const fps = scale.displayFps, maximumFrame = Math.round(30 * fps);
  const frame = Math.floor(time * fps + 1e-7);
  const shown = draft ?? normalized;
  const selectedClip = shown.clips.find(clip => clip.id === selected);
  const closeMenu = n.useCallback(() => setMenu(null), []);
  n.useEffect(() => {setMenu(null); cancelGesture.current?.();}, [boundaryKey, editable]);
  n.useLayoutEffect(() => {cancelGesture.current?.();}, [normalized, fps, scale.pixelsPerFrame]);
  n.useEffect(() => () => cancelGesture.current?.(), []);
  const atPointer = event => Math.max(0, Math.min(maximumFrame - 1, Math.round(frameAtClientX ? frameAtClientX(event.clientX) :
    (event.clientX - surfaceRef.current.getBoundingClientRect().left - scale.edgeGutterPx) / scale.pixelsPerFrame)));
  const addMenu = (anchor, cameraId, preferredFrame = Math.round(clock.getSnapshot() * fps)) => {
    if (!editable) return;
    const rowCameraId = cameraId ?? cameras.find(camera =>
      !normalized.clips.some(clip => clip.cameraId === camera.id))?.id ?? cameras[0]?.id;
    const gap = __localNextShotGap(normalized, preferredFrame, maximumFrame, rowCameraId ?? '');
    const rect = anchor.getBoundingClientRect();
    setMenu({x: rect.left, y: rect.top, cameraId: rowCameraId,
      frame: gap?.startFrame ?? maximumFrame,
      durationFrames: gap ? Math.min(2 * fps, gap.endFrame - gap.startFrame) : fps});
  };
  const openMenu = (event, cameraId, clip) => {
    event.preventDefault(); event.stopPropagation();
    if (!editable) return;
    setSelected(clip?.id ?? null);
    const startFrame = clip?.startFrame ?? atPointer(event);
    const gap = clip ? null : __localNextShotGap(normalized, startFrame, maximumFrame, cameraId);
    setMenu({x: event.clientX, y: event.clientY, frame: gap?.startFrame ?? startFrame, clipId: clip?.id, cameraId,
      durationFrames: gap ? Math.min(2 * fps, gap.endFrame - gap.startFrame) : fps});
  };
  const selectClip = clip => {
    setSelected(clip.id); onSelectCamera(clip.cameraId); onSeek(clip.startFrame / fps); onPreview?.(clip.cameraId);
  };
  const begin = (event, clip, mode) => {
    event.stopPropagation();
    if (!editable || event.button !== 0 || !event.isPrimary) return;
    event.preventDefault(); cancelGesture.current?.(); closeMenu(); setSelected(clip.id);
    event.currentTarget.focus?.({preventScroll: true});
    const baseline = normalized, startX = event.clientX;
    const startScroll = scrollRef?.current?.scrollLeft ?? scroll.current;
    let nextTrack = baseline, moved = false;
    const update = pointer => {
      if (pointer.pointerId !== event.pointerId) return;
      if (!moved && Math.abs(pointer.clientX - startX) < 3) return;
      moved = true;
      const rect = scrollRef?.current?.getBoundingClientRect();
      const currentScroll = scrollRef?.current?.scrollLeft ?? scroll.current;
      if (rect && onScrollLeftChange && (pointer.clientX < rect.left + 200 || pointer.clientX > rect.right - 20)) {
        scroll.current = onScrollLeftChange(Math.max(0, currentScroll + (pointer.clientX < rect.left + 200 ? -8 : 8)));
      } else scroll.current = currentScroll;
      const delta = Math.round((pointer.clientX - startX + scroll.current - startScroll) / scale.pixelsPerFrame);
      nextTrack = __localEditShot(baseline, clip.id, mode === 'move' ? {moveFrame: clip.startFrame + delta} :
        mode === 'start' ? {startFrame: clip.startFrame + delta} : {endFrame: clip.endFrame + delta}, maximumFrame);
      setDraft(nextTrack);
    };
    const finish = commit => {
      window.removeEventListener('pointermove', update); window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', cancel); window.removeEventListener('blur', cancel);
      window.removeEventListener('keydown', escape, true);
      cancelGesture.current = null; onGestureCancelChange?.(null); setDraft(null);
      if (commit && moved && !hx(baseline, nextTrack)) onChange(nextTrack);
      else if (commit && !moved && mode === 'move') selectClip(clip);
    };
    const up = pointer => {if (pointer.pointerId === event.pointerId) {update(pointer); finish(true);}};
    const cancel = () => finish(false);
    const escape = key => {if (key.key === 'Escape') {key.preventDefault(); key.stopPropagation(); cancel();}};
    cancelGesture.current = cancel; onGestureCancelChange?.(cancel);
    window.addEventListener('pointermove', update); window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', cancel); window.addEventListener('blur', cancel);
    window.addEventListener('keydown', escape, true);
  };
  const deleteCamera = (camera, event) => {
    if (!editable || camera.authoring?.cameraLocked || !props.onDeleteCamera) return;
    const focusOwner = event.currentTarget.closest?.('[data-director-shot-keyboard]');
    if (props.onDeleteCamera(camera.id) !== false) {setSelected(null); focusOwner?.focus({preventScroll: true});}
  };
  const clipKey = (event, clip, camera) => {
    if (['Delete', 'Backspace'].includes(event.key)) {
      if (event.defaultPrevented || event.isComposing || gZ(event.target)) return;
      event.preventDefault(); event.stopPropagation();
      if (event.repeat || event.ctrlKey || event.metaKey || event.altKey || event.shiftKey || menu ||
        document.querySelector('[role="dialog"][data-state="open"]:not([data-director-stage-root="true"]), [role="menu"][data-state="open"]')) return;
      deleteCamera(camera, event);
    } else if (event.key === 'Enter') {
      event.preventDefault(); event.stopPropagation(); selectClip(clip);
    } else if (editable && ['ArrowLeft', 'ArrowRight'].includes(event.key)) {
      if (event.defaultPrevented || event.isComposing || gZ(event.target) || event.target !== event.currentTarget ||
        event.ctrlKey || event.metaKey || event.altKey || menu ||
        document.querySelector('[role="dialog"][data-state="open"]:not([data-director-stage-root="true"]), [role="menu"][data-state="open"]')) return;
      event.preventDefault(); event.stopPropagation();
      onChange(__localEditShot(normalized, clip.id, {moveFrame: clip.startFrame +
        (event.key === 'ArrowLeft' ? -1 : 1) * (event.shiftKey ? 10 : 1)}, maximumFrame));
    }
  };
  return {...props, editable, normalized, shown, selected, selectedClip, menu, fps, maximumFrame, frame,
    atPointer, addMenu, openMenu, begin, selectClip, deleteCamera, clipKey, setSelected, closeMenu};
}

function __LocalCameraShotDuration({controller: model, cameraId}) {
  const camera = model?.cameras.find(value => value.id === cameraId);
  if (!camera) return null;
  const clips = model.shown.clips.filter(clip => clip.cameraId === cameraId);
  const enabled = clips.filter(clip => clip.enabled !== false);
  const durationFrames = enabled.reduce((total, clip) => total + Math.max(0, clip.endFrame - clip.startFrame), 0);
  const disabledCount = clips.length - enabled.length;
  const seconds = (durationFrames / model.fps).toFixed(2);
  const detail = clips.length ? enabled.length + ' 个启用片段的拍摄时长合计' +
    (disabledCount ? '；' + disabledCount + ' 个停用片段未计入' : '') : '尚未添加拍摄片段';
  return i.jsx('span', {
    'data-testid': 'director-stage-camera-shot-duration-' + cameraId,
    'data-duration-frames': durationFrames, 'data-fps': model.fps,
    'aria-label': nC(camera) + '：镜头时长 ' + seconds + ' 秒，' + detail,
    title: '镜头时长 ' + seconds + ' 秒（' + durationFrames + ' 帧，' + model.fps + ' FPS）\n' + detail,
    style: {display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
      minWidth: 44, height: 18, boxSizing: 'border-box', marginLeft: 4, padding: '0 5px',
      border: '1px solid #242424', borderRadius: 4, background: '#111111', color: '#a3a3a3',
      fontSize: 10, lineHeight: '16px', fontWeight: 400, fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap'},
    children: seconds + 's'});
}

function __LocalCameraShotLane({controller: model, cameraId, keyframeBand = false}) {
  const time = n.useSyncExternalStore(model.clock.subscribe, model.clock.getSnapshot, model.clock.getSnapshot);
  const currentFrame = Math.floor(time * model.fps + 1e-7);
  const camera = model.cameras.find(value => value.id === cameraId);
  if (!camera) return null;
  const clips = model.shown.clips.filter(clip => clip.cameraId === cameraId);
  const winner = __localActiveLayerShot(model.shown, model.cameras.map(value => value.id), currentFrame);
  return i.jsxs('div', {'data-testid': 'director-stage-camera-shot-lane-' + cameraId,
    'data-director-shot-keyboard': true, 'data-camera-id': cameraId, tabIndex: -1,
    onKeyDown: event => {if (g_(event) && !event.isComposing && !gZ(event.target)) {event.preventDefault(); event.stopPropagation();}},
    onContextMenu: event => model.openMenu(event, cameraId),
    onDoubleClick: event => {if (!event.target.closest('[data-camera-shot]')) model.openMenu(event, cameraId);},
    style: {position: 'absolute', inset: 0, bottom: keyframeBand ? 24 : 0, zIndex: 10, minWidth: 0}, children: [
      !clips.length && i.jsx('button', {type: 'button', disabled: !model.editable,
        'data-testid': 'director-stage-camera-shot-add-' + cameraId, 'aria-label': '添加拍摄片段 ' + nC(camera),
        title: '为这台相机添加拍摄时段，也可右键空白处指定时间',
        onPointerDown: event => event.stopPropagation(), onDoubleClick: event => event.stopPropagation(),
        onClick: event => {event.stopPropagation(); model.addMenu(event.currentTarget, cameraId);},
        style: {position: 'absolute', left: 8, top: 4, height: 26, padding: '0 8px',
          border: '1px dashed #343434', borderRadius: 4, background: '#0a0a0a', color: '#a3a3a3', fontSize: 11, cursor: 'pointer'},
        children: '+ 添加拍摄片段'}),
      clips.map(clip => {
        const position = fy(model.scale, clip.startFrame, clip.endFrame);
        const active = winner?.id === clip.id;
        const selected = model.selected === clip.id;
        const label = nC(camera) + ' · ' + ((clip.endFrame - clip.startFrame) / model.fps).toFixed(2) + 's';
        return i.jsxs('div', {role: 'button', tabIndex: 0, 'aria-label': label, 'aria-keyshortcuts': 'Backspace Delete',
          'aria-current': active ? 'true' : undefined, 'aria-selected': selected,
          'data-testid': 'director-stage-storyboard-clip-' + clip.id, 'data-camera-shot': true, 'data-shot-editable': model.editable,
          'data-camera-id': cameraId, 'data-start-frame': clip.startFrame, 'data-end-frame': clip.endFrame,
          'data-enabled': clip.enabled !== false,
          title: label + ' · ' + (clip.startFrame / model.fps).toFixed(2) + '–' + (clip.endFrame / model.fps).toFixed(2) + ' 秒；拖动两端调整拍摄时长',
          onPointerDown: event => model.begin(event, clip, 'move'),
          onContextMenu: event => model.openMenu(event, cameraId, clip),
          onDoubleClick: event => model.openMenu(event, cameraId, clip),
          onFocus: event => {if (event.target === event.currentTarget) model.setSelected(clip.id);},
          onKeyDown: event => model.clipKey(event, clip, camera),
          style: {position: 'absolute', top: 3, bottom: 3, left: position.left, width: position.width, minWidth: 1,
            display: 'flex', alignItems: 'center', boxSizing: 'border-box', overflow: 'hidden', borderRadius: 4,
            border: '1px solid ' + (selected ? '#f5f5f5' : active ? '#aaaaaa' : '#545454'),
            boxShadow: selected ? 'inset 0 0 0 1px #ffffff20' : undefined,
            background: clip.enabled === false ? '#111111' : '#202020', opacity: clip.enabled === false ? .45 : 1,
            color: '#f5f5f5', cursor: model.editable ? 'grab' : 'default', touchAction: 'none'}, children: [
            position.width >= 170 && model.previews?.[clip.id] && i.jsx('img', {src: model.previews[clip.id], alt: '', draggable: false,
              style: {height: '100%', width: 40, objectFit: 'cover', pointerEvents: 'none', flexShrink: 0}}),
            i.jsx('span', {style: {minWidth: 0, flex: 1, overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis',
              fontSize: 11, padding: '0 8px', pointerEvents: 'none'}, children: label}),
            position.width > 90 && i.jsx('input', {type: 'checkbox', checked: clip.enabled !== false, disabled: !model.editable,
              title: '启用镜头', 'aria-label': '启用镜头 ' + nC(camera),
              onPointerDown: event => event.stopPropagation(), onClick: event => event.stopPropagation(),
              onDoubleClick: event => event.stopPropagation(),
              onChange: event => model.onChange(__localEditShot(model.normalized, clip.id, {enabled: event.target.checked}, model.maximumFrame)),
              style: {margin: '0 8px 0 2px', width: 12, height: 12, flexShrink: 0}}),
            position.width > 145 && model.onDeleteCamera && i.jsx('button', {type: 'button',
              disabled: !model.editable || camera.authoring?.cameraLocked,
              title: '删除相机 ' + nC(camera), 'aria-label': '删除相机 ' + nC(camera),
              'data-testid': 'director-stage-shot-delete-camera-' + clip.id,
              onPointerDown: event => event.stopPropagation(), onDoubleClick: event => event.stopPropagation(),
              onKeyDown: event => {if (!g_(event)) event.stopPropagation();},
              onClick: event => {event.stopPropagation(); model.deleteCamera(camera, event);},
              style: {display: 'grid', placeItems: 'center', width: 20, height: 22, marginRight: 8, padding: 0,
                border: 0, background: 'transparent', color: '#a3a3a3', cursor: 'pointer', flexShrink: 0},
              children: i.jsx(mI.A, {size: 13})}),
            model.editable && ['start', 'end'].map(edge => i.jsx('button', {type: 'button', tabIndex: -1,
              'aria-label': (edge === 'start' ? '调整镜头开始 ' : '调整镜头结束 ') + nC(camera),
              title: edge === 'start' ? '调整镜头开始' : '调整镜头结束',
              onPointerDown: event => model.begin(event, clip, edge), onClick: event => event.stopPropagation(),
              onDoubleClick: event => event.stopPropagation(),
              style: {position: 'absolute', top: 0, bottom: 0, [edge === 'start' ? 'left' : 'right']: 0,
                width: Math.min(7, position.width / 3), border: 0, padding: 0, background: '#ffffff15', cursor: 'ew-resize'}}, edge))]}, clip.id);
      })]});
}

function __LocalCameraShotFooter({controller: model}) {
  const clip = model.selectedClip;
  const button = {display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 5,
    height: 25, padding: '0 7px', border: '1px solid #343434', borderRadius: 4,
    background: 'transparent', color: '#f5f5f5', fontSize: 11, whiteSpace: 'nowrap', cursor: 'pointer'};
  return i.jsxs('div', {'data-testid': 'director-stage-storyboard-track', 'data-director-shot-keyboard': true, tabIndex: -1,
    onKeyDown: event => {if (g_(event) && !event.isComposing && !gZ(event.target)) {event.preventDefault(); event.stopPropagation();}},
    style: {flexShrink: 0, minWidth: 0, background: '#0a0a0a', borderTop: '1px solid #242424'}, children: [
      i.jsxs('div', {style: {display: 'flex', alignItems: 'center', gap: 8, height: 36, padding: '0 10px', overflowX: 'auto', fontSize: 11}, children: [
        i.jsx('span', {style: {fontWeight: 500, color: '#f5f5f5', whiteSpace: 'nowrap'}, children: '镜头剪辑'}),
        i.jsxs('button', {type: 'button', disabled: !model.shown.clips.some(value => value.enabled !== false),
          'aria-label': '预览镜头剪辑', title: '按各相机行的拍摄时段预览', onClick: () => model.onPreview?.(), style: button,
          children: [i.jsx(pR.A, {size: 14}), '预览']}),
        i.jsxs('button', {type: 'button', disabled: !model.editable, 'aria-label': '添加镜头',
          'data-testid': 'director-stage-storyboard-add', onClick: event => model.addMenu(event.currentTarget), style: button,
          children: [i.jsx(mS.A, {size: 14}), model.cameras.length ? '添加片段' : '添加相机']}),
        i.jsx('span', {style: {color: '#a3a3a3', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis'},
          children: model.shown.clips.length ? model.shown.clips.length + ' 个片段 · 上方优先 · 结束 ' + (rU(model.shown) / model.fps).toFixed(2) + ' 秒' : '在相机行添加片段；重叠时上方轨道优先'}),
      ]}),
      clip && i.jsx(__LocalShotTimingEditor, {key: clip.id, clip, track: model.normalized, cameras: model.cameras,
        fps: model.fps, maximumFrame: model.maximumFrame, editable: model.editable, onChange: model.onChange,
        onAppend: event => model.addMenu(event.currentTarget, undefined, clip.endFrame), onClose: () => model.setSelected(null)}),
      model.menu && i.jsx(__LocalShotMenu, {key: (model.menu.clipId ?? 'new') + ':' + model.menu.frame + ':' + model.menu.x,
        menu: model.menu, track: model.normalized, cameras: model.cameras, fps: model.fps, maximumFrame: model.maximumFrame,
        onClose: model.closeMenu, onChange: model.onChange, onDeleteCamera: model.onDeleteCamera,
        onInsert: request => model.onInsert?.(request)})]});
}
