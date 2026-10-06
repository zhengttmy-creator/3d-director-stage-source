function __localCreatePoseMotion({pose, target, name, durationSec = 1, existing}) {
  if (!pose || !target || target.skeletonId !== th || target.skeletonVersion !== 1) throw Error('\u8bf7\u5148\u9009\u4e2d\u53ef\u7f16\u8f91\u7684\u4eba\u7269');
  const duration = Number.isFinite(durationSec) ? Math.min(30, Math.max(0.05, durationSec)) : 1;
  const now = new Date().toISOString();
  const frame = timeSec => ({
    timeSec,
    // copyPose contains Quaternion instances whose getters do not survive structuredClone.
    pose: {signature: pose.signature, rotations: pose.rotations.map(({boneIndex, rotation, bindWorldRotation}) => ({
      boneIndex,
      rotation: {x: rotation.x, y: rotation.y, z: rotation.z},
      bindWorldRotation: {x: bindWorldRotation.x, y: bindWorldRotation.y, z: bindWorldRotation.z, w: bindWorldRotation.w},
    }))},
    ...(pose.rootTranslation ? {rootTranslation: {...pose.rootTranslation}} : {}),
  });
  const result = g7({
    id: existing?.id || 'pose-' + crypto.randomUUID(),
    name: (name || '\u81ea\u5b9a\u4e49\u59ff\u52bf').trim().slice(0, 80),
    skeletonId: th, skeletonVersion: 1, durationSec: duration,
    source: 'recorded', loop: false, motionUsage: 'direct', locomotion: {mode: 'embedded'},
    keyframes: [frame(0), frame(duration)],
    createdAt: existing?.createdAt || now, updatedAt: now,
  });
  if (!result) throw Error('\u59ff\u52bf\u6570\u636e\u65e0\u6548');
  return result;
}

function __localIsStaticPoseMotion(motion) {
  if (!motion || motion.keyframes?.length !== 2) return false;
  const [first, last] = motion.keyframes;
  return JSON.stringify(first.pose) === JSON.stringify(last.pose) &&
    JSON.stringify(first.rootTranslation) === JSON.stringify(last.rootTranslation);
}

function __localIsPoseCatalog(asset) {
  return asset?.localPosePreset === true || String(asset?.assetId || '').startsWith('local-pose-');
}

function __localAttachSavedPoseSession(current, captured, id) {
  return captured && current === captured ? {...current, localPoseId: id} : current;
}

async function __localPersistPoseCollection({next, port, operation, compact, signal, isCurrent, onSaved}) {
  if (!port || !operation) throw Error('\u672c\u5730\u59ff\u52bf\u5e93\u5c1a\u672a\u52a0\u8f7d');
  const draft = await compact(next, {signal});
  if (signal.aborted || !isCurrent()) throw new DOMException('Aborted', 'AbortError');
  const result = await port.saveDraft(g5, 'generation', draft, undefined, operation, {signal});
  if (!result?.ok) throw Error(result?.error?.message || '\u59ff\u52bf\u4fdd\u5b58\u5931\u8d25');
  if (signal.aborted || !isCurrent()) throw new DOMException('Aborted', 'AbortError');
  onSaved(next);
}

async function __localPersistPoseMotion({motion, motions, ...storage}) {
  const normalized = g7(motion);
  if (!normalized || !__localIsStaticPoseMotion(normalized)) throw Error('\u59ff\u52bf\u6570\u636e\u65e0\u6548');
  normalized.name = g4(motions.filter(item => item.id !== normalized.id), normalized.name);
  const next = motions.some(item => item.id === normalized.id)
    ? motions.map(item => item.id === normalized.id ? normalized : item)
    : [...motions, normalized];
  await __localPersistPoseCollection({next, ...storage});
  return normalized;
}

async function __localManagePoseMotion({kind, id, name, motions, inUseMotionIds, ...storage}) {
  const current = motions.find(motion => motion.id === id);
  if (!__localIsStaticPoseMotion(current)) throw Error('\u8bf7\u9009\u4e2d\u672c\u5730\u59ff\u52bf');
  let next;
  if (kind === 'delete') {
    if (inUseMotionIds.has(id)) throw Error('\u8be5\u59ff\u52bf\u6b63\u5728\u65f6\u95f4\u8f74\u4e2d\u4f7f\u7528\uff0c\u4e0d\u80fd\u5220\u9664');
    next = motions.filter(motion => motion.id !== id);
  } else if (kind === 'rename') {
    if (!name?.trim()) throw Error('\u8bf7\u8f93\u5165\u59ff\u52bf\u540d\u79f0');
    const uniqueName = g4(motions.filter(motion => motion.id !== id), name.trim().slice(0, 80));
    next = motions.map(motion => motion.id === id ? {...motion, name: uniqueName, updatedAt: new Date().toISOString()} : motion);
  } else throw Error('Invalid pose operation');
  await __localPersistPoseCollection({next, ...storage});
  return true;
}

const __localPoseIcons = {save: r(73613).A, read: r(55001).A, export: r(28010).A, rename: r(33405).A, delete: r(5501).A};
const __localPoseButtonClass = 'flex h-8 shrink-0 items-center justify-center gap-1.5 rounded-lg border border-stroke px-2.5 text-[10px] text-content-secondary outline-none hover:bg-surface-hover hover:text-content focus-visible:ring-2 focus-visible:ring-accent/40 disabled:cursor-not-allowed disabled:opacity-40';

function __LocalPoseCommands({scope, onSave, onRead, onExport, disabled = false}) {
  const [busy, setBusy] = n.useState(false);
  const [message, setMessage] = n.useState('');
  const fileRef = n.useRef(null);
  const run = async operation => {
    if (busy || disabled) return;
    setBusy(true);
    setMessage('');
    try {
      const result = await operation();
      if (result === false || result === null) throw Error('\u64cd\u4f5c\u672a\u5b8c\u6210');
      if (operation === onSave) setMessage('\u5df2\u4fdd\u5b58\u5230\u672c\u5730');
    } catch (error) {
      setMessage(error?.message || '\u64cd\u4f5c\u5931\u8d25');
    } finally { setBusy(false); }
  };
  const button = (kind, label, action) => action && i.jsxs('button', {
    type: 'button', disabled: disabled || busy, className: __localPoseButtonClass,
    'data-testid': 'director-stage-pose-' + kind + '-' + scope,
    onClick: () => run(action),
    children: [i.jsx(__localPoseIcons[kind], {size: 13, 'aria-hidden': true}), label],
  });
  return i.jsxs('span', {
    className: 'flex min-w-0 flex-wrap items-center gap-2',
    children: [
      button('save', busy ? '\u4fdd\u5b58\u4e2d...' : scope === 'picker' ? '\u4fdd\u5b58\u5f53\u524d\u59ff\u52bf' : '\u4fdd\u5b58\u5230\u672c\u5730', onSave),
      onRead && i.jsx('input', {
        ref: fileRef, type: 'file', accept: '.json,.octomotion.json,application/json', className: 'hidden',
        'data-testid': 'director-stage-pose-file-' + scope,
        onChange: event => { const file = event.target.files?.[0]; event.target.value = ''; if (file) onRead(file); },
      }),
      button('read', '\u4ece\u672c\u5730\u8bfb\u53d6', onRead ? () => fileRef.current?.click() : undefined),
      button('export', '\u5bfc\u51fa JSON', onExport),
      message && i.jsx('span', {role: 'status', className: 'max-w-full break-words text-[10px] text-content-secondary', children: message}),
    ],
  });
}

function __LocalPoseManager({motion, onRename, onDelete, onClear, disabled}) {
  const [mode, setMode] = n.useState(null);
  const [name, setName] = n.useState(motion.name);
  const [busy, setBusy] = n.useState(false);
  const [error, setError] = n.useState('');
  n.useEffect(() => { setMode(null); setName(motion.name); setError(''); }, [motion.id, motion.name]);
  const commit = async () => {
    if (busy || disabled) return;
    setBusy(true); setError('');
    try {
      if (mode === 'rename') await onRename(motion.id, name);
      else await onDelete(motion.id);
      setMode(null); onClear();
    } catch (cause) { setError(cause?.message || '\u64cd\u4f5c\u5931\u8d25'); }
    finally { setBusy(false); }
  };
  return i.jsxs('span', {className: 'flex min-w-0 flex-wrap items-center gap-2', children: [
    !mode && ['rename', 'delete'].map(kind => i.jsxs('button', {
      type: 'button', className: __localPoseButtonClass, disabled: disabled || busy,
      'data-testid': 'director-stage-pose-' + kind,
      onClick: () => { setError(''); setMode(kind); },
      children: [i.jsx(__localPoseIcons[kind], {size: 13, 'aria-hidden': true}), kind === 'rename' ? '\u91cd\u547d\u540d' : '\u5220\u9664'],
    }, kind)),
    mode === 'rename' && i.jsx('input', {
      'aria-label': '\u59ff\u52bf\u540d\u79f0', autoFocus: true, maxLength: 80, value: name, disabled: busy,
      className: 'h-8 min-w-0 max-w-[180px] rounded-lg border border-stroke bg-surface px-2 text-[11px] text-content',
      onChange: event => setName(event.target.value),
      onKeyDown: event => { if (event.key === 'Enter') {event.preventDefault(); commit();} },
    }),
    mode === 'delete' && i.jsx('span', {className: 'text-[10px] text-content-secondary', children: '\u5220\u9664\u6b64\u672c\u5730\u59ff\u52bf\uff1f'}),
    mode && i.jsx('button', {type: 'button', className: __localPoseButtonClass, disabled: busy || disabled,
      'data-testid': 'director-stage-pose-manage-confirm', onClick: commit, children: busy ? '\u5904\u7406\u4e2d...' : mode === 'rename' ? '\u4fdd\u5b58' : '\u786e\u8ba4\u5220\u9664'}),
    mode && i.jsx('button', {type: 'button', className: __localPoseButtonClass, disabled: busy,
      onClick: () => {setMode(null);setError('');}, children: '\u53d6\u6d88'}),
    error && i.jsx('span', {role: 'alert', className: 'max-w-full break-words text-[10px] text-danger', children: error}),
  ]});
}

function __LocalPosePickerTools({source, onSource, onSave, onRead, onExport, selected, onRename, onDelete, onClear, disabled}) {
  return i.jsxs('div', {
    className: 'flex flex-wrap items-center justify-between gap-2 border-b border-stroke px-5 py-3',
    children: [
      i.jsx('div', {role: 'tablist', 'aria-label': '\u59ff\u52bf\u6765\u6e90', className: 'flex shrink-0 gap-1', children: [
        ['poses', '\u5e38\u7528\u59ff\u52bf'], ['frames', '\u4ece\u52a8\u4f5c\u9009\u5e27'],
      ].map(([value, label]) => i.jsx('button', {
        type: 'button', role: 'tab', 'aria-selected': source === value,
        className: __localPoseButtonClass + (source === value ? ' bg-surface-raised text-content' : ''),
        onClick: () => onSource(value), children: label,
      }, value))}),
      i.jsx(__LocalPoseCommands, {scope: 'picker', onSave, onRead, onExport, disabled}),
      __localIsStaticPoseMotion(selected) && i.jsx(__LocalPoseManager, {motion: selected, onRename, onDelete, onClear, disabled}),
    ],
  });
}
