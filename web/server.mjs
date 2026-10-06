import http from 'node:http';
import fs from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { createAssetLibrary } from './asset-library.mjs';
export async function startDirectorServer({ webRoot, stateDir, assetsRoot, onOpenAssets, port = 4202 } = {}) {
const root = await fs.realpath(webRoot || path.dirname(fileURLToPath(import.meta.url)));
const state = path.resolve(stateDir || process.env.DIRECTOR_STATE_DIR || path.join(root, 'state'));
const captureFiles = path.join(state, 'capture-files');
const assetLibrary = createAssetLibrary({ assetsRoot: assetsRoot || path.join(state, 'Assets') });
await assetLibrary.initialize();
const videoFiles = path.join(state, 'video-files');
const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.mp4': 'video/mp4', '.fbx': 'application/octet-stream', '.json': 'application/json', '.wasm': 'application/wasm' };
// The bundled WebAssembly loader fetches an embedded data URL.
const csp = "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' blob: data:; media-src 'self' blob:; worker-src 'self' blob:; connect-src 'self' blob: data:; font-src 'self' data:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'";
let saveQueue = Promise.resolve();
let captureQueue = Promise.resolve();
let czAuthCache = null;
let czRuntimeConfig = null;
async function readRecord() {
  try { return JSON.parse(await fs.readFile(path.join(state, 'project-record.json'), 'utf8')); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  try { return { versionId: '1', content: await fs.readFile(path.join(state, 'project.json'), 'utf8') }; }
  catch (error) { if (error.code !== 'ENOENT') throw error; return null; }
}
async function body(req, limitBytes = 16 * 1024 * 1024) {
  let length = 0;
  const chunks = [];
  for await (const chunk of req) {
    length += chunk.length;
    if (length > limitBytes) throw new RangeError('Too large');
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}
function normalizeCzBaseUrl(value) {
  const baseUrl = String(value || '').trim().replace(/\/+$/, '');
  if (!baseUrl) return '';
  const parsed = new URL(baseUrl);
  if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('Invalid CZ base URL');
  return parsed.origin;
}
function defaultCzBaseUrl() {
  return normalizeCzBaseUrl(process.env.DIRECTOR_CZ_BASE_URL || process.env.CZ_BASE_URL || 'https://czqihui.itheima.net');
}
function czConfiguredStatus() {
  const envUsername = process.env.DIRECTOR_CZ_USERNAME || process.env.CZ_USERNAME || '';
  return {
    configured: Boolean(czRuntimeConfig || (envUsername && (process.env.DIRECTOR_CZ_PASSWORD || process.env.CZ_PASSWORD))),
    connected: Boolean(czRuntimeConfig || (czAuthCache && czAuthCache.expiresAtMs > Date.now() + 30000)),
    baseUrl: czRuntimeConfig?.baseUrl || defaultCzBaseUrl(),
    username: czRuntimeConfig?.username || envUsername || '',
  };
}
function czConfig() {
  if (czRuntimeConfig) return czRuntimeConfig;
  const baseUrl = defaultCzBaseUrl();
  const username = process.env.DIRECTOR_CZ_USERNAME || process.env.CZ_USERNAME || '';
  const password = process.env.DIRECTOR_CZ_PASSWORD || process.env.CZ_PASSWORD || '';
  if (!baseUrl || !username || !password) throw new Error('CZ integration is not configured');
  return { baseUrl, username, password };
}
async function czJson(response) {
  const text = await response.text();
  let payload;
  try { payload = text ? JSON.parse(text) : null; }
  catch { throw new Error('CZ returned invalid JSON'); }
  if (!response.ok) throw new Error(payload?.msg || payload?.detail || `CZ request failed: ${response.status}`);
  if (payload && typeof payload === 'object' && 'code' in payload && payload.code !== 0) throw new Error(payload.msg || 'CZ request failed');
  return payload && typeof payload === 'object' && 'data' in payload ? payload.data : payload;
}
async function czLoginWithConfig(config, force = false) {
  if (!force && czAuthCache?.baseUrl === config.baseUrl && czAuthCache.expiresAtMs > Date.now() + 30000) return czAuthCache.accessToken;
  const data = await czJson(await fetch(config.baseUrl + '/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: config.username, password: config.password }),
  }));
  if (!data?.accessToken) throw new Error('CZ login did not return an access token');
  czAuthCache = {
    baseUrl: config.baseUrl,
    accessToken: data.accessToken,
    refreshToken: data.refreshToken,
    expiresAtMs: Date.now() + Math.max(60, Number(data.expiresIn || 3600) - 60) * 1000,
  };
  return czAuthCache.accessToken;
}
async function czLogin(force = false) {
  return czLoginWithConfig(czConfig(), force);
}
function readCzCredentials(payload) {
  if (!payload || typeof payload !== 'object') throw new Error('Invalid CZ login payload');
  const baseUrl = normalizeCzBaseUrl(payload.baseUrl || defaultCzBaseUrl());
  const username = String(payload.username || '').trim();
  const password = String(payload.password || '');
  if (!username || !password) throw new Error('请输入用户名和密码');
  if (username.length > 120 || password.length > 240) throw new Error('用户名或密码过长');
  return { baseUrl, username, password };
}
async function czRequest(pathname, options = {}, retry = true) {
  const config = czConfig();
  const token = await czLogin();
  const headers = new Headers(options.headers || {});
  headers.set('Authorization', `Bearer ${token}`);
  const response = await fetch(config.baseUrl + pathname, { ...options, headers });
  if ((response.status === 401 || response.status === 403) && retry) {
    czAuthCache = null;
    return czRequest(pathname, options, false);
  }
  return czJson(response);
}
function contentTypeForExtension(extension) {
  return extension === '.jpg' || extension === '.jpeg' ? 'image/jpeg' : extension === '.webp' ? 'image/webp' : 'image/png';
}
function contentTypeForVideoExtension(extension) {
  return extension === '.mp4' ? 'video/mp4' : 'application/octet-stream';
}
function safeTitle(value, fallback) {
  return String(value || fallback || '导演台截图').replace(/[\u0000-\u001f]/g, '').slice(0, 120) || '导演台截图';
}
function browserResolvableCzMediaUrl(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  try {
    const parsed = new URL(raw);
    const host = parsed.hostname.trim().toLowerCase();
    const isLocalMinioHost = ['127.0.0.1', 'localhost', 'host.docker.internal', 'minio', 'cz-video-minio'].includes(host);
    if ((parsed.port === '9000' || parsed.port === '19000') && isLocalMinioHost) {
      return `/minio-proxy${parsed.pathname}${parsed.search}`;
    }
  } catch {
    return raw;
  }
  return raw;
}
async function readCaptureDescriptor(assetId) {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(String(assetId || ''))) throw new Error('Invalid capture id');
  const captureState = path.join(state, 'captures');
  const descriptor = JSON.parse(await fs.readFile(path.join(captureState, assetId + '.json'), 'utf8'));
  const extension = descriptor.extension || path.extname(new URL(descriptor.mediaUrl, 'http://127.0.0.1').pathname);
  if (!['.png', '.jpg', '.jpeg', '.webp'].includes(extension)) throw new Error('Unsupported capture format');
  const file = path.join(captureFiles, assetId + extension);
  const data = await fs.readFile(file);
  return { ...descriptor, extension, data };
}
async function readVideoDescriptor(assetId) {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(String(assetId || ''))) throw new Error('Invalid video id');
  const videoState = path.join(state, 'videos');
  const descriptor = JSON.parse(await fs.readFile(path.join(videoState, assetId + '.json'), 'utf8'));
  const extension = descriptor.extension || path.extname(new URL(descriptor.mediaUrl, 'http://127.0.0.1').pathname);
  if (!['.mp4'].includes(extension)) throw new Error('Unsupported video format');
  const file = path.join(videoFiles, assetId + extension);
  const data = await fs.readFile(file);
  return { ...descriptor, extension, data };
}
function canvasNodeForCapture({ capture, imported, index }) {
  const imageUrl = browserResolvableCzMediaUrl(imported.imageUrl || imported.thumbnailUrl);
  const width = Math.max(240, Math.min(520, Number(capture.width) || 400));
  const height = Math.max(180, Math.min(520, Math.round(width * ((Number(capture.height) || 300) / Math.max(1, Number(capture.width) || 400)))));
  const now = Date.now();
  return {
    id: `director-stage-capture-${capture.assetId}-${now}-${index}`,
    parentIds: [],
    type: 'image',
    data: {
      source: 'director_stage_export',
      entityRef: {
        sourceType: 'asset_item',
        sourceId: imported.assetItemId,
        assetId: imported.assetId,
        assetItemId: imported.assetItemId,
      },
      generationOutput: {
        assetId: imported.assetId,
        assetItemId: imported.assetItemId,
        imageUrl,
        thumbnailUrl: imported.thumbnailUrl || imageUrl,
      },
    },
    url: imageUrl,
    variations: imageUrl ? [imageUrl] : [],
    selectedVariationIndex: imageUrl ? 0 : -1,
    sourceUrl: imageUrl,
    sourceVariations: imageUrl ? [imageUrl] : [],
    originalUrl: imageUrl,
    originalVariations: imageUrl ? [imageUrl] : [],
    previewUrl: imported.thumbnailUrl || imageUrl,
    previewVariations: [imported.thumbnailUrl || imageUrl].filter(Boolean),
    prompt: safeTitle(capture.title, imported.name),
    timestamp: now,
    config: {
      model: 'custom',
      aspectRatio: '16:9',
      size: '1K',
      customModel: '',
      videoModel: 'tokone:doubao-seedance-2-0-fast',
      videoGroup: 'default',
      videoResolution: '720p',
      videoDuration: 4,
      videoHd: false,
      videoGenerateAudio: false,
      imageGenerationCount: 1,
    },
    x: 80 + (index % 3) * 460,
    y: 80 + Math.floor(index / 3) * 480,
    width,
    height,
    assetWidth: Number(capture.width) || undefined,
    assetHeight: Number(capture.height) || undefined,
    isLoading: false,
  };
}
function canvasNodeForVideo({ video, imported, index }) {
  const videoUrl = browserResolvableCzMediaUrl(imported.videoUrl || imported.sourceUrl || imported.thumbnailUrl);
  const previewUrl = browserResolvableCzMediaUrl(imported.thumbnailUrl) || videoUrl;
  const sourceVariations = videoUrl ? [videoUrl] : [];
  const rawWidth = Number(video.width) || 360;
  const rawHeight = Number(video.height) || 240;
  const width = Math.max(240, Math.min(520, rawWidth));
  const height = Math.max(180, Math.min(520, Math.round(width * (rawHeight / Math.max(1, rawWidth)))));
  const now = Date.now();
  return {
    id: `director-stage-video-${video.assetId}-${now}-${index}`,
    parentIds: [],
    type: 'video',
    data: {
      source: 'director_stage_export_video',
      entityRef: {
        sourceType: 'asset_item',
        sourceId: imported.assetItemId,
        assetId: imported.assetId,
        assetItemId: imported.assetItemId,
        mediaType: 'video',
      },
      generationOutput: {
        assetId: imported.assetId,
        assetItemId: imported.assetItemId,
        videoUrl,
        thumbnailUrl: previewUrl,
        sourceUrl: videoUrl,
        durationSeconds: Number(video.durationSec) || undefined,
      },
    },
    url: previewUrl || '',
    variations: previewUrl ? [previewUrl] : [],
    selectedVariationIndex: previewUrl ? 0 : -1,
    sourceUrl: videoUrl,
    sourceVariations,
    originalUrl: videoUrl,
    originalVariations: sourceVariations,
    previewUrl,
    previewVariations: [previewUrl].filter(Boolean),
    prompt: safeTitle(video.title, imported.name || '导出视频'),
    timestamp: now,
    config: {
      model: 'custom',
      aspectRatio: rawWidth >= rawHeight ? '16:9' : '9:16',
      size: '1K',
      customModel: '',
      videoModel: 'tokone:doubao-seedance-2-0-fast',
      videoGroup: 'default',
      videoResolution: '720p',
      videoDuration: Math.max(1, Math.round(Number(video.durationSec) || 4)),
      videoHd: false,
      videoGenerateAudio: false,
      imageGenerationCount: 1,
    },
    x: 80 + (index % 3) * 460,
    y: 80 + Math.floor(index / 3) * 480,
    width,
    height,
    assetWidth: rawWidth,
    assetHeight: rawHeight,
    isLoading: false,
  };
}
async function uploadCapturesToCzCanvas(projectId, captures) {
  const numericProjectId = Number(projectId);
  if (!Number.isSafeInteger(numericProjectId) || numericProjectId <= 0) throw new Error('Invalid CZ project id');
  if (!Array.isArray(captures) || captures.length < 1 || captures.length > 20) throw new Error('Invalid capture list');
  const uploaded = [];
  for (const requested of captures) {
    const capture = await readCaptureDescriptor(requested.assetId || requested.captureId);
    const form = new FormData();
    form.append('file', new Blob([capture.data], { type: contentTypeForExtension(capture.extension) }), safeTitle(capture.title, capture.assetId) + capture.extension);
    const imported = await czRequest(`/api/projects/${numericProjectId}/quick-media/local-media?mediaType=image`, {
      method: 'POST',
      body: form,
    });
    uploaded.push({ capture, imported });
  }
  const operations = uploaded.map((entry, index) => ({
    operation: 'upsert_node',
    payload: { node: canvasNodeForCapture({ ...entry, index }) },
  }));
  await czRequest(`/api/projects/${numericProjectId}/canvas/operations?docType=free_canvas`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      operations,
      operationBatchId: `director-stage-export-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    }),
  });
  return { captureIds: uploaded.map(entry => entry.capture.assetId), uploaded: uploaded.length };
}
async function uploadVideosToCzCanvas(projectId, videos) {
  const numericProjectId = Number(projectId);
  if (!Number.isSafeInteger(numericProjectId) || numericProjectId <= 0) throw new Error('Invalid CZ project id');
  if (!Array.isArray(videos) || videos.length < 1 || videos.length > 10) throw new Error('Invalid video list');
  const uploaded = [];
  for (const requested of videos) {
    const video = await readVideoDescriptor(requested.assetId || requested.videoId);
    const form = new FormData();
    form.append('file', new Blob([video.data], { type: contentTypeForVideoExtension(video.extension) }), safeTitle(video.title, video.assetId) + video.extension);
    const imported = await czRequest(`/api/projects/${numericProjectId}/quick-media/local-media?mediaType=video`, {
      method: 'POST',
      body: form,
    });
    uploaded.push({ video, imported });
  }
  const operations = uploaded.map((entry, index) => ({
    operation: 'upsert_node',
    payload: { node: canvasNodeForVideo({ ...entry, index }) },
  }));
  await czRequest(`/api/projects/${numericProjectId}/canvas/operations?docType=free_canvas`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      operations,
      operationBatchId: `director-stage-video-export-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    }),
  });
  return {
    videoIds: uploaded.map(entry => entry.video.assetId),
    uploaded: uploaded.length,
    assets: uploaded.map(({ video, imported }) => ({
      assetId: video.assetId,
      revisionId: video.revisionId,
      remoteAssetId: imported.assetId,
      remoteAssetItemId: imported.assetItemId,
      mediaUrl: browserResolvableCzMediaUrl(imported.videoUrl || imported.thumbnailUrl) || video.mediaUrl,
    })),
  };
}
const server = http.createServer(async (req, res) => {
  const send = (status, text, type = 'text/plain; charset=utf-8') => { res.writeHead(status, { 'Content-Type': type }); res.end(text); };
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Content-Security-Policy', csp);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  try {
    const url = new URL(req.url, 'http://127.0.0.1');
    if (['PUT', 'POST', 'PATCH'].includes(req.method) && req.headers.origin !== `http://127.0.0.1:${server.address().port}`) return send(403, 'Origin not allowed');
    if (url.pathname === '/api/info' && req.method === 'GET') {
      return send(200, JSON.stringify({ versionId: (await readRecord())?.versionId }), 'application/json');
    }
    if (url.pathname === '/api/assets/catalog' && req.method === 'GET') {
      const catalog = await assetLibrary.scan();
      return send(200, JSON.stringify({ ...catalog, canOpenFolder: typeof onOpenAssets === 'function' }), 'application/json');
    }
    if (url.pathname === '/api/assets/refresh' && req.method === 'POST') {
      const catalog = await assetLibrary.scan({ refresh: true });
      return send(200, JSON.stringify({ ...catalog, canOpenFolder: typeof onOpenAssets === 'function' }), 'application/json');
    }
    if (url.pathname === '/api/assets/open' && req.method === 'POST') {
      if (typeof onOpenAssets !== 'function') return send(409, 'Asset folders can be opened from the desktop application');
      await onOpenAssets();
      return send(200, JSON.stringify({ ok: true }), 'application/json');
    }
    if (url.pathname === '/api/cz/session') {
      if (req.method === 'GET') {
        return send(200, JSON.stringify(czConfiguredStatus()), 'application/json');
      }
      if (req.method === 'POST') {
        const previousConfig = czRuntimeConfig;
        const previousAuth = czAuthCache;
        const config = readCzCredentials(JSON.parse((await body(req)).toString('utf8')));
        czRuntimeConfig = config;
        czAuthCache = null;
        try {
          await czLoginWithConfig(config, true);
          return send(200, JSON.stringify({
            connected: true,
            baseUrl: config.baseUrl,
            username: config.username,
          }), 'application/json');
        } catch (error) {
          czRuntimeConfig = previousConfig;
          czAuthCache = previousAuth;
          return send(401, error.message || 'CZ login failed');
        }
      }
      if (req.method === 'DELETE') {
        czRuntimeConfig = null;
        czAuthCache = null;
        return send(200, JSON.stringify({ connected: false, baseUrl: defaultCzBaseUrl(), username: '' }), 'application/json');
      }
    }
    if (url.pathname === '/api/motion-library') {
      const libraryFile = path.join(state, 'motion-library.json');
      const readLibrary = async () => {
        try { return JSON.parse(await fs.readFile(libraryFile, 'utf8')); }
        catch (error) {
          if (error.code !== 'ENOENT') throw error;
          return { versionId: '0', payload: { version: 1, motions: [] } };
        }
      };
      if (req.method === 'GET') return send(200, JSON.stringify(await readLibrary()), 'application/json');
      if (req.method === 'PUT') {
        const payload = JSON.parse((await body(req)).toString('utf8'));
        if (!payload || ![1, 2].includes(payload.version) || !Array.isArray(payload.motions) || payload.motions.length > 256) return send(400, 'Invalid motion library');
        const operation = saveQueue.then(async () => {
          const current = await readLibrary();
          if (req.headers['if-match'] !== current.versionId) return send(409, 'Motion library changed in another window');
          const versionId = (BigInt(current.versionId) + 1n).toString();
          await fs.mkdir(state, { recursive: true });
          const temporary = path.join(state, 'motions-' + randomUUID() + '.pending');
          await fs.writeFile(temporary, JSON.stringify({ versionId, payload }));
          await fs.rename(temporary, libraryFile);
          return send(200, JSON.stringify({ versionId }), 'application/json');
        });
        saveQueue = operation.catch(() => {});
        return await operation;
      }
    }
    if (url.pathname === '/api/document') {
      if (req.method === 'GET') {
        const record = await readRecord();
        if (!record) return send(404, 'No project');
        if (url.searchParams.has('version') && record.versionId !== url.searchParams.get('version')) return send(409, 'Project changed');
        return send(200, record.content, 'application/octet-stream');
      }
      if (req.method === 'PUT') {
        const data = await body(req);
        JSON.parse(data.toString('utf8'));
        const operation = saveQueue.then(async () => {
          const current = await readRecord();
          if (current?.writeId && current.writeId === req.headers['x-write-id']) return send(200, JSON.stringify({ versionId: current.versionId }), 'application/json');
          if (req.headers['if-match'] !== (current?.versionId || '0')) return send(409, 'Project changed in another window');
          const versionId = (BigInt(current?.versionId || '0') + 1n).toString();
          await fs.mkdir(state, { recursive: true });
          const temporary = path.join(state, 'project-' + randomUUID() + '.pending');
          await fs.writeFile(temporary, JSON.stringify({ versionId, writeId: req.headers['x-write-id'], content: data.toString('utf8') }));
          await fs.rename(temporary, path.join(state, 'project-record.json'));
          return send(200, JSON.stringify({ versionId }), 'application/json');
        });
        saveQueue = operation.catch(() => {});
        return await operation;
      }
    }
    const backgroundCapture = /^\/api\/captures\/([^/]+)\/background$/.exec(url.pathname);
    if (backgroundCapture && req.method === 'PATCH') {
      const assetId = backgroundCapture[1];
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(assetId)) return send(400, 'Invalid capture ID');
      const payload = JSON.parse((await body(req, 1024)).toString('utf8'));
      if (!payload || typeof payload.deleted !== 'boolean') return send(400, 'Invalid background state');
      const operation = captureQueue.then(async () => {
        const captureState = path.join(state, 'captures');
        const filename = path.join(captureState, assetId + '.json');
        let item;
        try { item = JSON.parse(await fs.readFile(filename, 'utf8')); }
        catch (error) { if (error.code === 'ENOENT') return send(404, 'Capture not found'); throw error; }
        item.backgroundDeleted = payload.deleted;
        const temporary = path.join(captureState, assetId + '-' + randomUUID() + '.pending');
        await fs.writeFile(temporary, JSON.stringify(item));
        await fs.rename(temporary, filename);
        return send(200, JSON.stringify(item), 'application/json');
      });
      captureQueue = operation.catch(() => {});
      return await operation;
    }
    if (url.pathname === '/api/captures') {
      const captureState = path.join(state, 'captures');
      if (req.method === 'GET') {
        const names = await fs.readdir(captureState).catch(error => { if (error.code === 'ENOENT') return []; throw error; });
        const items = await Promise.all(names.filter(name => name.endsWith('.json')).map(async name => JSON.parse(await fs.readFile(path.join(captureState, name), 'utf8'))));
        return send(200, JSON.stringify({ items }), 'application/json');
      }
      if (req.method === 'POST') {
        const extension = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp' }[req.headers['content-type']];
        const width = Number(req.headers['x-capture-width']);
        const height = Number(req.headers['x-capture-height']);
        if (!extension || ![width, height].every(value => Number.isSafeInteger(value) && value > 0 && value <= 16384)) return send(400, 'Invalid image');
        const data = await body(req);
        const valid = extension === '.jpg' ? data[0] === 255 && data[1] === 216 : extension === '.png' ? data.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) : data.toString('ascii', 0, 4) === 'RIFF' && data.toString('ascii', 8, 12) === 'WEBP';
        if (!valid) return send(400, 'Invalid image bytes');
        const assetId = randomUUID();
        const item = { assetId, revisionId: '1', mediaUrl: '/assets/captures/' + assetId + extension, width, height, extension, title: decodeURIComponent(req.headers['x-capture-name'] || 'Capture').slice(0, 240) };
        const operation = captureQueue.then(async () => {
          await fs.mkdir(captureFiles, { recursive: true });
          await fs.mkdir(captureState, { recursive: true });
          await fs.writeFile(path.join(captureFiles, assetId + extension), data);
          const temporary = path.join(captureState, assetId + '.pending');
          await fs.writeFile(temporary, JSON.stringify(item));
          await fs.rename(temporary, path.join(captureState, assetId + '.json'));
          return send(200, JSON.stringify(item), 'application/json');
        });
        captureQueue = operation.catch(() => {});
        return await operation;
      }
    }
    if (url.pathname === '/api/videos') {
      const videoState = path.join(state, 'videos');
      if (req.method === 'GET') {
        const names = await fs.readdir(videoState).catch(error => { if (error.code === 'ENOENT') return []; throw error; });
        const items = await Promise.all(names.filter(name => name.endsWith('.json')).map(async name => JSON.parse(await fs.readFile(path.join(videoState, name), 'utf8'))));
        return send(200, JSON.stringify({ items }), 'application/json');
      }
      if (req.method === 'POST') {
        const contentType = String(req.headers['content-type'] || '').split(';', 1)[0].trim().toLowerCase();
        if (contentType !== 'video/mp4' && contentType !== 'application/octet-stream') return send(400, 'Invalid video');
        const data = await body(req, 512 * 1024 * 1024);
        if (data.length < 12 || data.toString('ascii', 4, 8) !== 'ftyp') return send(400, 'Invalid video bytes');
        const assetId = randomUUID();
        const width = Number(req.headers['x-video-width']);
        const height = Number(req.headers['x-video-height']);
        const durationSec = Number(req.headers['x-video-duration']);
        const fps = Number(req.headers['x-video-fps']);
        const extension = '.mp4';
        const item = {
          assetId,
          revisionId: '1',
          mediaUrl: '/assets/videos/' + assetId + extension,
          extension,
          title: decodeURIComponent(req.headers['x-video-name'] || 'Exported video').slice(0, 240),
          ...(Number.isFinite(width) && width > 0 ? { width: Math.round(width) } : {}),
          ...(Number.isFinite(height) && height > 0 ? { height: Math.round(height) } : {}),
          ...(Number.isFinite(durationSec) && durationSec > 0 ? { durationSec } : {}),
          ...(Number.isFinite(fps) && fps > 0 ? { fps } : {}),
        };
        await fs.mkdir(videoFiles, { recursive: true });
        await fs.mkdir(videoState, { recursive: true });
        await fs.writeFile(path.join(videoFiles, assetId + extension), data);
        await fs.writeFile(path.join(videoState, assetId + '.json'), JSON.stringify(item));
        return send(200, JSON.stringify(item), 'application/json');
      }
    }
    if (url.pathname === '/api/cz/projects' && req.method === 'GET') {
      const projects = await czRequest('/api/projects');
      return send(200, JSON.stringify({ items: (Array.isArray(projects) ? projects : []).map(project => ({
        id: project.id,
        name: project.name,
        description: project.description,
        updateTime: project.updateTime,
        canManage: project.canManage,
      })) }), 'application/json');
    }
    if (url.pathname === '/api/cz/upload-captures' && req.method === 'POST') {
      const payload = JSON.parse((await body(req)).toString('utf8'));
      const result = await uploadCapturesToCzCanvas(payload.projectId, payload.captures);
      return send(200, JSON.stringify(result), 'application/json');
    }
    if (url.pathname === '/api/cz/upload-videos' && req.method === 'POST') {
      const payload = JSON.parse((await body(req)).toString('utf8'));
      const result = await uploadVideosToCzCanvas(payload.projectId, payload.videos);
      return send(200, JSON.stringify(result), 'application/json');
    }
    if (!['GET', 'HEAD'].includes(req.method)) return send(405, 'Method not allowed');
    if (url.pathname.startsWith('/local-assets/')) {
      const asset = await assetLibrary.resolveFile(url.pathname);
      if (!asset) return send(404, 'Asset not found');
      res.writeHead(200, { 'Content-Type': asset.contentType, 'Content-Length': asset.size });
      if (req.method === 'HEAD') return res.end();
      createReadStream(asset.path).on('error', () => res.destroy()).pipe(res);
      return;
    }
    const decoded = decodeURIComponent(url.pathname);
    if (decoded.includes('\\') || decoded.includes('\0')) return send(400, 'Invalid path');
    let candidate = path.resolve(root, decoded === '/' ? 'index.html' : decoded.replace(/^\/+/, ''));
    const relative = path.relative(root, candidate);
    const allowed = value => ['index.html', 'runtime.js', 'host.js', 'host.css', 'captures.js', 'motion-library.js'].includes(value) || /^(vendor|assets|styles)[\\/]/.test(value);
    if (!allowed(relative) || relative.split(path.sep).includes('..')) return send(404, 'Not found');
    let persistentCapture = false;
    let persistentVideo = false;
    if (decoded.startsWith('/assets/captures/')) {
      const basename = decoded.slice('/assets/captures/'.length);
      if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]*\.(png|jpg|webp)$/.test(basename)) return send(404, 'Not found');
      try {
        const captureRoot = await fs.realpath(captureFiles);
        const stored = await fs.realpath(path.join(captureFiles, basename));
        if (path.relative(captureRoot, stored) !== basename) return send(404, 'Not found');
        candidate = stored;
        persistentCapture = true;
      } catch (error) {
        if (error.code !== 'ENOENT') throw error;
      }
    }
    if (decoded.startsWith('/assets/videos/')) {
      const basename = decoded.slice('/assets/videos/'.length);
      if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]*\.mp4$/.test(basename)) return send(404, 'Not found');
      try {
        const videoRoot = await fs.realpath(videoFiles);
        const stored = await fs.realpath(path.join(videoFiles, basename));
        if (path.relative(videoRoot, stored) !== basename) return send(404, 'Not found');
        candidate = stored;
        persistentVideo = true;
      } catch (error) {
        if (error.code !== 'ENOENT') throw error;
      }
    }
    const file = await fs.realpath(candidate);
    if (!persistentCapture && !persistentVideo && !allowed(path.relative(root, file))) return send(404, 'Not found');
    const stat = await fs.stat(file);
    if (!stat.isFile()) return send(404, 'Not found');
    res.writeHead(200, { 'Content-Type': mime[path.extname(file)] || 'application/octet-stream', 'Content-Length': stat.size });
    if (req.method === 'HEAD') return res.end();
    createReadStream(file).on('error', () => res.destroy()).pipe(res);
  } catch (error) { send(error instanceof RangeError ? 413 : error instanceof SyntaxError ? 400 : 404, 'Request failed'); }
});
await new Promise((resolve, reject) => {
  const onError = error => reject(error);
  server.once('error', onError);
  server.listen(port, '127.0.0.1', () => {
    server.off('error', onError);
    resolve();
  });
});
server.once('close', () => assetLibrary.close());
return server;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const server = await startDirectorServer({ port: Number(process.argv[2] ?? 4202) });
    console.log(`Local director: http://127.0.0.1:${server.address().port}/`);
  } catch (error) {
    console.error(error);
    process.exitCode = 1;
  }
}
