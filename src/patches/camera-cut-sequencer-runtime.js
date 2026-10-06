function __localNormalizeShots(clips, cameraIds) {
  const allowed = cameraIds ? new Set(cameraIds) : null;
  const seen = new Set();
  let end = 0;
  const normalized = [];
  const valid = (Array.isArray(clips) ? clips : []).filter(clip => clip &&
    typeof clip.id === 'string' && clip.id && typeof clip.cameraId === 'string' && clip.cameraId &&
    typeof clip.createdAt === 'string' && clip.createdAt && Number.isInteger(clip.startFrame) &&
    Number.isInteger(clip.endFrame) && clip.startFrame >= 0 && clip.endFrame > clip.startFrame);
  for (const clip of valid.sort(rK)) {
    if (seen.has(clip.id) || (allowed && !allowed.has(clip.cameraId))) continue;
    seen.add(clip.id);
    const startFrame = Math.max(end, clip.startFrame);
    if (clip.endFrame <= startFrame) continue;
    const value = {...rW(clip), startFrame};
    normalized.push(value);
    end = value.endFrame;
  }
  return {version: 1, clips: normalized};
}

function __localShotBounds(track, clipId, maximumFrame) {
  const clips = rO(track).clips;
  const index = clips.findIndex(clip => clip.id === clipId);
  if (index < 0) return null;
  return {clip: clips[index], minimum: clips[index - 1]?.endFrame ?? 0,
    maximum: Math.min(maximumFrame, clips[index + 1]?.startFrame ?? maximumFrame)};
}

function __localEditShot(track, clipId, change, maximumFrame = 3600) {
  const normalized = rO(track);
  const bounds = __localShotBounds(normalized, clipId, maximumFrame);
  if (!bounds) return normalized;
  const clip = bounds.clip;
  let startFrame = clip.startFrame;
  let endFrame = clip.endFrame;
  if (Number.isFinite(change.moveFrame)) {
    const duration = endFrame - startFrame;
    startFrame = Math.max(bounds.minimum, Math.min(bounds.maximum - duration, Math.round(change.moveFrame)));
    endFrame = startFrame + duration;
  } else {
    if (Number.isFinite(change.startFrame)) startFrame = Math.max(bounds.minimum, Math.min(endFrame - 1, Math.round(change.startFrame)));
    if (Number.isFinite(change.endFrame)) endFrame = Math.max(startFrame + 1, Math.min(bounds.maximum, Math.round(change.endFrame)));
  }
  return rO({clips: normalized.clips.map(value => value.id !== clipId ? value : {
    ...value, startFrame, endFrame,
    ...(typeof change.enabled === 'boolean' ? {enabled: change.enabled} : {}),
    ...(typeof change.cameraId === 'string' && change.cameraId ? {cameraId: change.cameraId} : {})
  })});
}

function __localInsertShot(track, request, maximumFrame) {
  const normalized = rO(track);
  const startFrame = Math.max(0, Math.round(request.startFrame));
  if (!Number.isFinite(startFrame) || startFrame >= maximumFrame ||
      normalized.clips.some(clip => startFrame >= clip.startFrame && startFrame < clip.endFrame)) return null;
  const nextFrame = normalized.clips.find(clip => clip.startFrame > startFrame)?.startFrame ?? maximumFrame;
  const endFrame = Math.min(maximumFrame, nextFrame, startFrame + Math.max(1, Math.round(request.durationFrames)));
  if (!request.cameraId || !request.id || !request.createdAt || !Number.isFinite(endFrame) || endFrame <= startFrame) return null;
  return rO({clips: [...normalized.clips, {id: request.id, cameraId: request.cameraId,
    startFrame, endFrame, enabled: true, createdAt: request.createdAt}]});
}

function __localInsertShotInState(state, request, currentView) {
  let document = oE(state);
  const fps = state.timeline.displayFps;
  const cameraId = request.newCamera ? request.newCameraId : request.cameraId;
  const track = __localInsertShot(state.timeline.cameraCutTrack,
    {...request, cameraId, durationFrames: request.durationFrames ?? 2 * fps}, 30 * fps);
  if (!track) return {ok: false, reason: '该时间已被镜头占用，或已到达 30 秒上限'};
  if (request.newCamera) {
    const names = new Set(document.cameras.map(camera => camera.name));
    let number = document.cameras.length + 1;
    while (names.has('相机 ' + number)) number++;
    const created = t2(document, {id: cameraId, name: '相机 ' + number,
      outputPolicy: 'preserve', presetId: 'current-view', currentView});
    if (!created.ok) return {ok: false, reason: '无法从当前视角创建相机'};
    document = created.document;
  } else if (!document.cameras.some(camera => camera.id === cameraId)) {
    return {ok: false, reason: '相机不存在'};
  }
  return {ok: true, cameraId, state: {...state, multiCamera: document, timeline: {...state.timeline,
    durationSec: Math.max(state.timeline.durationSec, rU(track) / fps), cameraCutTrack: track}}};
}

function __LocalShotMenu({menu, track, cameras, fps, maximumFrame, onClose, onChange, onInsert, onDeleteCamera}) {
  const clip = menu.clipId ? track.clips.find(value => value.id === menu.clipId) : null;
  const [cameraId, setCameraId] = n.useState(clip?.cameraId ?? cameras[0]?.id ?? '');
  const [start, setStart] = n.useState(String((clip?.startFrame ?? menu.frame) / fps));
  const [duration, setDuration] = n.useState(String(clip ? (clip.endFrame - clip.startFrame) / fps : 2));
  const [enabled, setEnabled] = n.useState(clip?.enabled !== false);
  const [error, setError] = n.useState('');
  const ref = n.useRef(null);
  n.useEffect(() => {
    const outside = event => {if (!ref.current?.contains(event.target)) onClose();};
    const escape = event => {if (event.key === 'Escape') {event.stopPropagation(); onClose();}};
    window.addEventListener('pointerdown', outside, true);
    window.addEventListener('keydown', escape, true);
    return () => {window.removeEventListener('pointerdown', outside, true); window.removeEventListener('keydown', escape, true);};
  }, [onClose]);
  const submit = newCamera => {
    const startFrame = Math.round(Number(start) * fps);
    const durationFrames = Math.round(Number(duration) * fps);
    if (!Number.isFinite(startFrame) || !Number.isFinite(durationFrames) || startFrame < 0 || durationFrames < 1 || startFrame + durationFrames > maximumFrame) {
      setError('镜头范围需在 0 至 30 秒内，至少保留一帧'); return;
    }
    if (clip) {
      const bounds = __localShotBounds(track, clip.id, maximumFrame);
      if (startFrame < bounds.minimum || startFrame + durationFrames > bounds.maximum) {setError('镜头不能与相邻片段重叠'); return;}
      onChange(rO({clips: track.clips.map(value => value.id === clip.id ? {...value, cameraId, startFrame,
        endFrame: startFrame + durationFrames, enabled} : value)}));
      onClose();
    } else {
      const result = onInsert?.({cameraId, startFrame, durationFrames, newCamera});
      if (result === false) {setError('当前时间无法添加镜头'); return;}
      onClose();
    }
  };
  const field = {width: '100%', minWidth: 0, boxSizing: 'border-box', border: '1px solid #444',
    background: '#17191b', color: '#eee', borderRadius: 4, padding: '7px 8px', fontSize: 12};
  const button = {display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, padding: '8px 10px',
    border: '1px solid #494d50', background: '#34383b', color: '#eee', borderRadius: 4, cursor: 'pointer', fontSize: 12};
  return i.jsxs('div', {ref, role: 'dialog', 'aria-label': clip ? '镜头设置' : '添加镜头',
    'data-testid': 'director-stage-shot-menu', 'data-ui-menu-overlay': 'true',
    onPointerDown: event => event.stopPropagation(), onKeyDown: event => event.stopPropagation(),
    style: {position: 'fixed', zIndex: 1000, left: Math.max(8, Math.min(menu.x, window.innerWidth - 284)),
      top: Math.max(8, Math.min(menu.y - 275, window.innerHeight - 300)), width: 270, maxWidth: 'calc(100vw - 16px)',
      boxSizing: 'border-box', background: '#232527', color: '#eee', border: '1px solid #4b4d50',
      borderRadius: 6, padding: 12, boxShadow: '0 10px 36px #0008', fontSize: 12},
    children: [i.jsxs('div', {style: {display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12},
      children: [i.jsx('strong', {children: clip ? '镜头设置' : '添加镜头'}),
        i.jsx('button', {type: 'button', title: '关闭', 'aria-label': '关闭镜头设置', onClick: onClose,
          style: {...button, padding: 3}, children: i.jsx(oy.A, {size: 14})})]}),
      i.jsxs('label', {style: {display: 'grid', gap: 5}, children: ['相机', i.jsx('select', {
        'aria-label': '镜头相机', value: cameraId, onChange: event => setCameraId(event.target.value), style: field,
        children: cameras.map(camera => i.jsx('option', {value: camera.id, children: nC(camera)}, camera.id))})]}),
      i.jsxs('div', {style: {display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginTop: 10}, children: [
        i.jsxs('label', {style: {display: 'grid', gap: 5}, children: ['开始（秒）', i.jsx('input', {
          type: 'number', min: 0, max: 30, step: 1 / fps, value: start, 'aria-label': '镜头开始时间',
          onChange: event => {setStart(event.target.value); setError('');}, style: field})]}),
        i.jsxs('label', {style: {display: 'grid', gap: 5}, children: ['时长（秒）', i.jsx('input', {
          type: 'number', min: 1 / fps, max: 30, step: 1 / fps, value: duration, 'aria-label': '镜头时长',
          onChange: event => {setDuration(event.target.value); setError('');}, style: field})]})]}),
      clip && i.jsxs('label', {style: {display: 'flex', alignItems: 'center', gap: 7, marginTop: 10}, children: [
        i.jsx('input', {type: 'checkbox', checked: enabled, onChange: event => setEnabled(event.target.checked)}), '启用镜头']}),
      error && i.jsx('div', {role: 'alert', style: {color: '#ff9991', marginTop: 8}, children: error}),
      i.jsxs('div', {style: {display: 'flex', gap: 7, marginTop: 12}, children: [
        i.jsxs('button', {type: 'button', disabled: !cameraId, onClick: () => submit(false), style: {...button, flex: 1},
          children: [i.jsx(clip ? cj.A : mS.A, {size: 14}), clip ? '应用' : '添加相机']}),
        clip ? i.jsx('button', {type: 'button', title: '删除镜头', 'aria-label': '删除镜头',
          onClick: () => {onChange(rG(track, clip.id)); onClose();}, style: button, children: i.jsx(mI.A, {size: 14})}) :
          i.jsxs('button', {type: 'button', onClick: () => submit(true), style: {...button, flex: 1},
            children: [i.jsx(cj.A, {size: 14}), '新建相机']})]}),
      clip && onDeleteCamera && i.jsxs('button', {type: 'button', 'aria-label': '删除相机',
        disabled: cameras.find(camera => camera.id === clip.cameraId)?.authoring?.cameraLocked,
        onClick: () => {if (onDeleteCamera(clip.cameraId) !== false) onClose();},
        style: {...button, width: '100%', marginTop: 8, color: '#ffb0aa'},
        children: [i.jsx(mI.A, {size: 14}), '删除相机']})]});
}

function __LocalShotTrack(props) {
  const {track, boundaryKey, editable = true, cameras, previews, scale, scrollLeftPx,
    clock, onChange, onSelectCamera, onSeek, onInsert, onPreview, onDeleteCamera, onScrollLeftChange,
    onGestureCancelChange} = props;
  const normalized = n.useMemo(() => rO(track, cameras.map(camera => camera.id)), [track, cameras]);
  const [draft, setDraft] = n.useState(null);
  const [menu, setMenu] = n.useState(null);
  const [selected, setSelected] = n.useState(null);
  const surface = n.useRef(null);
  const cancelGesture = n.useRef(null);
  const scroll = n.useRef(scrollLeftPx);
  scroll.current = scrollLeftPx;
  const time = n.useSyncExternalStore(clock.subscribe, clock.getSnapshot, clock.getSnapshot);
  const shown = draft ?? normalized;
  const fps = scale.displayFps;
  const maximumFrame = Math.round(30 * fps);
  const frame = Math.floor(time * fps + 1e-7);
  const closeMenu = n.useCallback(() => setMenu(null), []);
  n.useEffect(() => {setMenu(null); cancelGesture.current?.();}, [boundaryKey, editable]);
  n.useLayoutEffect(() => {cancelGesture.current?.();}, [normalized, fps, scale.pixelsPerFrame]);
  n.useEffect(() => () => cancelGesture.current?.(), []);
  const atPointer = event => Math.max(0, Math.min(maximumFrame - 1,
    Math.round((event.clientX - surface.current.getBoundingClientRect().left + scroll.current - scale.edgeGutterPx) / scale.pixelsPerFrame)));
  const openMenu = (event, clip) => {
    if (!editable) return;
    event.preventDefault(); event.stopPropagation();
    setSelected(clip?.id ?? null);
    setMenu({x: event.clientX, y: event.clientY, frame: clip?.startFrame ?? atPointer(event), clipId: clip?.id});
  };
  const begin = (event, clip, mode) => {
    if (!editable || event.button !== 0 || !event.isPrimary) return;
    event.preventDefault(); event.stopPropagation();
    cancelGesture.current?.(); closeMenu(); setSelected(clip.id);
    event.currentTarget.focus?.({preventScroll: true});
    const baseline = normalized;
    const startX = event.clientX;
    const startScroll = scroll.current;
    let nextTrack = baseline;
    let moved = false;
    const update = pointer => {
      if (pointer.pointerId !== event.pointerId) return;
      const delta = Math.round((pointer.clientX - startX + scroll.current - startScroll) / scale.pixelsPerFrame);
      if (!moved && Math.abs(pointer.clientX - startX) < 3) return;
      moved = true;
      const rect = surface.current?.getBoundingClientRect();
      if (rect && onScrollLeftChange && (pointer.clientX < rect.left + 20 || pointer.clientX > rect.right - 20)) {
        scroll.current = onScrollLeftChange(Math.max(0, scroll.current + (pointer.clientX < rect.left + 20 ? -8 : 8)));
      }
      nextTrack = __localEditShot(baseline, clip.id, mode === 'move' ? {moveFrame: clip.startFrame + delta} :
        mode === 'start' ? {startFrame: clip.startFrame + delta} : {endFrame: clip.endFrame + delta}, maximumFrame);
      setDraft(nextTrack);
    };
    const finish = commit => {
      window.removeEventListener('pointermove', update);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', cancel);
      window.removeEventListener('blur', cancel);
      window.removeEventListener('keydown', escape, true);
      cancelGesture.current = null; onGestureCancelChange?.(null); setDraft(null);
      if (commit && moved && !hx(baseline, nextTrack)) onChange(nextTrack);
      else if (commit && !moved && mode === 'move') {onSelectCamera(clip.cameraId); onSeek(clip.startFrame / fps); onPreview?.();}
    };
    const up = pointer => {if (pointer.pointerId === event.pointerId) {update(pointer); finish(true);}};
    const cancel = () => finish(false);
    const escape = key => {if (key.key === 'Escape') {key.preventDefault(); key.stopPropagation(); cancel();}};
    cancelGesture.current = cancel; onGestureCancelChange?.(cancel);
    window.addEventListener('pointermove', update);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', cancel);
    window.addEventListener('blur', cancel);
    window.addEventListener('keydown', escape, true);
  };
  const iconButton = {display: 'grid', placeItems: 'center', flexShrink: 0, width: 24, height: 24,
    border: 0, padding: 0, borderRadius: 4, background: 'transparent', color: '#d6d8dc', cursor: 'pointer'};
  return i.jsxs('div', {'data-testid': 'director-stage-storyboard-track', 'data-director-shot-keyboard': true, tabIndex: -1,
    onKeyDown: event => {
      if (g_(event) && !event.isComposing && !gZ(event.target)) {event.preventDefault(); event.stopPropagation();}
    }, style: {display: 'grid',
    gridTemplateColumns: '180px minmax(0, 1fr)', height: 52, flexShrink: 0, borderTop: '1px solid #393b3f', background: '#1b1d20'},
    children: [i.jsxs('div', {style: {display: 'flex', alignItems: 'center', gap: 4, padding: '0 10px', borderRight: '1px solid #393b3f'},
      children: [i.jsx('span', {style: {flex: 1, fontSize: 12, whiteSpace: 'nowrap', color: '#d9dde2'}, children: '镜头剪辑'}),
        i.jsx('button', {type: 'button', disabled: !cameras.length, title: '预览镜头剪辑', 'aria-label': '预览镜头剪辑', style: iconButton,
          onClick: () => onPreview?.(), children: i.jsx(pR.A, {size: 15})}),
        i.jsx('button', {type: 'button', disabled: !editable, title: '添加镜头', 'aria-label': '添加镜头',
          'data-testid': 'director-stage-storyboard-add', style: iconButton,
          onClick: event => {const rect = event.currentTarget.getBoundingClientRect(); setMenu({x: rect.left, y: rect.top,
            frame: Math.min(maximumFrame - 1, Math.max(0, Math.round(clock.getSnapshot() * fps)))});},
          children: i.jsx(mS.A, {size: 16})})]}),
      i.jsx('div', {ref: surface, onContextMenu: event => openMenu(event),
        style: {position: 'relative', overflow: 'hidden', minWidth: 0}, children: i.jsxs('div', {
          'data-testid': 'director-stage-storyboard-surface', style: {position: 'relative', height: '100%',
            minWidth: '100%', width: scale.contentWidthPx, transform: 'translateX(' + (-scrollLeftPx) + 'px)'},
          children: [shown.clips.map(clip => {
            const camera = cameras.find(value => value.id === clip.cameraId);
            if (!camera) return null;
            const position = fy(scale, clip.startFrame, clip.endFrame);
            const active = clip.enabled !== false && frame >= clip.startFrame && frame < clip.endFrame;
            return i.jsxs('div', {role: 'button', tabIndex: 0, 'aria-label': nC(camera) + ' · ' + ((clip.endFrame - clip.startFrame) / fps).toFixed(2) + 's',
              'aria-keyshortcuts': 'Backspace Delete',
              'aria-current': active ? 'true' : undefined, 'aria-selected': selected === clip.id,
              'data-testid': 'director-stage-storyboard-clip-' + clip.id, 'data-camera-id': camera.id,
              'data-start-frame': clip.startFrame, 'data-end-frame': clip.endFrame, 'data-enabled': clip.enabled !== false,
              onPointerDown: event => begin(event, clip, 'move'), onContextMenu: event => openMenu(event, clip),
              onFocus: event => {if (event.target === event.currentTarget) setSelected(clip.id);},
              onDoubleClick: event => openMenu(event, clip), onKeyDown: event => {
                if (['Delete', 'Backspace'].includes(event.key)) {
                  if (event.defaultPrevented || event.isComposing || gZ(event.target)) return;
                  event.preventDefault(); event.stopPropagation();
                  if (event.repeat || event.ctrlKey || event.metaKey || event.altKey || event.shiftKey || !editable ||
                      camera.authoring?.cameraLocked || menu ||
                      document.querySelector('[role="dialog"][data-state="open"]:not([data-director-stage-root="true"]), [role="menu"][data-state="open"]')) return;
                  const focusOwner = event.currentTarget.closest?.('[data-testid="director-stage-storyboard-track"]');
                  if (onDeleteCamera && onDeleteCamera(camera.id) !== false) {setSelected(null); focusOwner?.focus({preventScroll: true});}
                }
                else if (event.key === 'Enter' && editable) {event.preventDefault(); const rect = event.currentTarget.getBoundingClientRect(); setMenu({x: rect.left, y: rect.top, clipId: clip.id, frame: clip.startFrame});}
                else if (editable && ['ArrowLeft', 'ArrowRight'].includes(event.key)) {event.preventDefault(); event.stopPropagation();
                  onChange(__localEditShot(normalized, clip.id, {moveFrame: clip.startFrame + (event.key === 'ArrowLeft' ? -1 : 1) * (event.shiftKey ? 10 : 1)}, maximumFrame));}
              }, style: {position: 'absolute', top: 4, bottom: 4, left: position.left, width: position.width,
                minWidth: 1, display: 'flex', alignItems: 'center', overflow: 'hidden', boxSizing: 'border-box',
                borderRadius: 4, border: '1px solid ' + (active || selected === clip.id ? '#d5e1eb' : '#555b64'),
                background: clip.enabled === false ? '#26282b' : '#344454', opacity: clip.enabled === false ? .55 : 1,
                color: '#e7edf1', cursor: 'grab', touchAction: 'none'}, children: [
                previews?.[clip.id] && i.jsx('img', {src: previews[clip.id], alt: '', draggable: false,
                  style: {height: '100%', width: 64, objectFit: 'cover', pointerEvents: 'none', flexShrink: 0}}),
                i.jsxs('span', {style: {minWidth: 0, flex: 1, overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis', fontSize: 11, padding: '0 8px'},
                  children: [nC(camera), ' · ', ((clip.endFrame - clip.startFrame) / fps).toFixed(2), 's']}),
                position.width > 70 && i.jsx('input', {type: 'checkbox', checked: clip.enabled !== false, disabled: !editable,
                  title: '启用镜头', 'aria-label': '启用镜头 ' + nC(camera), onPointerDown: event => event.stopPropagation(),
                  onClick: event => event.stopPropagation(), onChange: event => onChange(__localEditShot(normalized, clip.id, {enabled: event.target.checked}, maximumFrame)),
                  style: {marginRight: 10, flexShrink: 0}}),
                position.width > 105 && onDeleteCamera && i.jsx('button', {type: 'button',
                  disabled: !editable || camera.authoring?.cameraLocked, title: '删除相机 ' + nC(camera),
                  'aria-label': '删除相机 ' + nC(camera), 'data-testid': 'director-stage-shot-delete-camera-' + clip.id,
                  onPointerDown: event => event.stopPropagation(), onKeyDown: event => {if (!g_(event)) event.stopPropagation();},
                  onClick: event => {event.stopPropagation(); onDeleteCamera(camera.id);},
                  style: {...iconButton, marginRight: 9, opacity: !editable || camera.authoring?.cameraLocked ? .35 : 1},
                  children: i.jsx(mI.A, {size: 14})}),
                editable && ['start', 'end'].map(edge => i.jsx('button', {type: 'button', tabIndex: -1,
                  title: edge === 'start' ? '调整镜头开始' : '调整镜头结束', 'aria-label': (edge === 'start' ? '调整镜头开始 ' : '调整镜头结束 ') + nC(camera),
                  onPointerDown: event => begin(event, clip, edge), onClick: event => event.stopPropagation(),
                  style: {position: 'absolute', top: 0, bottom: 0, [edge === 'start' ? 'left' : 'right']: 0,
                    width: Math.min(7, position.width / 3), padding: 0, border: 0, background: '#ffffff12', cursor: 'ew-resize'}}, edge))]}, clip.id);
          }), i.jsx('div', {'aria-hidden': true, style: {position: 'absolute', top: 0, bottom: 0,
            left: fb(scale, frame), width: 1, background: '#fff', pointerEvents: 'none', zIndex: 2}})]})}),
      menu && i.jsx(__LocalShotMenu, {key: (menu.clipId ?? 'new') + ':' + menu.frame + ':' + menu.x,
        menu, track: normalized, cameras, fps, maximumFrame, onClose: closeMenu, onChange, onDeleteCamera,
        onInsert: request => onInsert?.(request)})]});
}
