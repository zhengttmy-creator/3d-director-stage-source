const PRESETS = [
  ['#e6e8eb', '\u74f7\u767d', 'Porcelain'],
  ['#9aa2ad', '\u77f3\u7070', 'Stone'],
  ['#eb6b70', '\u73ca\u745a\u7ea2', 'Coral'],
  ['#e7b55b', '\u91d1\u9ec4', 'Gold'],
  ['#69b98d', '\u7fe0\u7eff', 'Jade'],
  ['#61a8eb', '\u5929\u84dd', 'Sky'],
  ['#ae87dd', '\u7d2b\u7f57\u5170', 'Violet'],
  ['#343941', '\u77f3\u58a8', 'Graphite'],
];

function colorPanel(e) {
  const { copy, value, mixed, hasOverride, onChange, onReset, disabled = false } = e;
  const english = copy.color === 'Color';
  const label = english ? 'Model Color' : '\u6a21\u578b\u989c\u8272';
  const presetsLabel = english ? 'Color Presets' : '\u9884\u8bbe\u989c\u8272';
  const current = mixed ? '' : value ?? '';
  const [draft, setDraft] = n.useState(current);
  n.useEffect(() => { setDraft(current); }, [current]);
  const commit = input => {
    if (disabled) return;
    const next = tk(input);
    if (!next) return setDraft(current);
    setDraft(next);
    if (next !== value || mixed) onChange(next);
  };
  const presets = __LOCAL_DIRECTOR_COLOR_PRESETS__;
  return i.jsxs('div', {
    'data-testid': 'director-stage-model-color',
    className: 'mt-3 border-t border-stroke/70 pt-3',
    children: [
      i.jsxs('div', {
        className: 'flex h-8 items-center gap-2',
        children: [
          i.jsx('span', { className: 'min-w-0 flex-1 truncate text-[10px] text-content-muted', children: label }),
          i.jsx('label', {
            className: 'relative grid size-6 shrink-0 cursor-pointer place-items-center overflow-hidden rounded-[6px] border border-stroke shadow-inner',
            style: { background: value && !mixed ? value : '#9aa2ad', opacity: disabled ? 0.45 : 1 },
            children: i.jsx('input', {
              type: 'color', 'aria-label': label, 'data-testid': 'director-stage-model-color-picker',
              value: value ?? '#9aa2ad', disabled,
              onChange: event => commit(event.target.value),
              className: 'absolute inset-0 size-full cursor-pointer opacity-0',
            }),
          }),
          i.jsx('input', {
            type: 'text', value: draft, maxLength: 7, spellCheck: false, disabled,
            placeholder: mixed ? copy.mixedColors : copy.originalColor,
            'aria-label': label + ' HEX', 'data-testid': 'director-stage-model-color-hex',
            onChange: event => {
              setDraft(event.target.value);
              if (tk(event.target.value)) commit(event.target.value);
            },
            onBlur: event => commit(event.target.value),
            onKeyDown: event => {
              if (event.key === 'Enter') commit(event.currentTarget.value);
              if (event.key === 'Escape') setDraft(current);
            },
            className: 'h-8 w-[86px] min-w-0 rounded-[7px] border border-transparent bg-surface-raised/75 px-2 font-mono text-[10px] uppercase text-content outline-none transition-[border-color,background-color,box-shadow] placeholder:font-sans placeholder:text-content-faint hover:border-stroke hover:bg-surface-hover/70 focus:border-accent/55 focus:bg-surface focus:ring-2 focus:ring-accent/10',
          }),
          i.jsx('button', {
            type: 'button', disabled: disabled || !hasOverride,
            title: copy.restoreOriginalColor, 'aria-label': copy.restoreOriginalColor,
            'data-testid': 'director-stage-model-color-reset', onClick: onReset,
            className: 'grid size-8 shrink-0 place-items-center rounded-[7px] text-content-muted outline-none transition-colors hover:bg-surface-hover hover:text-content-secondary focus-visible:ring-2 focus-visible:ring-accent/30 disabled:cursor-not-allowed disabled:opacity-25',
            children: i.jsx(uK.A, { size: 14 }),
          }),
        ],
      }),
      i.jsx('div', {
        role: 'group', 'aria-label': presetsLabel,
        style: { display: 'grid', gridTemplateColumns: 'repeat(8,minmax(0,1fr))', gap: 6, marginTop: 8 },
        children: presets.map(([hex, chinese, name]) => {
          const selected = !mixed && value?.toLowerCase() === hex;
          const title = (english ? name : chinese) + ' ' + hex.toUpperCase();
          return i.jsx('button', {
            type: 'button', disabled, title, 'aria-label': title, 'aria-pressed': selected,
            'data-testid': 'director-stage-model-color-' + hex.slice(1),
            onClick: () => commit(hex),
            className: 'focus-visible:ring-2 focus-visible:ring-accent/30',
            style: {
              display: 'grid', placeItems: 'center', height: 26, minWidth: 0, padding: 2,
              borderRadius: 5, border: selected ? '1px solid currentColor' : '1px solid transparent',
              background: 'transparent', opacity: disabled ? 0.4 : 1, cursor: disabled ? 'default' : 'pointer',
            },
            children: i.jsx('span', {
              'aria-hidden': true,
              style: { display: 'block', width: 18, height: 18, borderRadius: 4, background: hex, boxShadow: 'inset 0 0 0 1px #ffffff26' },
            }),
          }, hex);
        }),
      }),
    ],
  });
}

function replaceOnce(source, previous, next, label) {
  const position = source.indexOf(previous);
  if (position < 0 || source.indexOf(previous, position + 1) !== -1) {
    throw new Error('Model color patch: expected one ' + label);
  }
  return source.slice(0, position) + next + source.slice(position + previous.length);
}

module.exports = function patchModelColors(factories) {
  let source = factories[53401];
  if (typeof source !== 'string') throw new Error('Model color patch: missing factory 53401');
  if (source.includes('director-stage-model-color-hex')) return { patched: false, presets: PRESETS.length };
  const start = source.indexOf('function pC(e){');
  const end = source.indexOf('function pI(e){', start);
  if (start < 0 || end <= start || source.indexOf('function pC(e){', start + 1) !== -1) {
    throw new Error('Model color patch: panel boundary changed');
  }
  const panel = colorPanel.toString()
    .replace('function colorPanel(e)', 'function pC(e)')
    .replace('__LOCAL_DIRECTOR_COLOR_PRESETS__', JSON.stringify(PRESETS));
  source = source.slice(0, start) + panel + source.slice(end);
  source = replaceOnce(source,
    'et.length>0?(0,i.jsx)(pC,{copy:f,value:ei,mixed:ea,hasOverride:en,onChange:ef,onReset:()=>ef()}):null',
    'et.length>0?(0,i.jsx)(pC,{copy:f,value:ei,mixed:ea,hasOverride:en,disabled:!W.some(e=>"model"===e.kind),onChange:ef,onReset:()=>ef()}):null',
    'color panel call');
  source = replaceOnce(source,
    'ef=e=>{if(0===et.length)return;let t=new Set(et.map(e=>e.id));L(',
    'ef=e=>{let t=new Set(et.filter(e=>!e.locked).map(e=>e.id));if(!t.size)return;L(',
    'color update callback');
  factories[53401] = source;
  return { patched: true, presets: PRESETS.length };
};

module.exports.presets = PRESETS;
