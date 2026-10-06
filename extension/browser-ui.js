(() => {
  const extension = window.localDirectorExtension = {...window.localDirectorExtension};
  const React = directorRequire(87429);
  const ReactDOM = directorRequire(82530);
  const h = React.createElement;
  const Folder = directorRequire(675).A;
  const Close = directorRequire(49746).A;
  const Refresh = directorRequire(2626).A;
  Object.assign(window.directorLocale, {
    octo_director_stage_close: '关闭预演台',
    octo_director_stage_gallery_add_to_canvas: '下载所选照片',
    octo_director_stage_gallery_add_to_canvas_failed: '无法下载照片，请重试。',
    octo_director_stage_notice_captures_added: '已下载 {count} 张照片',
    octo_director_stage_notice_repeat_capture_warning: '所选照片已下载',
    octo_director_stage_video_export_add_to_canvas: '保存到素材库',
    octo_director_stage_video_export_add_to_canvas_failed: '无法保存到素材库，请重试。',
    octo_director_stage_video_export_adding_to_canvas: '正在保存…',
    octo_director_stage_assets_canvas_images: '本地照片',
    octo_director_stage_assets_background_search: '搜索本地照片',
    octo_director_stage_assets_empty_background: '暂无背景图片',
    octo_director_stage_assets_no_canvas_images: '暂无本地照片',
  });
  extension.download = (url, name) => {
    const link = document.createElement('a');
    link.href = url;
    link.download = String(name || 'export').replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_');
    link.click();
  };
  extension.AssetLibrary = function AssetLibrary({snapshot, refresh}) {
    const [targets, setTargets] = React.useState({});
    const [open, setOpen] = React.useState(false);
    const [busy, setBusy] = React.useState(false);
    const [notice, setNotice] = React.useState('');
    const dialog = React.useRef(null);
    const folderInput = React.useRef(null);
    const backupInput = React.useRef(null);
    React.useEffect(() => {
      const locate = () => {
        const anchor = document.querySelector('[data-local-asset-heading]');
        const shell = document.querySelector('[data-testid="director-stage-shell"]');
        setTargets(previous => previous.anchor === anchor && previous.shell === shell ? previous : {anchor, shell});
      };
      locate();
      const observer = new MutationObserver(locate);
      observer.observe(document.body, {childList: true, subtree: true});
      return () => observer.disconnect();
    }, []);
    React.useEffect(() => {if (open && dialog.current && !dialog.current.open) dialog.current.showModal();}, [open, targets.shell]);
    async function run(action) {
      setBusy(true); setNotice('');
      try {await action();} catch (error) {setNotice(error.message || '操作失败');}
      finally {setBusy(false);}
    }
    const savePending = () => !!document.querySelector('[data-testid="director-stage-save-control"] button:not([disabled])');
    return h(React.Fragment, null,
      targets.anchor && ReactDOM.createPortal(h('button', {type: 'button', className: 'local-assets-trigger',
        title: '本地资产与备份', 'aria-label': '本地资产与备份', onClick: () => {setNotice(''); setOpen(true);}}, h(Folder, {size: 15})), targets.anchor),
      open && targets.shell && ReactDOM.createPortal(h('dialog', {ref: dialog, className: 'local-assets-dialog',
        'aria-labelledby': 'extension-assets-title', onCancel: event => {if (busy) event.preventDefault(); else setOpen(false);}, onClose: () => setOpen(false)},
        h('header', null, h('h2', {id: 'extension-assets-title'}, h(Folder, {size: 19}), '本地资产与备份'),
          h('button', {type: 'button', className: 'local-assets-icon', disabled: busy, title: '关闭', 'aria-label': '关闭本地资产', onClick: () => setOpen(false)}, h(Close, {size: 18}))),
        h('div', {className: 'local-assets-content'},
          h('div', {className: 'local-assets-table'},
            ...[['characters', '人物', 'FBX · Mixamo'], ['models', '模型', 'FBX / GLB / GLTF'], ['motions', '动作', 'FBX / motion.json'], ['poses', '姿势', 'octomotion.json']].map(([key, name, format]) =>
              h('div', {key, className: 'local-assets-row'}, h('div', null, h('strong', null, name), h('code', null, key)),
                h('span', {className: 'local-assets-format'}, format), h('span', {className: 'local-assets-count'}, snapshot[key].length)))),
          snapshot.issues.length > 0 && h('details', {className: 'local-assets-issues'}, h('summary', null, snapshot.issues.length + ' 个文件未载入'),
            ...snapshot.issues.map((issue, index) => h('p', {key: index}, h('code', null, issue.relativePath || ''), h('span', null, issue.message || issue.reason)))),
          h('p', {className: 'local-assets-status', role: 'status'}, busy ? '正在处理…' : notice || '已保存于此浏览器'),
          h('input', {type: 'file', ref: folderInput, hidden: true, multiple: true, webkitdirectory: '', onChange: event => {
            const files = [...event.target.files]; event.target.value = ''; if (!files.length) return;
            run(async () => {await extension.importAssetFiles(files); await refresh(); setNotice('资产已导入');});
          }}),
          h('input', {type: 'file', ref: backupInput, hidden: true, accept: '.json,.qihui.json', onChange: event => {
            const file = event.target.files[0]; event.target.value = ''; if (!file) return;
            run(async () => {
              if (savePending()) throw new Error('请先保存当前项目，再恢复备份。');
              if (!confirm('恢复备份将替换此浏览器中的项目、导入资产和动作库。是否继续？')) return;
              await extension.importBackup(file); location.reload();
            });
          }})),
        h('footer', {style: {flexWrap: 'wrap'}},
          h('button', {type: 'button', disabled: busy, onClick: () => run(async () => {await refresh(); setNotice('已刷新');})}, h(Refresh, {size: 16}), '刷新'),
          h('button', {type: 'button', disabled: busy, onClick: () => run(async () => {
            if (savePending()) throw new Error('请先保存当前项目，再导出备份。');
            const blob = await extension.exportBackup(); const url = URL.createObjectURL(blob);
            extension.download(url, '绮绘预演台-' + new Date().toISOString().slice(0, 10) + '.qihui.json');
            setTimeout(() => URL.revokeObjectURL(url), 60000); setNotice('备份已导出');
          })}, '导出备份'),
          h('button', {type: 'button', disabled: busy, onClick: () => backupInput.current.click()}, '恢复备份'),
          h('button', {type: 'button', className: 'local-assets-primary', disabled: busy, onClick: () => folderInput.current.click()}, h(Folder, {size: 16}), '导入资产文件夹'))), targets.shell));
  };
})();
