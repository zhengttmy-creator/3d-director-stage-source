const assert = require('node:assert/strict');

module.exports = function patchCurveEasing(factories) {
  let source = factories['53401'];
  const replace = (label, before, after) => {
    assert.equal(source.split(before).length, 2, 'Curve easing patch anchor changed: ' + label);
    source = source.replace(before, after);
  };
  replace('select portal props',
    '...e,layer:"fullscreen",theme:"dark",contentProps:{"data-director-stage-portal-layer":!0}',
    '...e,layer:"fullscreen",theme:"dark",contentProps:{...e.contentProps,"data-director-stage-portal-layer":!0}');
  replace('curve preset menu owner',
    '(0,i.jsx)(md,{value:P,onValueChange:e=>{if("custom"!==e)',
    '(0,i.jsx)(md,{value:P,contentProps:{"data-director-stage-curve-preset-menu":"true"},onValueChange:e=>{if("custom"!==e)');
  // The preset menu is portaled outside the curve panel, but belongs to it.
  replace('curve outside pointer guard',
    '!(a instanceof Node)||(null==(t=y.current)?void 0:t.contains(a))||r.contains(a)||x()',
    '!(a instanceof Node)||(null==(t=y.current)?void 0:t.contains(a))||r.contains(a)||(a instanceof Element&&a.closest(\'[data-director-stage-curve-preset-menu="true"]\'))||x()');
  factories['53401'] = source;
};
