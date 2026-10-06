import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';

const groups = ['characters', 'models', 'motions', 'poses'];
const groupExtensions = {
  characters: new Set(['.fbx']),
  models: new Set(['.fbx', '.glb', '.gltf']),
  motions: new Set(['.fbx', '.motion.json']),
  poses: new Set(['.motion.json', '.octomotion.json']),
};
const types = {'.fbx': 'application/octet-stream', '.glb': 'model/gltf-binary', '.gltf': 'model/gltf+json', '.bin': 'application/octet-stream', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif', '.bmp': 'image/bmp', '.tga': 'application/octet-stream', '.dds': 'application/octet-stream', '.ktx': 'image/ktx', '.ktx2': 'image/ktx2', '.hdr': 'application/octet-stream', '.exr': 'application/octet-stream', '.motion.json': 'application/json', '.octomotion.json': 'application/json'};
const resourceExtensions = new Set(['.bin', '.png', '.jpg', '.jpeg', '.webp', '.gif', '.bmp', '.tga', '.dds', '.ktx', '.ktx2', '.hdr', '.exr']);
const hash = value => createHash('sha256').update(value).digest('hex');
const extension = name => /\.(?:octomotion|motion)\.json$/i.exec(name)?.[0].toLowerCase() || path.extname(name).toLowerCase();
const safeSegment = segment => Boolean(segment) && segment !== '.' && segment !== '..' && !segment.startsWith('.') && !/[\\/:\x00-\x1f\x7f]/.test(segment) && !/[ .]$/.test(segment) && !/^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(segment);
const inside = (root, file) => { const relative = path.relative(root, file); return relative !== '' && !path.isAbsolute(relative) && relative !== '..' && !relative.startsWith('..' + path.sep); };
const assetUrl = segments => '/local-assets/' + segments.map(encodeURIComponent).join('/');

function clipMetadata(payload, kind) {
  if (payload?.format !== 'local-director-animation-clip' || payload.version !== 1 || payload.bones?.length !== 65 || !payload.bones.every(bone => typeof bone.name === 'string')) throw Error('Invalid local motion reference rig');
  const clip = payload.clip;
  if (!clip || !Number.isFinite(clip.duration) || clip.duration <= 0 || clip.duration > 3600 || !Array.isArray(clip.tracks) || !clip.tracks.length || clip.tracks.length > 512) throw Error('Invalid local motion clip');
  let staticPose = true;
  let values = 0;
  for (const track of clip.tracks) {
    const width = track.type === 'quaternion' ? 4 : track.type === 'vector' ? 3 : 0;
    if (!width || typeof track.name !== 'string' || !Array.isArray(track.times) || !track.times.length || !Array.isArray(track.values) || track.values.length !== track.times.length * width || !track.values.every(Number.isFinite) || !track.times.every((time, i) => Number.isFinite(time) && time >= 0 && time <= clip.duration + 0.00001 && (!i || time >= track.times[i - 1]))) throw Error('Invalid local motion tracks');
    values += track.values.length;
    if (values > 8000000) throw Error('Motion exceeds data limit');
    if (track.values.some((value, i) => Math.abs(value - track.values[i % width]) > 1e-7)) staticPose = false;
  }
  if (kind === 'poses' && !staticPose) throw Error('Pose file contains animation; use the motions folder');
  return {durationSec: clip.duration, fps: 30, trackCount: clip.tracks.length, staticPose};
}

function octoMetadata(payload) {
  const motion = payload?.motion;
  if (payload?.format !== 'octo-director-motion' || payload.version !== 1 || !motion || !['mixamo-fbx-v1', 'workrally-mixamo-fbx-v1', 'octo-mixamo-v1'].includes(motion.skeletonId) || motion.skeletonVersion !== 1 || !Number.isFinite(motion.durationSec) || motion.durationSec <= 0 || motion.durationSec > 3600 || !Array.isArray(motion.keyframes) || !motion.keyframes.length || motion.keyframes.length > 4096) throw Error('Invalid exported pose');
  const first = motion.keyframes[0];
  if (typeof first.pose?.signature !== 'string' || !Array.isArray(first.pose.rotations) || !first.pose.rotations.length || first.pose.rotations.length > 256) throw Error('Invalid exported pose rotations');
  const finiteObject = (value, axes) => value && axes.every(axis => Number.isFinite(value[axis]));
  for (const item of first.pose.rotations) if (!Number.isInteger(item.boneIndex) || item.boneIndex < 0 || item.boneIndex >= 65 || !finiteObject(item.rotation, ['x', 'y', 'z']) || !finiteObject(item.bindWorldRotation, ['x', 'y', 'z', 'w'])) throw Error('Invalid exported pose rotations');
  if (first.rootTranslation && !finiteObject(first.rootTranslation, ['x', 'y', 'z'])) throw Error('Invalid exported pose root translation');
  const pose = JSON.stringify(first.pose), translation = JSON.stringify(first.rootTranslation);
  if (!motion.keyframes.every((frame, i) => Number.isFinite(frame.timeSec) && frame.timeSec >= 0 && frame.timeSec <= motion.durationSec && (!i || frame.timeSec >= motion.keyframes[i - 1].timeSec) && JSON.stringify(frame.pose) === pose && JSON.stringify(frame.rootTranslation) === translation)) throw Error('Pose file contains animation or invalid keyframes');
  return {durationSec: motion.durationSec, fps: 30, staticPose: true, skeletonId: motion.skeletonId, skeletonVersion: motion.skeletonVersion, poseFormat: 'octo-director-motion'};
}

export function createAssetLibrary({assetsRoot, cacheMs = 5000, maxFiles = 10000, maxDepth = 12, maxJsonBytes = 16 * 1024 * 1024} = {}) {
  if (typeof assetsRoot !== 'string' || !assetsRoot) throw new TypeError('assetsRoot is required');
  const configuredRoot = path.resolve(assetsRoot);
  let root, initialized, cached, expiresAt = 0, pending, closed = false;
  let invalidation = 0;

  async function initialize() {
    if (closed) throw Error('Asset library is closed');
    if (initialized) return initialized;
    initialized = (async () => {
      await fs.mkdir(configuredRoot, {recursive: true});
      const stat = await fs.lstat(configuredRoot);
      if (stat.isSymbolicLink() || !stat.isDirectory()) throw Error('Asset library root must be a real directory');
      root = await fs.realpath(configuredRoot);
      for (const group of groups) {
        const directory = path.join(root, group);
        try {
          const item = await fs.lstat(directory);
          if (!item.isDirectory() || item.isSymbolicLink()) continue;
        } catch (error) {
          if (error.code !== 'ENOENT') throw error;
          await fs.mkdir(directory);
        }
      }
    })().catch(error => { initialized = undefined; throw error; });
    return initialized;
  }

  async function verifiedFile(segments) {
    if (!groups.includes(segments[0]) || segments.length < 2 || !segments.every(safeSegment)) return null;
    const rootStat = await fs.lstat(root);
    if (!rootStat.isDirectory() || rootStat.isSymbolicLink() || await fs.realpath(root) !== root) return null;
    let candidate = root;
    let stat;
    for (let index = 0; index < segments.length; index++) {
      candidate = path.join(candidate, segments[index]);
      stat = await fs.lstat(candidate);
      if (stat.isSymbolicLink() || (index < segments.length - 1 && !stat.isDirectory())) return null;
    }
    if (!stat.isFile()) return null;
    const real = await fs.realpath(candidate);
    if (!inside(root, real)) return null;
    return {path: real, stat};
  }

  async function resolveFile(urlPath) {
    await initialize();
    if (typeof urlPath !== 'string' || !urlPath.startsWith('/local-assets/')) return null;
    let segments;
    try { segments = urlPath.slice('/local-assets/'.length).split('/').map(decodeURIComponent); }
    catch { return null; }
    if (!segments.every(safeSegment)) return null;
    const type = types[extension(segments.at(-1))];
    if (!type) return null;
    try {
      const file = await verifiedFile(segments);
      return file ? {path: file.path, contentType: type, size: file.stat.size} : null;
    } catch (error) {
      if (['ENOENT', 'ENOTDIR', 'EACCES', 'EPERM', 'ELOOP'].includes(error.code)) return null;
      throw error;
    }
  }

  async function readCatalog() {
    await initialize();
    const result = {revision: '', root, directories: Object.fromEntries(groups.map(group => [group, path.join(root, group)])), characters: [], models: [], motions: [], poses: [], issues: []};
    const allFiles = new Map();
    let visited = 0;
    const issue = (relativePath, code, message) => result.issues.push({relativePath, code, message});
    async function walk(group, segments = [group], depth = 0) {
      if (depth > maxDepth) { issue(segments.join('/'), 'depth-limit', 'Folder nesting is too deep'); return; }
      const directory = path.join(root, ...segments);
      let entries;
      try {
        const stat = await fs.lstat(directory);
        if (stat.isSymbolicLink() || !stat.isDirectory()) { issue(segments.join('/'), 'linked-directory', 'Linked folders are not scanned'); return; }
        if (!inside(root, await fs.realpath(directory))) return;
        entries = await fs.readdir(directory, {withFileTypes: true});
      } catch (error) { issue(segments.join('/'), 'unreadable-directory', error.code || 'Unable to read directory'); return; }
      entries.sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0);
      for (const entry of entries) {
        if (!safeSegment(entry.name)) continue;
        if (++visited > maxFiles) { issue(segments.join('/'), 'file-limit', 'Asset library file limit exceeded'); return; }
        const next = [...segments, entry.name];
        if (entry.isSymbolicLink()) { issue(next.join('/'), 'linked-file', 'Linked files are not scanned'); continue; }
        if (entry.isDirectory()) { await walk(group, next, depth + 1); continue; }
        if (!entry.isFile() || !types[extension(entry.name)]) continue;
        try {
          const verified = await verifiedFile(next);
          if (verified) allFiles.set(next.join('/'), {...verified, segments: next, group, extension: extension(entry.name)});
        } catch (error) { issue(next.join('/'), 'unreadable-file', error.code || 'Unable to read file'); }
      }
    }
    for (const group of groups) await walk(group);
    const filesByLowercasePath = new Map([...allFiles].map(([name, file]) => [name.toLowerCase(), file]));
    const resourcesByDirectory = new Map();
    for (const file of allFiles.values()) {
      if (!['characters', 'models'].includes(file.group) || !resourceExtensions.has(file.extension)) continue;
      for (let length = 1; length < file.segments.length; length++) {
        const directory = file.segments.slice(0, length).join('/');
        if (!resourcesByDirectory.has(directory)) resourcesByDirectory.set(directory, []);
        resourcesByDirectory.get(directory).push(file);
      }
    }
    const resourceMaps = new Map();
    for (const [relativePath, file] of allFiles) {
      if (!groupExtensions[file.group].has(file.extension)) continue;
      const basename = file.segments.at(-1);
      const stem = basename.slice(0, -file.extension.length);
      const assetId = `folder-${file.group}-${hash(relativePath).slice(0, 24)}`;
      const entry = {id: assetId, assetId, displayName: stem, nameFallback: stem, source: 'folder', relativePath, folder: file.segments.slice(1, -1).join('/'), mediaUrl: assetUrl(file.segments), extension: file.extension, bytes: file.stat.size, revisionId: hash(`${file.stat.size}:${file.stat.mtimeMs}:${file.stat.ctimeMs}`).slice(0, 20)};
      if (['characters', 'models'].includes(file.group)) {
        const directory = file.segments.slice(0, -1).join('/');
        let mapped = resourceMaps.get(directory);
        if (!mapped) {
          const files = resourcesByDirectory.get(directory) || [];
          const resources = Object.create(null);
          const basenames = new Map();
          for (const resource of files) {
            const relative = resource.segments.slice(file.segments.length - 1).join('/');
            const url = assetUrl(resource.segments);
            resources[relative] = url;
            resources[url] = url;
            const name = resource.segments.at(-1);
            if (!basenames.has(name)) basenames.set(name, []);
            basenames.get(name).push(url);
          }
          for (const [name, urls] of basenames) if (urls.length === 1) resources[name] = urls[0];
          mapped = {resources, revision: hash(JSON.stringify(files.map(resource => [resource.segments, resource.stat.size, resource.stat.mtimeMs, resource.stat.ctimeMs])))};
          resourceMaps.set(directory, mapped);
        }
        if (Object.keys(mapped.resources).length) entry.resources = mapped.resources;
        entry.revisionId = hash(entry.revisionId + ':' + mapped.revision).slice(0, 20);
      }
      if (['motions', 'poses'].includes(file.group)) entry.motionUsage = 'direct';
      if (file.group === 'poses') entry.localPosePreset = true;
      if (file.extension.endsWith('.json')) {
        try {
          if (file.stat.size > maxJsonBytes) throw Error('JSON asset exceeds size limit');
          const payload = JSON.parse(await fs.readFile(file.path, 'utf8'));
          Object.assign(entry, file.extension === '.octomotion.json' ? octoMetadata(payload) : clipMetadata(payload, file.group));
        } catch (error) { issue(relativePath, 'invalid-asset', error.message); continue; }
      }
      for (const suffix of ['.png', '.jpg', '.jpeg', '.webp']) {
        const thumbnail = [...file.segments.slice(0, -1), stem + suffix].join('/');
        const thumb = allFiles.get(thumbnail) || filesByLowercasePath.get(thumbnail.toLowerCase());
        if (thumb) { entry.thumbnailUrl = assetUrl(thumb.segments); break; }
      }
      entry.description = entry.folder || file.group;
      entry.descriptionFallback = entry.description;
      result[file.group].push(entry);
    }
    result.revision = hash(JSON.stringify({files: [...allFiles].map(([name, file]) => [name, file.stat.size, file.stat.mtimeMs, file.stat.ctimeMs]), issues: result.issues})).slice(0, 24);
    return result;
  }

  async function scan({refresh = false} = {}) {
    if (closed) throw Error('Asset library is closed');
    if (refresh) { invalidation++; expiresAt = 0; if (pending) await pending; }
    if (!refresh && cached && Date.now() < expiresAt) return structuredClone(cached);
    if (!pending) {
      const generation = invalidation;
      pending = readCatalog().then(catalog => { cached = catalog; expiresAt = generation === invalidation ? Date.now() + Math.max(0, cacheMs) : 0; return catalog; }).finally(() => { pending = undefined; });
    }
    return structuredClone(await pending);
  }
  return {initialize, scan, resolveFile, invalidate() { invalidation++; expiresAt = 0; }, close() { closed = true; cached = undefined; expiresAt = 0; }};
}
