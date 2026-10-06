const assert = require('node:assert/strict');

module.exports = function disableSceneDrafts(factories) {
  let source = factories['53401'];
  const replace = (label, before, after) => {
    assert.equal(source.split(before).length, 2, 'Scene draft patch anchor changed: ' + label);
    source = source.replace(before, after);
  };

  // Saved projects remain authoritative; do not read, overwrite, or delete old browser drafts.
  replace('initial loading', '[k,S]=(0,n.useState)(a),[P,j]=(0,n.useState)(null)',
    '[k,S]=(0,n.useState)(!1),[P,j]=(0,n.useState)(null)');
  replace('recovery read', ',(0,n.useEffect)(()=>{let e;if(!a)return void S(!1);let t=new AbortController;return S(!0),(e={signal:t.signal,canWrite:()=>R.current},k4.read(u,e)).then(e=>{if(t.signal.aborted||!R.current)return;e.ok||T.current(d.current("directorStage.save.localReadFailed"));let r=e.ok?e.draft:null;j(r&&b.current===h&&kG(r.project)!==h?r:null),S(!1)}),()=>t.abort()},[a,u,h])', '');
  replace('draft persistence', 'D=(0,n.useCallback)(async()=>{let e,t;if(!R.current)return!1;let r=C.current.signal,a=await (e=N()?{kind:"director-stage-local-draft",project:g.current,baseVersionId:x.current}:null,t={signal:r,canWrite:()=>R.current},k4.write(u,e,t));return!r.aborted&&!!R.current&&(a||I.current||T.current(c("directorStage.save.localFailed")),I.current=!a,a)},[u,N,c])',
    'D=(0,n.useCallback)(async()=>!1,[])');
  replace('draft discard', 'G=(0,n.useCallback)(async()=>{let e;if(!R.current)return!1;let t=C.current.signal,r=await (e={signal:t,canWrite:()=>R.current},k4.write(u,null,e));return!t.aborted&&!!R.current&&(r?j(null):T.current(c("directorStage.save.localFailed")),r)},[u,c])',
    'G=(0,n.useCallback)(async()=>{if(!R.current)return!1;j(null);return!0},[])');
  replace('automatic draft timer', ',z.current=e,null===F.current&&(F.current=window.setTimeout(()=>{F.current=null;let e=z.current;z.current=null,e&&R.current&&L.current()},500))', '');
  replace('close without saving', 'onKeep:()=>{V("keep")}',
    'onKeep:()=>{G("discard_unsaved"),U()}');
  replace('close button label', 'p?"directorStage.save.useCloud":"directorStage.save.keepLocal"',
    'p?"directorStage.save.useCloud":"directorStage.save.discardChanges"');
  replace('close description', '"directorStage.save.closeDescription":"You have unsaved changes. Local drafts are only available in this browser. Save to the cloud to access your changes on other devices."',
    '"directorStage.save.closeDescription":"You have unsaved changes. Save before closing to keep them."');
  replace('close label fallback', '"directorStage.save.keepLocal":"Keep local draft and close"',
    '"directorStage.save.discardChanges":"Close without saving"');

  factories['53401'] = source;
};
