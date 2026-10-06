(() => {
  'use strict';
  const nativeFetch = window.fetch.bind(window);
  const dbName = 'qihui-director-extension-v1';
  const groups = ['characters', 'models', 'motions', 'poses'];
  const groupExtensions = {
    characters: new Set(['.fbx']), models: new Set(['.fbx', '.glb', '.gltf']),
    motions: new Set(['.fbx', '.motion.json']), poses: new Set(['.motion.json', '.octomotion.json']),
  };
  const mime = { '.fbx': 'application/octet-stream', '.glb': 'model/gltf-binary', '.gltf': 'model/gltf+json', '.bin': 'application/octet-stream', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif', '.bmp': 'image/bmp', '.tga': 'application/octet-stream', '.dds': 'application/octet-stream', '.ktx': 'image/ktx', '.ktx2': 'image/ktx2', '.hdr': 'application/octet-stream', '.exr': 'application/octet-stream', '.motion.json': 'application/json', '.octomotion.json': 'application/json', '.mp4': 'video/mp4' };
  const resourceExtensions = new Set(['.bin', '.png', '.jpg', '.jpeg', '.webp', '.gif', '.bmp', '.tga', '.dds', '.ktx', '.ktx2', '.hdr', '.exr']);
  const limits = { json: 16 * 1024 * 1024, file: 512 * 1024 * 1024, total: 1024 * 1024 * 1024, files: 10000 };
  const extension = name => /\.(?:octomotion|motion)\.json$/i.exec(name)?.[0].toLowerCase() || /\.[^.]+$/.exec(name)?.[0].toLowerCase() || '';
  const validVersion = value => typeof value === 'string' && /^(0|[1-9]\d*)$/.test(value);
  const safeSegment = value => typeof value === 'string' && value && value !== '.' && value !== '..' && !value.startsWith('.') && !/[\\/:\x00-\x1f\x7f]/.test(value) && !/[ .]$/.test(value);
  const validPath = value => typeof value === 'string' && value.split('/').length <= 14 && value.split('/').every(safeSegment) && groups.includes(value.split('/')[0]) && value.includes('/');
  const assetPath = value => '/local-assets/' + value.split('/').map(encodeURIComponent).join('/');
  const json = (value, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } });
  const failure = (message, status = 400) => new Response(message, { status, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
  const objectUrls = new Map();
  let database;
  let catalog;
  let catalogRevision;
  let operationQueue = Promise.resolve();
  const enqueue = run => {
    const result = operationQueue.then(run, run);
    operationQueue = result.catch(() => {});
    return result;
  };
  const requestResult = request => new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  const transactionDone = transaction => new Promise((resolve, reject) => {
    transaction.oncomplete = resolve;
    transaction.onabort = transaction.onerror = () => reject(transaction.error || new Error('Local database transaction failed'));
  });
  function openDatabase() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(dbName, 1);
      request.onupgradeneeded = () => {
        request.result.createObjectStore('records');
        request.result.createObjectStore('files');
        request.result.createObjectStore('media');
      };
      request.onsuccess = () => {
        request.result.onversionchange = () => request.result.close();
        resolve(request.result);
      };
      request.onerror = () => reject(request.error);
      request.onblocked = () => reject(new Error('Please close other director tabs and try again'));
    });
  }
  async function read(store, key) {
    const transaction = database.transaction(store, 'readonly');
    const done = transactionDone(transaction);
    const result = await requestResult(transaction.objectStore(store).get(key));
    await done;
    return result;
  }
  async function all(store) {
    const transaction = database.transaction(store, 'readonly');
    const done = transactionDone(transaction);
    const result = await requestResult(transaction.objectStore(store).getAll());
    await done;
    return result;
  }
  async function hash(value) {
    const bytes = typeof value === 'string' ? new TextEncoder().encode(value) : await value.arrayBuffer();
    return [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(byte => byte.toString(16).padStart(2, '0')).join('');
  }
  function sameExtensionUrl(url) {
    return url.protocol === location.protocol && url.host === location.host;
  }
  function pathOf(value) {
    try {
      const url = new URL(value, location.href);
      return sameExtensionUrl(url) ? url.pathname : null;
    } catch { return null; }
  }
  function resolveAssetUrl(raw) {
    const key = pathOf(raw);
    return key && objectUrls.has(key) ? objectUrls.get(key).url : raw;
  }
  function ownsMediaUrl(raw) {
    const value = String(raw);
    if ([...objectUrls.values()].some(entry => entry.url === value)) return true;
    const key = pathOf(value);
    return Boolean(key && (/^\/assets\/(captures|videos)\//.test(key)) && objectUrls.has(key));
  }
  function remember(path, blob, revision) {
    const previous = objectUrls.get(path);
    if (previous?.revision === revision) return;
    if (previous) URL.revokeObjectURL(previous.url);
    objectUrls.set(path, { url: URL.createObjectURL(blob), revision });
  }
  async function refreshMedia() {
    const entries = await all('media');
    for (const item of entries) remember(item.descriptor.mediaUrl, item.blob, item.descriptor.revisionId);
    return entries;
  }
  function motionMetadata(payload, kind, ext) {
    if (ext === '.octomotion.json') {
      const motion = payload?.motion;
      if (payload?.format !== 'octo-director-motion' || payload.version !== 1 || !motion || !['mixamo-fbx-v1', 'workrally-mixamo-fbx-v1', 'octo-mixamo-v1'].includes(motion.skeletonId) || motion.skeletonVersion !== 1 || !Number.isFinite(motion.durationSec) || motion.durationSec <= 0 || motion.durationSec > 3600 || !Array.isArray(motion.keyframes) || !motion.keyframes.length || motion.keyframes.length > 4096) throw new Error('Invalid exported pose');
      const first = motion.keyframes[0];
      const finiteObject = (value, axes) => value && axes.every(axis => Number.isFinite(value[axis]));
      if (typeof first.pose?.signature !== 'string' || !Array.isArray(first.pose.rotations) || !first.pose.rotations.length || first.pose.rotations.length > 256) throw new Error('Invalid pose rotations');
      for (const item of first.pose.rotations) if (!Number.isInteger(item.boneIndex) || item.boneIndex < 0 || item.boneIndex >= 65 || !finiteObject(item.rotation, ['x', 'y', 'z']) || !finiteObject(item.bindWorldRotation, ['x', 'y', 'z', 'w'])) throw new Error('Invalid pose rotations');
      if (first.rootTranslation && !finiteObject(first.rootTranslation, ['x', 'y', 'z'])) throw new Error('Invalid pose root translation');
      if (!motion.keyframes.every((frame, i) => Number.isFinite(frame.timeSec) && frame.timeSec >= 0 && frame.timeSec <= motion.durationSec && (!i || frame.timeSec >= motion.keyframes[i - 1].timeSec) && JSON.stringify(frame.pose) === JSON.stringify(first.pose) && JSON.stringify(frame.rootTranslation) === JSON.stringify(first.rootTranslation))) throw new Error('Pose file contains animation or invalid keyframes');
      return { durationSec: motion.durationSec, fps: 30, staticPose: true, skeletonId: motion.skeletonId, skeletonVersion: 1, poseFormat: 'octo-director-motion' };
    }
    if (payload?.format !== 'local-director-animation-clip' || payload.version !== 1 || payload.bones?.length !== 65 || !payload.bones.every(bone => typeof bone.name === 'string')) throw new Error('Invalid local motion reference rig');
    const clip = payload.clip;
    if (!clip || !Number.isFinite(clip.duration) || clip.duration <= 0 || clip.duration > 3600 || !Array.isArray(clip.tracks) || !clip.tracks.length || clip.tracks.length > 512) throw new Error('Invalid local motion clip');
    let staticPose = true;
    let values = 0;
    for (const track of clip.tracks) {
      const width = track.type === 'quaternion' ? 4 : track.type === 'vector' ? 3 : 0;
      if (!width || typeof track.name !== 'string' || !Array.isArray(track.times) || !track.times.length || !Array.isArray(track.values) || track.values.length !== track.times.length * width || !track.values.every(Number.isFinite) || !track.times.every((time, i) => Number.isFinite(time) && time >= 0 && time <= clip.duration + 0.00001 && (!i || time >= track.times[i - 1]))) throw new Error('Invalid local motion tracks');
      values += track.values.length;
      if (values > 8000000) throw new Error('Motion exceeds data limit');
      if (track.values.some((value, i) => Math.abs(value - track.values[i % width]) > 1e-7)) staticPose = false;
    }
    if (kind === 'poses' && !staticPose) throw new Error('Pose file contains animation; import it under motions');
    return { durationSec: clip.duration, fps: 30, trackCount: clip.tracks.length, staticPose };
  }
  async function scanAssets() {
    const revision = await read('records', 'asset-revision');
    if (catalog && revision === catalogRevision) return catalog;
    const files = (await all('files')).sort((a, b) => a.path.localeCompare(b.path));
    const result = { revision: '', root: 'Browser local asset library', directories: Object.fromEntries(groups.map(group => [group, group])), characters: [], models: [], motions: [], poses: [], issues: [], canOpenFolder: false };
    const fileMap = new Map(files.map(file => [file.path.toLowerCase(), file]));
    for (const file of files) remember(assetPath(file.path), file.blob, file.revision);
    for (const file of files) {
      const parts = file.path.split('/'), group = parts[0], ext = extension(file.path);
      if (!groupExtensions[group]?.has(ext)) continue;
      const stem = parts.at(-1).slice(0, -ext.length);
      const directory = parts.slice(0, -1).join('/') + '/';
      const assetId = 'folder-' + group + '-' + (await hash(file.path)).slice(0, 24);
      const entry = { id: assetId, assetId, displayName: stem, nameFallback: stem, source: 'folder', relativePath: file.path, folder: parts.slice(1, -1).join('/'), mediaUrl: assetPath(file.path), extension: ext, bytes: file.blob.size, revisionId: file.revision };
      if (group === 'models' || group === 'characters') {
        const resources = Object.create(null), basenames = new Map();
        const related = files.filter(resource => resource.path.startsWith(directory) && resourceExtensions.has(extension(resource.path)));
        for (const resource of related) {
          const relative = resource.path.slice(directory.length), url = assetPath(resource.path), name = resource.path.split('/').at(-1);
          resources[relative] = url; resources[url] = url;
          if (!basenames.has(name)) basenames.set(name, []);
          basenames.get(name).push(url);
        }
        for (const [name, urls] of basenames) if (urls.length === 1) resources[name] = urls[0];
        if (Object.keys(resources).length) entry.resources = resources;
        entry.revisionId = (await hash(file.revision + JSON.stringify(related.map(item => [item.path, item.revision])))).slice(0, 24);
      }
      if (group === 'motions' || group === 'poses') entry.motionUsage = 'direct';
      if (group === 'poses') entry.localPosePreset = true;
      if (ext === '.motion.json' || ext === '.octomotion.json') {
        try {
          if (file.blob.size > limits.json) throw new Error('JSON asset exceeds size limit');
          Object.assign(entry, motionMetadata(JSON.parse(await file.blob.text()), group, ext));
        } catch (error) { result.issues.push({ relativePath: file.path, message: error.message }); continue; }
      }
      for (const suffix of ['.png', '.jpg', '.jpeg', '.webp']) {
        const thumb = fileMap.get((directory + stem + suffix).toLowerCase());
        if (thumb) { entry.thumbnailUrl = resolveAssetUrl(assetPath(thumb.path)); break; }
      }
      entry.description = entry.descriptionFallback = entry.folder || group;
      result[group].push(entry);
    }
    result.revision = (await hash(JSON.stringify(files.map(file => [file.path, file.revision])))).slice(0, 24);
    catalog = result;
    catalogRevision = revision;
    return result;
  }
  async function importAssetFiles(input, options = {}) {
    await ready;
    return enqueue(async () => {
      const list = Array.from(input || []);
      if (!list.length || list.length > limits.files) throw new Error('Choose 1 to 10000 asset files');
      const prepared = new Map();
      let total = 0;
      for (const file of list) {
        let raw = file.webkitRelativePath || file.name;
        const segments = raw.replace(/\\/g, '/').split('/');
        const groupIndex = segments.findIndex(segment => groups.includes(segment));
        if (groupIndex >= 0) raw = segments.slice(groupIndex).join('/');
        else if (groups.includes(options.group)) raw = [options.group, ...segments.slice(segments.length > 1 ? 1 : 0)].join('/');
        else throw new Error('Select an Assets folder containing characters, models, motions and poses folders');
        if (!validPath(raw)) throw new Error('Invalid asset path: ' + raw);
        const type = mime[extension(raw)];
        if (!type || extension(raw) === '.mp4') continue;
        total += file.size;
        if (!file.size || file.size > limits.file || total > limits.total) throw new Error('Asset files exceed the 1 GB import limit');
        const blob = file.slice(0, file.size, type);
        prepared.set(raw, { path: raw, blob, revision: (await hash(blob)).slice(0, 32), modified: Number(file.lastModified) || Date.now() });
      }
      if (!prepared.size) throw new Error('No supported assets were selected');
      const transaction = database.transaction(['files', 'records'], 'readwrite');
      const done = transactionDone(transaction);
      for (const [key, value] of prepared) transaction.objectStore('files').put(value, key);
      transaction.objectStore('records').put(crypto.randomUUID(), 'asset-revision');
      await done;
      const snapshot = await scanAssets();
      window.dispatchEvent(new Event('local-director-assets-refresh'));
      return { imported: prepared.size, catalog: snapshot };
    });
  }
  async function compareAndSave(key, expectedVersion, value, writeId) {
    const transaction = database.transaction('records', 'readwrite');
    const done = transactionDone(transaction);
    const store = transaction.objectStore('records');
    const request = store.get(key);
    let response;
    request.onsuccess = () => {
      const current = request.result;
      if (writeId && current?.writeId === writeId) { response = json({ versionId: current.versionId }); return; }
      if (expectedVersion !== (current?.versionId || '0')) { response = failure('Saved data changed in another tab', 409); return; }
      const versionId = (BigInt(current?.versionId || '0') + 1n).toString();
      store.put({ versionId, ...value, ...(writeId ? { writeId } : {}) }, key);
      response = json({ versionId });
    };
    await done;
    return response;
  }
  function descriptor(item) { return { ...item.descriptor, mediaUrl: resolveAssetUrl(item.descriptor.mediaUrl) }; }
  async function setBackgroundDeleted(request, assetId) {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(assetId)) return failure('Invalid capture ID');
    const text = await request.text();
    if (new TextEncoder().encode(text).length > 1024) return failure('Background state exceeds size limit', 413);
    const payload = JSON.parse(text);
    if (!payload || typeof payload.deleted !== 'boolean') return failure('Invalid background state');
    return enqueue(async () => {
      const transaction = database.transaction('media', 'readwrite');
      const done = transactionDone(transaction);
      const store = transaction.objectStore('media');
      const request = store.get(assetId);
      let response;
      request.onsuccess = () => {
        const item = request.result;
        if (!item || item.kind !== 'captures') { response = failure('Capture not found', 404); return; }
        item.descriptor.backgroundDeleted = payload.deleted;
        store.put(item, assetId);
        response = json(descriptor(item));
      };
      await done;
      return response;
    });
  }
  async function saveMedia(request, kind) {
    const blob = await request.blob();
    const isVideo = kind === 'videos';
    const type = blob.type.split(';')[0];
    const ext = isVideo ? '.mp4' : ({ 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp' })[type];
    if (!ext || !blob.size || blob.size > (isVideo ? limits.file : limits.json) || (isVideo && !['video/mp4', 'application/mp4', 'application/octet-stream'].includes(type))) return failure('Invalid media file');
    const signature = new Uint8Array(await blob.slice(0, 12).arrayBuffer());
    const ascii = (start, end) => String.fromCharCode(...signature.slice(start, end));
    const valid = isVideo ? ascii(4, 8) === 'ftyp' : ext === '.jpg' ? signature[0] === 255 && signature[1] === 216 : ext === '.png' ? [137, 80, 78, 71, 13, 10, 26, 10].every((byte, i) => signature[i] === byte) : ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WEBP';
    if (!valid) return failure('Invalid media bytes');
    const prefix = isVideo ? 'X-Video-' : 'X-Capture-';
    const width = Number(request.headers.get(prefix + 'Width')), height = Number(request.headers.get(prefix + 'Height'));
    if (!isVideo && ![width, height].every(value => Number.isSafeInteger(value) && value > 0 && value <= 16384)) return failure('Invalid capture dimensions');
    const assetId = crypto.randomUUID();
    const entry = { assetId, revisionId: '1', mediaUrl: '/assets/' + kind + '/' + assetId + ext, extension: ext, title: decodeURIComponent(request.headers.get(prefix + 'Name') || (isVideo ? 'Video' : 'Capture')).slice(0, 240) };
    for (const [key, value] of Object.entries({ width, height, ...(isVideo ? { durationSec: Number(request.headers.get(prefix + 'Duration')), fps: Number(request.headers.get(prefix + 'Fps')) } : {}) })) if (Number.isFinite(value) && value > 0) entry[key] = value;
    const item = { kind, descriptor: entry, blob: blob.slice(0, blob.size, isVideo ? 'video/mp4' : type) };
    const transaction = database.transaction('media', 'readwrite');
    const done = transactionDone(transaction);
    transaction.objectStore('media').put(item, assetId);
    await done;
    remember(entry.mediaUrl, item.blob, entry.revisionId);
    return json(descriptor(item));
  }
  function bytesBase64(bytes) {
    let binary = '';
    for (let offset = 0; offset < bytes.length; offset += 32768) binary += String.fromCharCode(...bytes.subarray(offset, offset + 32768));
    return btoa(binary);
  }
  function decodeBlob(value, type) {
    if (typeof value !== 'string' || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value) || value.length > Math.ceil(limits.file / 3) * 4) throw new Error('Invalid backup file data');
    const binary = atob(value);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return new Blob([bytes], { type });
  }
  async function validMediaBytes(blob, extension, kind) {
    const signature = new Uint8Array(await blob.slice(0, 12).arrayBuffer());
    const ascii = (start, end) => String.fromCharCode(...signature.slice(start, end));
    return kind === 'videos'
      ? signature.length >= 8 && ascii(4, 8) === 'ftyp'
      : extension === '.jpg' || extension === '.jpeg' ? signature[0] === 255 && signature[1] === 216
        : extension === '.png' ? [137, 80, 78, 71, 13, 10, 26, 10].every((byte, index) => signature[index] === byte)
          : ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WEBP';
  }
  async function exportBackup() {
    await ready;
    return enqueue(async () => {
      const transaction = database.transaction(['records', 'files', 'media'], 'readonly');
      const done = transactionDone(transaction);
      const values = await Promise.all([
        requestResult(transaction.objectStore('records').get('document')),
        requestResult(transaction.objectStore('records').get('motion-library')),
        requestResult(transaction.objectStore('files').getAll()),
        requestResult(transaction.objectStore('media').getAll()),
      ]);
      await done;
      const [documentRecord, motionLibrary, files, media] = values;
      const serialize = async item => ({ ...item, blob: undefined, data: bytesBase64(new Uint8Array(await item.blob.arrayBuffer())), type: item.blob.type });
      const backup = { format: 'qihui-director-extension-backup', version: 1, createdAt: new Date().toISOString(), document: documentRecord || null, motionLibrary: motionLibrary || null, files: [], media: [] };
      for (const item of files) backup.files.push(await serialize(item));
      for (const item of media) backup.media.push(await serialize(item));
      return new Blob([JSON.stringify(backup)], { type: 'application/json' });
    });
  }
  async function importBackup(file) {
    await ready;
    return enqueue(async () => {
      if (!(file instanceof Blob) || !file.size || file.size > limits.total * 1.5) throw new Error('Invalid backup file size');
      const value = JSON.parse(await file.text());
      if (value?.format !== 'qihui-director-extension-backup' || value.version !== 1 || !Array.isArray(value.files) || !Array.isArray(value.media) || value.files.length > limits.files || value.media.length > limits.files) throw new Error('Invalid backup format');
      if (value.document !== null && (!validVersion(value.document?.versionId) || typeof value.document?.content !== 'string' || new TextEncoder().encode(value.document.content).length > limits.json)) throw new Error('Invalid project backup');
      if (value.document) JSON.parse(value.document.content);
      if (value.motionLibrary !== null && (!validVersion(value.motionLibrary?.versionId) || ![1, 2].includes(value.motionLibrary?.payload?.version) || !Array.isArray(value.motionLibrary.payload.motions) || value.motionLibrary.payload.motions.length > 256 || JSON.stringify(value.motionLibrary.payload).length > limits.json)) throw new Error('Invalid motion library backup');
      const files = [], media = [], usedPaths = new Set(), usedIds = new Set();
      let total = 0;
      for (const item of value.files) {
        if (!validPath(item.path) || !mime[extension(item.path)] || usedPaths.has(item.path)) throw new Error('Invalid asset backup');
        usedPaths.add(item.path);
        const blob = decodeBlob(item.data, mime[extension(item.path)]);
        if (!blob.size || (total += blob.size) > limits.total) throw new Error('Backup exceeds 1 GB');
        files.push({ path: item.path, blob, revision: (await hash(blob)).slice(0, 32), modified: Date.now() });
      }
      for (const item of value.media) {
        const entry = item.descriptor;
        if (!['captures', 'videos'].includes(item.kind) || !entry || typeof entry.assetId !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(entry.assetId) || usedIds.has(entry.assetId) || !validVersion(entry.revisionId) || !(item.kind === 'videos' ? ['.mp4'] : ['.jpg', '.jpeg', '.png', '.webp']).includes(entry.extension) || entry.mediaUrl !== '/assets/' + item.kind + '/' + entry.assetId + entry.extension || (item.kind === 'captures' && ![entry.width, entry.height].every(number => Number.isSafeInteger(number) && number > 0 && number <= 16384))) throw new Error('Invalid media backup');
        usedIds.add(entry.assetId);
        const blob = decodeBlob(item.data, mime[entry.extension]);
        if (!blob.size || (total += blob.size) > limits.total || !(await validMediaBytes(blob, entry.extension, item.kind))) throw new Error('Invalid media backup bytes');
        media.push({ kind: item.kind, descriptor: entry, blob });
      }
      // Validate the entire archive before replacing any of the three stores.
      const transaction = database.transaction(['records', 'files', 'media'], 'readwrite');
      const done = transactionDone(transaction);
      for (const store of ['records', 'files', 'media']) transaction.objectStore(store).clear();
      transaction.objectStore('records').put(crypto.randomUUID(), 'asset-revision');
      if (value.document) transaction.objectStore('records').put({ ...value.document, writeId: undefined, versionId: String(Date.now()) }, 'document');
      if (value.motionLibrary) transaction.objectStore('records').put({ ...value.motionLibrary, versionId: String(Date.now()) }, 'motion-library');
      for (const item of files) transaction.objectStore('files').put(item, item.path);
      for (const item of media) transaction.objectStore('media').put(item, item.descriptor.assetId);
      await done;
      for (const entry of objectUrls.values()) URL.revokeObjectURL(entry.url);
      objectUrls.clear();
      await refreshMedia();
      await scanAssets();
      return { files: files.length, media: media.length };
    });
  }
  async function route(request, url) {
    const pathname = url.pathname, method = request.method;
    if (pathname === '/api/info' && method === 'GET') return json({ versionId: (await read('records', 'document'))?.versionId });
    if (pathname === '/api/document') {
      if (method === 'GET') {
        const record = await read('records', 'document');
        if (!record) return failure('No project', 404);
        if (url.searchParams.has('version') && url.searchParams.get('version') !== record.versionId) return failure('Project changed', 409);
        return new Response(record.content, { headers: { 'Content-Type': 'application/octet-stream' } });
      }
      if (method === 'PUT') {
        const content = await request.text();
        if (new TextEncoder().encode(content).length > limits.json) return failure('Project exceeds size limit', 413);
        JSON.parse(content);
        return compareAndSave('document', request.headers.get('If-Match'), { content }, request.headers.get('X-Write-Id'));
      }
    }
    if (pathname === '/api/motion-library') {
      if (method === 'GET') return json((await read('records', 'motion-library')) || { versionId: '0', payload: { version: 1, motions: [] } });
      if (method === 'PUT') {
        const text = await request.text();
        if (new TextEncoder().encode(text).length > limits.json) return failure('Motion library exceeds size limit', 413);
        const payload = JSON.parse(text);
        if (![1, 2].includes(payload?.version) || !Array.isArray(payload.motions) || payload.motions.length > 256) return failure('Invalid motion library');
        return compareAndSave('motion-library', request.headers.get('If-Match'), { payload });
      }
    }
    if (pathname === '/api/assets/catalog' && method === 'GET') return json(await scanAssets());
    if (pathname === '/api/assets/refresh' && method === 'POST') return json(await scanAssets());
    if (pathname === '/api/assets/open') return failure('Import a folder using the browser asset library', 409);
    if (pathname === '/api/cz/session' && method === 'GET') return json({ configured: false, connected: false, baseUrl: '', username: '' });
    if (pathname.startsWith('/api/cz/')) return failure('Cloud canvas connection is available in the desktop application', 501);
    const backgroundCapture = /^\/api\/captures\/([^/]+)\/background$/.exec(pathname);
    if (backgroundCapture && method === 'PATCH') return setBackgroundDeleted(request, backgroundCapture[1]);
    if (pathname === '/api/captures' || pathname === '/api/videos') {
      const kind = pathname.slice('/api/'.length);
      if (method === 'GET') return json({ items: (await refreshMedia()).filter(item => item.kind === kind).map(descriptor) });
      if (method === 'POST') return saveMedia(request, kind);
    }
    if (pathname.startsWith('/local-assets/') && ['GET', 'HEAD'].includes(method)) {
      const path = pathname.slice('/local-assets/'.length).split('/').map(decodeURIComponent).join('/');
      if (!validPath(path)) return failure('Invalid asset path');
      const file = await read('files', path);
      return file ? new Response(method === 'HEAD' ? null : file.blob, { headers: { 'Content-Type': file.blob.type } }) : failure('Asset not found', 404);
    }
    if (/^\/assets\/(captures|videos)\//.test(pathname) && ['GET', 'HEAD'].includes(method)) {
      await refreshMedia();
      const target = objectUrls.get(pathname);
      return target ? nativeFetch(target.url, { method, signal: request.signal }) : failure('Media not found', 404);
    }
    return failure('Unsupported local API request', 404);
  }
  const ready = openDatabase().then(async db => {
    database = db;
    await refreshMedia();
    await scanAssets();
  });
  ready.catch(error => console.error('Browser local storage failed', error));
  window.fetch = async (input, init) => {
    const raw = input instanceof Request ? input.url : String(input);
    const url = new URL(raw, location.href);
    if (!sameExtensionUrl(url) || !(/^\/api\//.test(url.pathname) || /^\/local-assets\//.test(url.pathname) || /^\/assets\/(captures|videos)\//.test(url.pathname))) return nativeFetch(input, init);
    const request = input instanceof Request ? new Request(input, init) : new Request(url.href, init);
    request.signal.throwIfAborted();
    await ready;
    request.signal.throwIfAborted();
    try { return await route(request, url); }
    catch (error) {
      if (error?.name === 'AbortError') throw error;
      console.error('Browser local API failed', error);
      return failure(error.message || 'Local data operation failed', error instanceof SyntaxError || error instanceof URIError ? 400 : 500);
    }
  };
  window.localDirectorExtension = Object.freeze({ ready, importAssetFiles, exportBackup, importBackup, resolveAssetUrl, ownsMediaUrl });
})();
