const assert = require('node:assert/strict');

module.exports = function patchLocalMotionLibrary(factories) {
  let source = factories['53401'];
  assert.equal(typeof source, 'string', 'Missing director module 53401');
  assert(!source.includes('window.localDirectorMotionLibrary'), 'Local motion library patch is already installed');
  const changes = [];
  function replace(label, before, after) {
    const index = source.indexOf(before);
    assert(index >= 0, 'Motion library patch anchor missing: ' + label);
    assert.equal(source.indexOf(before, index + before.length), -1, 'Motion library patch anchor ambiguous: ' + label);
    source = source.slice(0, index) + after + source.slice(index + before.length);
    changes.push(label);
  }
  replace('motion library hydration port',
    'let r=null==(e=window.octoDesktop)?void 0:e.library;if(!r){n()&&(u.current=c,x(!0));return}',
    'let r=window.localDirectorMotionLibrary;if(!r){n()&&(u.current=c,x(!0));return}');
  replace('motion library cleanup port',
    'n&&(null==(a=window.octoDesktop)||a.library.endAccountOperation(n)),u.current===c',
    'n&&window.localDirectorMotionLibrary?.endAccountOperation(n),u.current===c');
  replace('motion library autosave port',
    'return null==(a=window.octoDesktop)?void 0:a.library.saveDraft(g5,"generation",e,void 0,t)',
    'return window.localDirectorMotionLibrary?.saveDraft(g5,"generation",e,void 0,t,{signal:r.signal})');
  replace('pause stale autosave during import',
    'if(d.current!==c)return;let t=m.current;if(!t)return;null==(e=p.current)||e.abort();',
    'if(d.current!==c||f.current)return;let t=m.current;if(!t)return;null==(e=p.current)||e.abort();');
  replace('pause autosave effect while preview is busy',
    'if(!b||u.current!==c)return;let e=window.setTimeout(()=>{var e;if(d.current!==c||f.current)return;',
    'if(!b||u.current!==c||O)return;let e=window.setTimeout(()=>{var e;if(d.current!==c||f.current)return;');
  replace('resume autosave after preview or import',
    'p.current)||t.abort()}},[b,o.saveFailed,h,c,s]);let V=',
    'p.current)||t.abort()}},[b,o.saveFailed,h,c,s,O]);let V=');
  replace('cancel preceding autosave before import',
    'if(e&&!N)return;let t=new AbortController;f.current=t,H(!0),G(void 0);',
    'if(e&&!N)return;p.current?.abort();let t=new AbortController;f.current=t,H(!0),G(void 0);');
  replace('motion library FBX export port',
    'let t=m.current,a=null==(e=window.octoDesktop)?void 0:e.directorStageFbx;if(!y||!t||!a||w)',
    'let t=m.current,a=window.localDirectorMotionLibrary?.fbx;if(!y||!t||!a||w)');
  replace('persist before import success',
    'if(await wR([...h,i],{signal:t.signal}),t.signal.aborted||d.current!==c)return;v(e=>[...e,{...i,name:g4(e,i.name)}])',
    'let localDraft=await wR([...h,i],{signal:t.signal});if(t.signal.aborted||d.current!==c)return;let localPort=window.localDirectorMotionLibrary,localLease=m.current;if(!localPort||!localLease)throw Error("DIRECTOR_STAGE_MOTION_SAVE_UNAVAILABLE");let localSaved=await localPort.saveDraft(g5,"generation",localDraft,void 0,localLease,{signal:t.signal});if(!localSaved.ok){s(o.saveFailed);return}if(t.signal.aborted||d.current!==c)return;v(e=>[...e,{...i,name:g4(e,i.name)}])');
  for (const id of [1656, 9513, 7278]) {
    replace('local worker ' + id,
      'new URL("/static-resource/ies/lvweb/octo_web/"+r.u(' + id + '),r.b)',
      'new URL(r.u(' + id + '),r.b)');
  }
  replace('local FBX preview model',
    'pK=`${pW}/${"characters/male-robot.fbx?rev=2".replace(/^\\/+/,"")}`',
    'pK="/assets/character.fbx"');
  replace('current picker import prop',
    'onPreviewStaticPose:b,onClearPreview:x,onChoose:y,onCreateCustomPose:A}=e,w=',
    'onPreviewStaticPose:b,onClearPreview:x,onChoose:y,onCreateCustomPose:A,onImportMotion:localImport}=e,w=');
  replace('connect picker to original import dialog',
    'savedMotions:i$,hydrated:i0,copy:Q,onOpenChange:mg,onQueryChange:eE,onResolveCatalogMotion:nv,previewCanvasSource:tx',
    'savedMotions:i$,hydrated:i0,copy:Q,onOpenChange:mg,onQueryChange:eE,onImportMotion:np,onResolveCatalogMotion:nv,previewCanvasSource:tx');
  replace('import entry in current picker mine tab',
    '(0,i.jsx)("div",{className:"px-5 pt-3",children:(0,i.jsxs)("label",{className:"flex h-10 items-center gap-2.5 rounded-[10px] border border-stroke bg-surface-raised px-3 text-content-muted transition-colors focus-within:border-stroke-strong focus-within:text-content-secondary",children:[(0,i.jsx)(cC.A,{size:15,strokeWidth:1.8}),(0,i.jsx)("input",{autoFocus:!0,type:"search","aria-label":p.motionLibrarySearch,value:s,onChange:e=>f(e.target.value),placeholder:p.motionLibrarySearch,className:"min-w-0 flex-1 bg-transparent text-[12px] text-content outline-none placeholder:text-content-muted"})]})})',
    '(0,i.jsxs)("div",{className:"flex items-center gap-2 px-5 pt-3",children:[(0,i.jsxs)("label",{className:"flex h-10 min-w-0 flex-1 items-center gap-2.5 rounded-[10px] border border-stroke bg-surface-raised px-3 text-content-muted transition-colors focus-within:border-stroke-strong focus-within:text-content-secondary",children:[(0,i.jsx)(cC.A,{size:15,strokeWidth:1.8}),(0,i.jsx)("input",{autoFocus:!0,type:"search","aria-label":p.motionLibrarySearch,value:s,onChange:e=>f(e.target.value),placeholder:p.motionLibrarySearch,className:"min-w-0 flex-1 bg-transparent text-[12px] text-content outline-none placeholder:text-content-muted"})]}),"mine"===j&&localImport&&(0,i.jsx)("span",{"data-testid":"director-stage-motion-picker-import",className:"shrink-0",children:(0,i.jsx)(d$,{copy:p,type:"motion",source:"mine",motionLibraryHydrated:m&&a&&!o,onImportMotion:e=>{if(k.current.open&&k.current.editable&&!k.current.applying){W(),g(!1),localImport(e)}}})})]})');
  factories['53401'] = source;
  return { moduleId: '53401', changes };
};
