(async () => {
  Object.assign(window.directorLocale, {
    octo_director_stage_workspace_title: '绮绘预演台V1.0',
    octo_director_stage_assets_background_search: '搜索背景图片',
    octo_director_stage_save_close_description: '当前修改尚未保存，保存后关闭可保留这些修改。',
    octo_director_stage_save_discard_changes: '不保存并关闭',
  });
  const React = directorRequire(87429);
  const ReactDOM = directorRequire(82530);
  const Editor = directorRequire(53401).DirectorStageShellWorkspaceDialog;
  const CatalogProvider = directorRequire(51687).lu;
  const DocumentProvider = directorRequire(24206).D;
  const ToastProvider = directorRequire(39243).yq;
  const CaptureProvider = directorRequire(36166).Wd;
  const h = React.createElement;
  const empty = async () => ({ items: [], hasMore: false, nextOffset: 0 });
  const characterManifest = fetch('/assets/characters/manifest.json').then(async response => {
    if (!response.ok) throw new Error('读取内置人物库失败');
    const manifest = await response.json();
    if (manifest.format !== 'local-director-character-catalog' || manifest.version !== 1 || !Array.isArray(manifest.characters)) throw new Error('内置人物目录无效');
    return manifest.characters;
  });
  characterManifest.catch(error => console.error(error));
  const motionManifest = Promise.all([
    fetch('/assets/motions/manifest.json').then(async response => {
      if (!response.ok) throw new Error('读取本地动作库失败');
      const manifest = await response.json();
      if (!Array.isArray(manifest.motions)) throw new Error('本地动作目录无效');
      const variants = Array.isArray(manifest.pathTraversalVariants) ? manifest.pathTraversalVariants : [];
      return [...manifest.motions, ...variants].map(item => ({ ...item,
        description: item.displayName + ' · ' + item.durationSec.toFixed(2) + ' 秒',
      }));
    }),
    fetch('/assets/poses/manifest.json').then(async response => {
      if (!response.ok) throw new Error('读取本地姿势库失败');
      const manifest = await response.json();
      if (manifest.format !== 'local-director-pose-catalog' || manifest.version !== 1 || !Array.isArray(manifest.poses)) throw new Error('本地姿势目录无效');
      return manifest.poses.map(item => ({ ...item, localPosePreset: true, motionUsage: 'direct',
        description: item.displayName + ' · 静态姿势',
      }));
    }),
  ]).then(groups => groups.flat());
  // Attach the rejection handler immediately; the picker reports failures on demand.
  motionManifest.catch(error => console.error(error));
  let folderSnapshot = {revision: '', characters: [], models: [], motions: [], poses: [], issues: [], directories: {}};
  const folderListeners = new Set();
  let scanPending;
  async function scanFolders(refresh = false) {
    if (scanPending) {
      await scanPending;
      if (!refresh) return folderSnapshot;
    }
    const pending = (async () => {
      const response = await fetch(refresh ? '/api/assets/refresh' : '/api/assets/catalog', {method: refresh ? 'POST' : 'GET'});
      if (!response.ok) throw new Error('读取资产文件夹失败');
      const next = await response.json();
      if (!['characters', 'models', 'motions', 'poses', 'issues'].every(key => Array.isArray(next[key]))) throw new Error('资产目录无效');
      if (next.revision !== folderSnapshot.revision || next.root !== folderSnapshot.root) {
        folderSnapshot = next;
        for (const listener of folderListeners) listener(next);
      }
      return folderSnapshot;
    })();
    scanPending = pending;
    try { return await pending; }
    finally { if (scanPending === pending) scanPending = undefined; }
  }
  await scanFolders().catch(error => console.error(error));
  const folderMotionEntries = () => [...folderSnapshot.motions, ...folderSnapshot.poses].map(item => ({...item,
    description: item.localPosePreset ? '本地姿势 · ' + item.relativePath : '本地动作 · ' + item.relativePath,
    descriptionFallback: item.relativePath,
  }));
  const catalog = {
    listCharacterModels: async ({count = 100, offset = 0} = {}, signal) => {
      signal?.throwIfAborted();
      const entries = [...await characterManifest,
        ...folderSnapshot.characters.map(item => ({...item, localAssetKind: 'character', description: item.relativePath, descriptionFallback: item.relativePath})),
        ...folderSnapshot.models.map(item => ({...item, localAssetKind: 'model', description: item.relativePath, descriptionFallback: item.relativePath}))];
      signal?.throwIfAborted();
      const items = entries.slice(offset, offset + count);
      return {items, hasMore: offset + items.length < entries.length, nextOffset: offset + items.length};
    },
    resolveCharacterModel: async ({ assetId }, signal) => {
      signal?.throwIfAborted();
      if (assetId === 'local-character') return {assetId, mediaUrl: location.origin + '/assets/character.fbx', extension: '.fbx', localAssetKind: 'character', expiresAtMs: Date.now() + 86400000};
      const preset = (await characterManifest).find(entry => entry.assetId === assetId);
      signal?.throwIfAborted();
      if (preset) return {...preset, mediaUrl: location.origin + preset.mediaUrl, expiresAtMs: Date.now() + 86400000};
      const item = [...folderSnapshot.characters, ...folderSnapshot.models].find(entry => entry.assetId === assetId);
      if (!item) throw new Error('本地模型文件已移走，请放回原资产文件夹');
      return {...item, mediaUrl: location.origin + item.mediaUrl, localAssetKind: item.relativePath.startsWith('characters/') ? 'character' : 'model', expiresAtMs: Date.now() + 86400000};
    },
    listCharacterMotions: async ({ count = 100, offset = 0 }, signal) => {
      signal?.throwIfAborted();
      const entries = [...await motionManifest, ...folderMotionEntries()];
      signal?.throwIfAborted();
      const items = entries.slice(offset, offset + count);
      return { items, hasMore: offset + items.length < entries.length, nextOffset: offset + items.length };
    },
    resolveCharacterMotion: async ({ assetId }, signal) => {
      signal?.throwIfAborted();
      const item = [...await motionManifest, ...folderMotionEntries()].find(entry => entry.assetId === assetId);
      signal?.throwIfAborted();
      if (!item || !(/^(\/assets\/(motions|poses)\/|\/local-assets\/(motions|poses)\/)/.test(item.mediaUrl))) throw new Error('本地未安装此动作或姿势');
      return { ...item, assetId, mediaUrl: location.origin + item.mediaUrl, extension: item.extension || '.motion.json', expiresAtMs: Date.now() + 86400000 };
    },
    listImages: empty,
    resolveImages: async () => [],
    invalidateResolvedCatalogAsset: () => {},
  };
  Object.assign(catalog, window.localDirectorCaptures.catalog);
  window.localDirectorAssetCatalog = {getSnapshot: () => folderSnapshot, refresh: () => scanFolders(true)};
  let persistedVersion;
  const documents = {
    async load(request, signal) {
      const response = await fetch('/api/document?version=' + encodeURIComponent(request.versionId), { signal });
      if (!response.ok) throw new Error('读取本地项目失败');
      return new Uint8Array(await response.arrayBuffer());
    },
    async save(request, signal) {
      const response = await fetch('/api/document', { method: 'PUT', headers: { 'Content-Type': 'application/octet-stream', 'If-Match': persistedVersion || '0', 'X-Write-Id': request.writeId }, body: request.content, signal });
      if (!response.ok) throw new Error('保存本地项目失败');
      const result = await response.json();
      persistedVersion = result.versionId;
      return result;
    },
  };
  const info = await fetch('/api/info').then(response => response.json());
  persistedVersion = info.versionId;
  const readContext = { source: 'ordinary' };
  async function readCzSession() {
    const response = await fetch('/api/cz/session');
    if (!response.ok) throw new Error('读取绮绘画布连接状态失败');
    return response.json();
  }
  async function loginCzSession(payload) {
    const response = await fetch('/api/cz/session', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!response.ok) throw new Error((await response.text()) || '登录绮绘画布失败');
    return response.json();
  }
  function StartupCanvasConnection({ onResolve }) {
    const [status, setStatus] = React.useState(null);
    const [mode, setMode] = React.useState('choice');
    const [baseUrl, setBaseUrl] = React.useState('https://czqihui.itheima.net');
    const [username, setUsername] = React.useState('');
    const [password, setPassword] = React.useState('');
    const [busy, setBusy] = React.useState(false);
    const [error, setError] = React.useState('');
    React.useEffect(() => {
      let cancelled = false;
      readCzSession().then(result => {
        if (cancelled) return;
        setStatus(result);
        if (result.baseUrl) setBaseUrl(result.baseUrl);
      }).catch(sessionError => {
        if (!cancelled) setError(sessionError.message);
      });
      return () => { cancelled = true; };
    }, []);
    async function submit(event) {
      event.preventDefault();
      setBusy(true);
      setError('');
      try {
        const result = await loginCzSession({ baseUrl, username, password });
        onResolve({ connected: true, ...result });
      } catch (loginError) {
        setError(loginError.message || '登录绮绘画布失败，请检查账号密码。');
      } finally {
        setBusy(false);
      }
    }
    const skip = () => onResolve({ connected: false });
    const title = mode === 'login' ? '登录并连接绮绘画布' : '是否连接绮绘画布？';
    return h('main', { className: 'startup-canvas-gate', 'aria-labelledby': 'startup-canvas-title' },
      h('section', { className: 'startup-canvas-card' },
        h('div', { className: 'startup-canvas-mark', 'aria-hidden': 'true' }, h('span', null)),
        h('div', { className: 'startup-canvas-copy' },
          h('h1', { id: 'startup-canvas-title' }, title),
          mode === 'login'
            ? h('p', null, '连接后，导出的截图和视频可以直接上传到所选绮绘项目的自由画布。账号密码只保存在本次本地服务进程内。')
            : h('p', null, '如果这次要把绮绘预演台导出的素材同步到绮绘画布，请先连接；也可以跳过，继续只在本地编辑。')
        ),
        mode === 'choice'
          ? h('div', { className: 'startup-canvas-actions' },
              h('button', { type: 'button', className: 'startup-secondary', onClick: skip }, '暂不连接，直接进入'),
              h('button', { type: 'button', className: 'startup-primary', onClick: () => { setMode('login'); setError(''); } }, status?.connected ? '重新连接绮绘画布' : '连接绮绘画布')
            )
          : h('form', { className: 'startup-canvas-form', onSubmit: submit },
              h('label', null,
                h('span', null, '绮绘画布地址'),
                h('input', { value: baseUrl, onChange: event => setBaseUrl(event.target.value), placeholder: 'https://czqihui.itheima.net', inputMode: 'url', autoComplete: 'url', disabled: busy })
              ),
              h('label', null,
                h('span', null, '用户名'),
                h('input', { value: username, onChange: event => setUsername(event.target.value), placeholder: '请输入用户名', autoComplete: 'off', name: 'qihui-canvas-username', disabled: busy, autoFocus: true })
              ),
              h('label', null,
                h('span', null, '密码'),
                h('input', { value: password, onChange: event => setPassword(event.target.value), placeholder: '请输入密码', type: 'password', autoComplete: 'current-password', disabled: busy })
              ),
              error ? h('p', { className: 'startup-canvas-error', role: 'alert' }, error) : null,
              h('div', { className: 'startup-canvas-actions' },
                h('button', { type: 'button', className: 'startup-secondary', onClick: () => setMode('choice'), disabled: busy }, '返回'),
                h('button', { type: 'button', className: 'startup-secondary', onClick: skip, disabled: busy }, '跳过'),
                h('button', { type: 'submit', className: 'startup-primary', disabled: busy || !username.trim() || !password }, busy ? '正在登录…' : '登录并进入')
              )
            )
      )
    );
  }
  function CompactPanels() {
    const [target, setTarget] = React.useState(null);
    const [panel, setPanel] = React.useState('scene');
    React.useEffect(() => {
      const observer = new MutationObserver(() => setTarget(document.querySelector('[data-testid="director-stage-shell"]')));
      observer.observe(document.body, { childList: true, subtree: true });
      return () => observer.disconnect();
    }, []);
    React.useEffect(() => { if (target) target.dataset.localPanel = panel; }, [target, panel]);
    function choosePanel(value) {
      if (value === 'assets' && !target.querySelector('[data-testid="director-stage-asset-panel"]')) target.querySelector('button[aria-label="资产"]')?.click();
      setPanel(value);
    }
    return target ? ReactDOM.createPortal(h('nav', { className: 'local-panel-tabs', 'aria-label': '工作区面板' },
      ...[['scene', '场景'], ['assets', '资产'], ['properties', '属性']].map(([value, label]) => h('button', { key: value, type: 'button', 'aria-pressed': value === panel, onClick: () => choosePanel(value) }, label))), target) : null;
  }
  const FolderIcon = directorRequire(675).A;
  const RefreshIcon = directorRequire(2626).A;
  const CloseIcon = directorRequire(49746).A;
  const CopyIcon = directorRequire(90261).A;
  function AssetFolders({snapshot, refresh}) {
    const [anchor, setAnchor] = React.useState(null);
    const [shell, setShell] = React.useState(null);
    const [open, setOpen] = React.useState(false);
    const [busy, setBusy] = React.useState(false);
    const [notice, setNotice] = React.useState('');
    const dialog = React.useRef(null);
    React.useEffect(() => {
      const locate = () => {
        setAnchor(document.querySelector('[data-local-asset-heading]'));
        setShell(document.querySelector('[data-testid="director-stage-shell"]'));
      };
      locate();
      const observer = new MutationObserver(locate);
      observer.observe(document.body, {childList: true, subtree: true});
      return () => observer.disconnect();
    }, []);
    React.useEffect(() => {
      const element = dialog.current;
      if (!open || !element) return;
      const trigger = document.activeElement;
      if (!element.open) element.showModal();
      element.querySelector('button')?.focus();
      const closeWithEscape = event => {
        if (event.key !== 'Escape') return;
        event.preventDefault();
        event.stopImmediatePropagation();
        setOpen(false);
      };
      // The outer editor also listens for Escape on the document.
      window.addEventListener('keydown', closeWithEscape, true);
      return () => {
        window.removeEventListener('keydown', closeWithEscape, true);
        if (element.open) element.close();
        requestAnimationFrame(() => { if (trigger?.isConnected) trigger.focus({preventScroll: true}); });
      };
    }, [open, shell]);
    async function run(action) {
      setBusy(true); setNotice('');
      try { await action(); }
      catch (error) { setNotice(error.message); }
      finally { setBusy(false); }
    }
    const total = ['characters', 'models', 'motions', 'poses'].reduce((sum, key) => sum + snapshot[key].length, 0);
    return h(React.Fragment, null,
      anchor && ReactDOM.createPortal(h('button', {type: 'button', className: 'local-assets-trigger', title: '本地资产文件夹', 'aria-label': '本地资产文件夹', onClick: () => {setNotice(''); setOpen(true);}}, h(FolderIcon, {size: 15})), anchor),
      open && shell && ReactDOM.createPortal(h('dialog', {ref: dialog, className: 'local-assets-dialog', 'aria-labelledby': 'local-assets-title', 'data-ui-menu-overlay': 'true',
        onKeyDownCapture: event => {
          event.stopPropagation();
          if (event.key === 'Escape') { event.preventDefault(); setOpen(false); }
        }, onCancel: () => setOpen(false), onClose: () => setOpen(false)},
        h('header', null, h('h2', {id: 'local-assets-title'}, h(FolderIcon, {size: 19}), '本地资产'),
          h('button', {type: 'button', className: 'local-assets-icon', title: '关闭', 'aria-label': '关闭本地资产', onClick: () => setOpen(false)}, h(CloseIcon, {size: 18}))),
        h('div', {className: 'local-assets-content'},
          h('label', {htmlFor: 'local-assets-root'}, '资产目录'),
          h('div', {className: 'local-assets-path'}, h('input', {id: 'local-assets-root', readOnly: true, value: snapshot.root || '', 'aria-label': '资产目录'}),
            h('button', {type: 'button', className: 'local-assets-icon', title: '复制路径', 'aria-label': '复制资产目录', onClick: () => run(async () => {await navigator.clipboard.writeText(snapshot.root); setNotice('路径已复制');})}, h(CopyIcon, {size: 16}))),
          h('div', {className: 'local-assets-table'},
            ...[['characters', '人物', 'FBX · Mixamo 骨架'], ['models', '模型', 'FBX / GLB / GLTF'], ['motions', '动作', 'FBX / .motion.json'], ['poses', '姿势', '.motion.json / .octomotion.json']].map(([key, name, formats]) =>
              h('div', {key, className: 'local-assets-row'}, h('div', null, h('strong', null, name), h('code', null, key)), h('span', {className: 'local-assets-format'}, formats), h('span', {className: 'local-assets-count', 'aria-label': name + '数量'}, snapshot[key].length)))),
          snapshot.issues.length > 0 && h('details', {className: 'local-assets-issues'}, h('summary', null, snapshot.issues.length + ' 个文件未载入'),
            ...snapshot.issues.slice(0, 100).map((issue, index) => h('p', {key: index}, h('code', null, issue.relativePath || issue.path || ''), h('span', null, issue.message || issue.reason)))),
          h('p', {className: 'local-assets-status', role: 'status'}, busy ? '正在处理…' : notice || '已发现 ' + total + ' 项本地资产')),
        h('footer', null,
          h('button', {type: 'button', disabled: busy, onClick: () => run(async () => {await refresh(); setNotice('资产目录已刷新');})}, h(RefreshIcon, {size: 16}), '刷新'),
          h('button', {type: 'button', className: 'local-assets-primary', disabled: busy || !snapshot.canOpenFolder, title: snapshot.canOpenFolder ? '打开资产文件夹' : '在桌面版中打开文件夹', onClick: () => run(async () => {
            const response = await fetch('/api/assets/open', {method: 'POST'});
            if (!response.ok) throw new Error('打开资产文件夹失败');
          })}, h(FolderIcon, {size: 16}), '打开文件夹'))), shell));
  }
  function App() {
    const [open, setOpen] = React.useState(true);
    const [version, setVersion] = React.useState(info.versionId);
    const [folders, setFolders] = React.useState(folderSnapshot);
    const catalogValue = React.useMemo(() => ({...catalog}), [folders.revision]);
    React.useEffect(() => {
      folderListeners.add(setFolders);
      const refresh = () => scanFolders(true).catch(error => console.error(error));
      const timer = setInterval(() => { if (!document.hidden) scanFolders().catch(error => console.error(error)); }, 5000);
      window.addEventListener('local-director-assets-refresh', refresh);
      return () => { folderListeners.delete(setFolders); clearInterval(timer); window.removeEventListener('local-director-assets-refresh', refresh); };
    }, []);
    const [startup, setStartup] = React.useState(null);
    if (!startup) return h(StartupCanvasConnection, { onResolve: setStartup });
    return h(ToastProvider, { closeLabel: '关闭', label: '通知' },
      h(CaptureProvider, { value: window.localDirectorCaptures.port }, h(DocumentProvider, { value: documents }, h(CatalogProvider, { value: catalogValue },
        open ? h(React.Fragment, null, h(CompactPanels), h(AssetFolders, {snapshot: folders, refresh: () => scanFolders(true)}), h(Editor, {
          canEdit: true, open, onOpenChange: setOpen, projectId: 'local-director', nodeId: 'local-stage',
          title: '本地预演', readContext, versionId: version,
          onAdoptVersion: async versionId => { setVersion(versionId); return true; },
        })) : h('main', { className: 'local-reopen' }, h('button', { onClick: () => setOpen(true) }, '打开导演台'))
      ))));
  }
  class ErrorBoundary extends React.Component {
    state = { error: null };
    static getDerivedStateFromError(error) { return { error }; }
    componentDidCatch(error) { console.error('Local director error', error); }
    render() { return this.state.error ? h('main', { className: 'local-reopen' }, h('p', { role: 'alert' }, '导演台发生错误：' + this.state.error.message), h('button', { onClick: () => location.reload() }, '重新加载')) : this.props.children; }
  }
  ReactDOM.createRoot(document.getElementById('root')).render(h(ErrorBoundary, null, h(App)));
})().catch(error => {
  console.error(error);
  document.getElementById('root').textContent = '本地导演台启动失败：' + error.message;
});

(() => {
  const selector = '[role="tablist"], .local-panel-tabs';
  const timeline = '[data-testid="director-stage-timeline"]';
  const selected = '[aria-selected="true"], [aria-pressed="true"], [data-state="active"]';
  const motion = matchMedia('(prefers-reduced-motion: reduce)');
  const bars = new Map();
  const fades = new Map();
  function fadeContent(bar, active) {
    if (motion.matches) return;
    let panel = document.getElementById(active.getAttribute('aria-controls') || '');
    if (!panel && bar.classList.contains('local-panel-tabs')) {
      const shell = bar.closest('[data-testid="director-stage-shell"]');
      const part = shell?.dataset.localPanel;
      panel = part === 'assets' ? shell.querySelector('[data-testid="director-stage-asset-panel"]')
        : part === 'properties' ? shell.querySelector('[data-testid="director-stage-inspector-dock"]') : null;
    }
    if (!panel && bar.closest('[data-testid="director-stage-asset-panel"]')) {
      panel = [...bar.parentElement.children].find(node => node.classList.contains('overflow-y-auto'));
    }
    if (!panel && bar.dataset.testid === 'director-stage-character-properties-tabs') panel = bar.nextElementSibling;
    if (!panel || panel.contains(bar) || panel.closest(timeline) || !panel.animate) return;
    fades.get(panel)?.cancel();
    const animation = panel.animate([{ opacity: 0.78 }, { opacity: 1 }], { duration: 180, easing: 'ease-out' });
    fades.set(panel, animation);
    const clear = () => { if (fades.get(panel) === animation) fades.delete(panel); };
    animation.onfinish = clear;
    animation.oncancel = clear;
  }
  function install(bar) {
    if (bars.has(bar) || bar.closest(timeline)) return;
    const state = { active: null, frame: 0, observer: null, resize: null };
    function update() {
      state.frame = 0;
      if (!bar.isConnected) return;
      const active = [...bar.querySelectorAll(selected)].find(node => node.closest(selector) === bar);
      const bounds = bar.getBoundingClientRect();
      if (!active || !bounds.width || !bounds.height) {
        bar.style.setProperty('--qh-tab-opacity', '0');
        return;
      }
      const rect = active.getBoundingClientRect();
      const x = active.offsetParent === bar ? active.offsetLeft : rect.left - bounds.left + bar.scrollLeft - bar.clientLeft;
      bar.style.setProperty('--qh-tab-x', x + 'px');
      bar.style.setProperty('--qh-tab-width', String(active.offsetWidth || rect.width));
      bar.style.setProperty('--qh-tab-opacity', '1');
      if (state.active && state.active !== active) fadeContent(bar, active);
      if (state.active !== active) {
        if (state.active) state.resize?.unobserve(state.active);
        state.resize?.observe(active);
        state.active = active;
      }
    }
    const schedule = () => { if (!state.frame) state.frame = requestAnimationFrame(update); };
    state.observer = new MutationObserver(schedule);
    state.observer.observe(bar, { attributes: true, attributeFilter: ['aria-selected', 'aria-pressed', 'data-state'], childList: true, subtree: true });
    if (window.ResizeObserver) {
      state.resize = new ResizeObserver(schedule);
      state.resize.observe(bar);
    }
    state.schedule = schedule;
    bars.set(bar, state);
    bar.dataset.qhTabs = '';
    schedule();
  }
  function discover(node) {
    if (!(node instanceof Element) || node.closest(timeline)) return;
    if (node.matches(selector)) install(node);
    node.querySelectorAll(selector).forEach(install);
  }
  // Discover newly mounted controls without rescanning the animated timeline.
  const observer = new MutationObserver(records => {
    let removed = false;
    for (const record of records) {
      if (record.target instanceof Element && record.target.closest(timeline)) continue;
      record.addedNodes.forEach(discover);
      if ([...record.removedNodes].some(node => node instanceof Element)) removed = true;
    }
    if (!removed) return;
    for (const [bar, state] of bars) {
      if (bar.isConnected) continue;
      cancelAnimationFrame(state.frame);
      state.observer.disconnect();
      state.resize?.disconnect();
      bars.delete(bar);
    }
    for (const [panel, animation] of fades) if (!panel.isConnected) animation.cancel();
  });
  function reducedMotionChanged() {
    if (motion.matches) for (const animation of fades.values()) animation.cancel();
  }
  observer.observe(document.body, { childList: true, subtree: true });
  discover(document.body);
  motion.addEventListener('change', reducedMotionChanged);
  document.fonts?.ready.then(() => { for (const state of bars.values()) state.schedule(); });
  window.addEventListener('pagehide', event => {
    if (event.persisted) return;
    observer.disconnect();
    motion.removeEventListener('change', reducedMotionChanged);
    for (const state of bars.values()) {
      cancelAnimationFrame(state.frame);
      state.observer.disconnect();
      state.resize?.disconnect();
    }
    for (const animation of fades.values()) animation.cancel();
    bars.clear();
  }, { once: true });
})();
