function __localCameraTransformGroups(labels) {
  return [
    {id: 'position', label: labels.position, channels: ['x', 'y', 'z'].map(axis => ({id: 'position.' + axis, label: axis.toUpperCase(), axis}))},
    {id: 'rotation', label: labels.rotation || '\u65cb\u8f6c', channels: ['x', 'y', 'z'].map(axis => ({id: 'rotation.' + axis, label: axis.toUpperCase(), axis}))},
    {id: 'lens', label: labels.lens, channels: [{id: 'lens.fov', label: labels.fov}]},
  ];
}

function __LocalCameraTransformProperties(props) {
  const {labels, value, keyframeActive, reconciliationKey = value.id, reconciliationFrame = 'static',
    onToggleKeyframe, onChange, onPreviewChange, onCancelPreview} = props;
  const owner = pi(reconciliationKey);
  const groups = __localCameraTransformGroups(labels);
  return (0,i.jsx)('div', {className: 'divide-y divide-stroke/70',
    'data-testid': 'director-stage-scene-camera-property-tree', children: groups.map(group => {
      if (group.id === 'position' || group.id === 'rotation') {
        const rotation = group.id === 'rotation';
        const vector = rotation ? __localCameraRotation(value) : value.position;
        const updated = (axis, number) => rotation
          ? __localCameraWithRotation(value, {...vector, [axis]: number})
          : __localCameraWithPosition(value, {...vector, [axis]: number});
        return (0,i.jsx)(pl, {label: group.label, value: vector, suffix: rotation ? '\u00b0' : 'm',
          numberConfig: rotation ? pr : pt, reconciliationKey: owner,
          reconciliationChannel: group.id, reconciliationFrame,
          disabled: !!value.cameraLocked,
          keyframeActive: Object.fromEntries(group.channels.map(channel => [channel.axis, !!keyframeActive?.[channel.id]])),
          onToggleAllKeyframes: onToggleKeyframe ? () => onToggleKeyframe(group.channels.map(channel => channel.id)) : undefined,
          groupKeyframeTestId: 'director-stage-camera-group-keyframe-' + group.id,
          onPreviewChange: (axis, number, token) => onPreviewChange(updated(axis, number), token),
          onCancelPreview: (axis, token) => onCancelPreview(token),
          onChange: (axis, number, token) => onChange(updated(axis, number), 'director.scene-camera.' + group.id, token),
        }, group.id);
      }
      const channel = group.channels[0];
      return (0,i.jsx)(ps, {label: group.label, children: (0,i.jsx)(pc, {
        label: channel.label, value: value.fov, unit: '\u00b0', min: 15, max: 110,
        step: .1, fineStep: .01, coarseStep: 1, precision: 1,
        reconciliationKey: pn(owner, channel.id, reconciliationFrame),
        keyframeActive: keyframeActive?.[channel.id],
        onToggleKeyframe: onToggleKeyframe ? () => onToggleKeyframe([channel.id]) : undefined,
        onPreview: (number, token) => onPreviewChange({...value, fov: number}, token),
        onCommit: (number, token) => onChange({...value, fov: number}, 'director.scene-camera.fov', token),
        onCancelPreview,
      })}, group.id);
    })});
}

function __LocalCameraTransformPanel(props) {
  const {copy, value, reconciliationKey, reconciliationFrame, keyframeActive,
    onToggleKeyframe, onPreviewChange, onCancelPreview, onChange} = props;
  const transformChannels = ['position', 'rotation'].flatMap(group => ['x', 'y', 'z'].map(axis => group + '.' + axis));
  const transformKeyActive = transformChannels.every(channel => keyframeActive?.[channel]);
  return (0,i.jsxs)('div', {className: 'space-y-2', 'data-testid': 'director-stage-scene-camera-properties-camera', children: [
    (0,i.jsxs)('div', {className: 'flex h-9 items-center gap-2 border-b border-stroke/70 px-1', children: [
      (0,i.jsx)(cj.A, {size: 15, className: 'text-accent'}),
      (0,i.jsx)('span', {className: 'flex-1 text-[11px] font-medium text-content-secondary', children: copy.sceneCamera}),
      onToggleKeyframe && (0,i.jsx)('button', {
        type: 'button', 'aria-label': '\u76f8\u673a\u53d8\u6362\u5173\u952e\u5e27',
        title: '\u8bb0\u5f55\u5f53\u524d\u4f4d\u7f6e\u548c\u65cb\u8f6c', 'aria-pressed': transformKeyActive,
        'data-testid': 'director-stage-camera-transform-keyframe', disabled: !!value.cameraLocked,
        className: 'grid size-6 shrink-0 place-items-center rounded-md text-content-muted outline-none transition-colors hover:bg-surface-hover hover:text-content focus-visible:ring-2 focus-visible:ring-accent/40 disabled:opacity-40',
        onClick: () => onToggleKeyframe(transformChannels, true),
        children: (0,i.jsx)(fO.A, {size: 12, strokeWidth: 1.8, fill: transformKeyActive ? 'currentColor' : 'none', 'aria-hidden': true}),
      }),
    ]}),
    (0,i.jsx)(__LocalCameraTransformProperties, {
      labels: {position: copy.sceneCameraPosition, rotation: copy.rotation, lens: copy.sceneCameraLens, fov: copy.fov},
      value, reconciliationKey, reconciliationFrame, keyframeActive,
      onToggleKeyframe, onPreviewChange, onCancelPreview, onChange,
    }),
    (0,i.jsxs)('label', {className: 'block', children: [
      (0,i.jsx)('span', {className: 'mb-1.5 block text-[10px] text-content-muted', children: copy.aspectRatio}),
      (0,i.jsx)(md, {value: value.aspectRatio,
        onValueChange: aspectRatio => onChange({...value, aspectRatio}, 'director.scene-camera.aspect-ratio'),
        className: 'h-8 w-full rounded-[7px] border border-stroke bg-surface-raised px-2.5 text-[10px] text-content outline-none',
        label: copy.aspectRatio, options: s$(value.aspectRatio).map(option => ({value: option, label: option})),
      }),
    ]}),
  ]});
}
