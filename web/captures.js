(() => {
  function localAsset(value, fallback = {}) {
    if (!value || typeof value.assetId !== 'string' || !value.assetId ||
        typeof value.revisionId !== 'string' || !value.revisionId ||
        typeof value.mediaUrl !== 'string' || !value.mediaUrl) {
      throw new Error('Invalid local capture descriptor');
    }
    const url = new URL(value.mediaUrl, location.href);
    if (url.origin !== location.origin) throw new Error('Capture URL must be local');
    const width = value.width ?? fallback.width;
    const height = value.height ?? fallback.height;
    if (!Number.isSafeInteger(width) || width < 1 ||
        !Number.isSafeInteger(height) || height < 1) {
      throw new Error('Invalid local capture dimensions');
    }
    const extension = value.extension ?? fallback.extension ?? '.jpg';
    if (!['.jpg', '.jpeg', '.png', '.webp'].includes(extension)) {
      throw new Error('Unsupported local capture format');
    }
    return {
      assetId: value.assetId,
      revisionId: value.revisionId,
      title: value.title ?? fallback.title ?? value.assetId,
      mediaUrl: url.href,
      extension,
      width,
      height,
      localBackgroundAsset: true,
      backgroundDeleted: value.backgroundDeleted === true,
    };
  }

  function localVideoAsset(value, fallback = {}) {
    if (!value || typeof value.assetId !== 'string' || !value.assetId ||
        typeof value.revisionId !== 'string' || !value.revisionId ||
        typeof value.mediaUrl !== 'string' || !value.mediaUrl) {
      throw new Error('Invalid local video descriptor');
    }
    const url = new URL(value.mediaUrl, location.href);
    if (url.origin !== location.origin) throw new Error('Video URL must be local');
    const extension = value.extension ?? fallback.extension ?? '.mp4';
    if (extension !== '.mp4') throw new Error('Unsupported local video format');
    const width = Number(value.width ?? fallback.width);
    const height = Number(value.height ?? fallback.height);
    const durationSec = Number(value.durationSec ?? fallback.durationSec);
    const fps = Number(value.fps ?? fallback.fps);
    return {
      assetId: value.assetId,
      revisionId: value.revisionId,
      title: value.title ?? fallback.title ?? value.assetId,
      mediaUrl: url.href,
      extension,
      ...(Number.isFinite(width) && width > 0 ? { width: Math.round(width) } : {}),
      ...(Number.isFinite(height) && height > 0 ? { height: Math.round(height) } : {}),
      ...(Number.isFinite(durationSec) && durationSec > 0 ? { durationSec } : {}),
      ...(Number.isFinite(fps) && fps > 0 ? { fps } : {}),
    };
  }

  async function readIndex(signal) {
    const response = await fetch('/api/captures', { signal });
    if (!response.ok) throw new Error('Could not read local captures');
    const result = await response.json();
    if (!Array.isArray(result.items)) throw new Error('Invalid local capture index');
    return result.items.map(value => localAsset(value));
  }

  async function saveFile(file) {
    const extension = ({ 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp' })[file.type];
    if (!extension || file.size <= 0) throw new Error('Unsupported capture image');
    const bitmap = await createImageBitmap(file);
    const dimensions = { width: bitmap.width, height: bitmap.height };
    bitmap.close();
    const title = file.name || 'capture' + extension;
    const response = await fetch('/api/captures', {
      method: 'POST',
      headers: {
        'Content-Type': file.type,
        'X-Capture-Name': encodeURIComponent(title),
        'X-Capture-Width': String(dimensions.width),
        'X-Capture-Height': String(dimensions.height),
      },
      body: file,
    });
    if (!response.ok) throw new Error('Could not save local capture');
    return localAsset(await response.json(), { ...dimensions, title, extension });
  }

  async function setBackgroundDeleted(assetId, deleted) {
    const response = await fetch('/api/captures/' + encodeURIComponent(assetId) + '/background', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ deleted }),
    });
    if (!response.ok) throw new Error(deleted ? '删除背景失败，请重试' : '恢复背景失败，请重试');
    return localAsset(await response.json());
  }

  async function readVideoMetadata(file) {
    const url = URL.createObjectURL(file);
    try {
      const video = document.createElement('video');
      video.preload = 'metadata';
      video.muted = true;
      video.src = url;
      await new Promise((resolve, reject) => {
        const cleanup = () => {
          video.removeEventListener('loadedmetadata', onLoaded);
          video.removeEventListener('error', onError);
        };
        const onLoaded = () => { cleanup(); resolve(); };
        const onError = () => { cleanup(); reject(new Error('Could not read video metadata')); };
        video.addEventListener('loadedmetadata', onLoaded, { once: true });
        video.addEventListener('error', onError, { once: true });
      });
      return {
        width: Number(video.videoWidth) || undefined,
        height: Number(video.videoHeight) || undefined,
        durationSec: Number.isFinite(video.duration) ? video.duration : undefined,
      };
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  async function saveVideoFile(file, fallback = {}) {
    const type = file.type || 'video/mp4';
    if (!['video/mp4', 'application/mp4', 'application/octet-stream'].includes(type) || file.size <= 0) {
      throw new Error('Unsupported video');
    }
    const metadata = await readVideoMetadata(file).catch(() => ({}));
    const title = file.name || fallback.name || 'director-stage-export.mp4';
    const response = await fetch('/api/videos', {
      method: 'POST',
      headers: {
        'Content-Type': 'video/mp4',
        'X-Video-Name': encodeURIComponent(title),
        ...(metadata.width ? { 'X-Video-Width': String(metadata.width) } : {}),
        ...(metadata.height ? { 'X-Video-Height': String(metadata.height) } : {}),
        ...(metadata.durationSec ? { 'X-Video-Duration': String(metadata.durationSec) } : {}),
        ...(fallback.fps ? { 'X-Video-Fps': String(fallback.fps) } : {}),
      },
      body: file,
    });
    if (!response.ok) throw new Error('Could not save local video');
    return localVideoAsset(await response.json(), { ...metadata, title, extension: '.mp4', fps: fallback.fps });
  }

  function chooseProject(projects, options = {}) {
    return new Promise((resolve, reject) => {
      const title = options.title || '选择上传到的项目';
      const description = options.description || '截图会上传为该项目的素材，并直接添加到自由画布。';
      const previousBodyPointerEvents = document.body.style.pointerEvents;
      document.body.style.pointerEvents = 'auto';
      const overlay = document.createElement('div');
      overlay.style.cssText = 'position:fixed;inset:0;z-index:2147483647;background:rgba(15,23,42,.46);display:grid;place-items:center;font-family:system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;pointer-events:auto;';
      const dialog = document.createElement('section');
      dialog.style.cssText = 'width:min(520px,calc(100vw - 32px));max-height:min(640px,calc(100vh - 32px));overflow:hidden;border-radius:14px;background:#fff;box-shadow:0 24px 72px rgba(15,23,42,.28);color:#0f172a;pointer-events:auto;';
      const header = document.createElement('div');
      header.style.cssText = 'padding:18px 20px 12px;border-bottom:1px solid #e2e8f0;';
      const heading = document.createElement('h2');
      heading.textContent = title;
      heading.style.cssText = 'margin:0;font-size:17px;line-height:1.35;font-weight:700;';
      const summary = document.createElement('p');
      summary.textContent = description;
      summary.style.cssText = 'margin:6px 0 0;font-size:13px;line-height:1.5;color:#64748b;';
      header.append(heading, summary);
      const list = document.createElement('div');
      list.style.cssText = 'max-height:420px;overflow:auto;padding:10px;';
      const footer = document.createElement('div');
      footer.style.cssText = 'display:flex;justify-content:flex-end;gap:8px;padding:12px 16px;border-top:1px solid #e2e8f0;background:#f8fafc;';
      const cancel = document.createElement('button');
      cancel.type = 'button';
      cancel.textContent = '取消';
      cancel.style.cssText = 'height:34px;border:1px solid #cbd5e1;border-radius:8px;background:#fff;padding:0 14px;color:#334155;cursor:pointer;';
      footer.append(cancel);
      dialog.append(header, list, footer);
      overlay.append(dialog);
      const cleanup = () => {
        overlay.remove();
        document.body.style.pointerEvents = previousBodyPointerEvents;
      };
      dialog.addEventListener('pointerdown', event => event.stopPropagation());
      dialog.addEventListener('click', event => event.stopPropagation());
      cancel.addEventListener('click', () => { cleanup(); reject(new DOMException('Cancelled', 'AbortError')); });
      overlay.addEventListener('click', event => {
        if (event.target === overlay) {
          cleanup();
          reject(new DOMException('Cancelled', 'AbortError'));
        }
      });
      for (const project of projects) {
        const button = document.createElement('button');
        button.type = 'button';
        button.style.cssText = 'display:block;width:100%;border:1px solid #e2e8f0;border-radius:10px;background:#fff;margin:0 0 8px;padding:12px;text-align:left;cursor:pointer;pointer-events:auto;';
        const name = document.createElement('div');
        name.textContent = project.name || '未命名项目';
        name.style.cssText = 'font-size:14px;font-weight:650;color:#0f172a;';
        const meta = document.createElement('div');
        meta.textContent = project.description || (project.updateTime ? '更新于 ' + project.updateTime : '项目 ID ' + project.id);
        meta.style.cssText = 'margin-top:4px;font-size:12px;line-height:1.45;color:#64748b;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;';
        button.append(name, meta);
        button.addEventListener('click', () => { cleanup(); resolve(project.id); });
        list.append(button);
      }
      if (!projects.length) {
        const empty = document.createElement('p');
        empty.textContent = '当前账号没有可上传的项目。';
        empty.style.cssText = 'margin:18px 10px 22px;font-size:14px;color:#64748b;';
        list.append(empty);
      }
      document.body.append(overlay);
      cancel.focus();
    });
  }

  async function loadRemoteProjects() {
    const response = await fetch('/api/cz/projects');
    if (!response.ok) throw new Error('无法读取绮绘项目列表');
    const result = await response.json();
    return Array.isArray(result.items) ? result.items : [];
  }

  async function uploadCapturesToRemoteCanvas(captures) {
    const items = Array.isArray(captures) && captures.length ? captures : (await readIndex());
    if (!items.length) return { ok: false, reason: 'failed' };
    const projects = await loadRemoteProjects();
    const projectId = await chooseProject(projects, {
      description: '截图会上传为该项目的素材，并直接添加到自由画布。',
    });
    const response = await fetch('/api/cz/upload-captures', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        projectId,
        captures: items.map(item => ({
          captureId: item.captureId || item.id || item.assetId,
          assetId: item.assetId,
          name: item.name || item.title,
          width: item.width,
          height: item.height,
        })),
      }),
    });
    if (!response.ok) throw new Error('无法上传截图到绮绘画布');
    const result = await response.json();
    return { ok: true, captureIds: result.captureIds || items.map(item => item.captureId || item.id || item.assetId) };
  }

  async function uploadVideosToRemoteCanvas(videos) {
    if (!Array.isArray(videos) || !videos.length) return { ok: false, reason: 'failed' };
    const projects = await loadRemoteProjects();
    const projectId = await chooseProject(projects, {
      description: '视频会上传为该项目的素材，并直接添加到自由画布。',
    });
    const response = await fetch('/api/cz/upload-videos', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        projectId,
        videos: videos.map(item => ({
          videoId: item.videoId || item.id || item.assetId,
          assetId: item.assetId,
          name: item.name || item.title,
          width: item.width,
          height: item.height,
          durationSec: item.durationSec,
          fps: item.fps,
        })),
      }),
    });
    if (!response.ok) throw new Error('无法上传视频到绮绘画布');
    const result = await response.json();
    return { ok: true, videoIds: result.videoIds || videos.map(item => item.videoId || item.id || item.assetId) };
  }

  const port = {
    async saveCaptures(files) {
      const results = [];
      for (const file of files) {
        try {
          results.push({ ok: true, asset: await saveFile(file) });
        } catch (error) {
          console.error('Local capture save failed', error);
          results.push({ ok: false, reason: 'failed' });
        }
      }
      return results;
    },
    removeBackground(assetId) { return setBackgroundDeleted(assetId, true); },
    restoreBackground(assetId) { return setBackgroundDeleted(assetId, false); },
    async placeCaptures(captures) {
      try {
        return await uploadCapturesToRemoteCanvas(captures);
      } catch (error) {
        if (error?.name === 'AbortError') return { ok: true, captureIds: [] };
        console.error('Remote canvas upload failed', error);
        return { ok: false, reason: 'failed' };
      }
    },
    async writeVideos(files) {
      const results = [];
      for (const file of files) {
        try {
          const asset = await saveVideoFile(file);
          await uploadVideosToRemoteCanvas([asset]);
          results.push({ ok: true, asset });
        } catch (error) {
          console.error('Remote video upload failed', error);
          results.push({ ok: false, reason: 'failed' });
        }
      }
      return results;
    },
  };

  const catalog = {
    async listImages(params = {}, signal) {
      const items = (await readIndex(signal)).filter(item => !item.backgroundDeleted);
      const requestedOffset = Number(params.cursor ?? 0);
      const offset = Number.isSafeInteger(requestedOffset) && requestedOffset >= 0 ? requestedOffset : 0;
      const limit = Number.isSafeInteger(params.limit) && params.limit > 0 ? Math.min(params.limit, 100) : 40;
      const next = offset + limit;
      const hasMore = next < items.length;
      return { items: items.slice(offset, next), hasMore, ...(hasMore ? { cursor: String(next) } : {}) };
    },
    async resolveImages({ resourceIds }, signal) {
      if (!resourceIds.length) return [];
      const requested = new Set(resourceIds);
      return (await readIndex(signal)).filter(item => requested.has(item.assetId));
    },
  };

  window.localDirectorCaptures = { port, catalog };
})();
