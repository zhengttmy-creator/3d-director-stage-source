const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

module.exports = function patchMotionPreviews(factories) {
  let source = factories['53401'];
  assert.equal(typeof source, 'string', 'Missing director module 53401');
  assert(source.includes('const __localDirectorMotionCache'), 'Motion loader must be patched before previews');
  assert(!source.includes('class __LocalMotionPreviewService'), 'Motion previews are already installed');
  const helper = fs.readFileSync(path.join(__dirname, 'motion-previews-runtime.js'), 'utf8');
  const original = 'children:(t=e,o?(0,i.jsx)(dn.A,{size:22,className:"animate-spin text-accent","aria-hidden":"true"}):t.thumbnailPath?(0,i.jsx)("img",{crossOrigin:"anonymous",src:t.thumbnailPath,alt:"",draggable:!1,className:"size-full object-contain p-1"}):(0,i.jsx)(pR.A,{size:24,strokeWidth:1.6}))';
  assert.equal(source.split(original).length, 2, 'Expected one motion picker thumbnail renderer');
  source = source.replace(original, 'children:(0,i.jsx)(__LocalMotionPreviewCard,{entry:e,target:d,savedMotions:u,resolve:h})');
  assert.equal(source.split('function p4(e){').length, 2, 'Expected one motion picker function');
  factories['53401'] = source.replace('function p4(e){', helper + '\nfunction p4(e){');
  return {moduleId: '53401', changes: ['shared renderer for real motion card previews', 'visible posters and hover or focus playback']};
};
