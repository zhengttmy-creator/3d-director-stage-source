import fs from 'node:fs/promises';
import path from 'node:path';
import http from 'node:http';
import {fileURLToPath} from 'node:url';
import {THREE, loadSource} from '../src/motions/motion-source-utils.mjs';

const repo = fileURLToPath(new URL('../', import.meta.url));
const assets = path.join(repo, 'web/assets/characters');
const manifest = JSON.parse(await fs.readFile(path.join(assets, 'manifest.json'), 'utf8'));
const poses = {};
for (const entry of manifest.characters) {
  const scene = await loadSource(path.join(repo, 'web', entry.mediaUrl));
  scene.updateMatrixWorld(true);
  const bones = [];
  scene.traverse(node => {if (node.isBone) bones.push(node);});
  for (const side of ['Left', 'Right']) {
    const arm = scene.getObjectByName('mixamorig' + side + 'Arm');
    const elbow = scene.getObjectByName('mixamorig' + side + 'ForeArm');
    if (!arm || !elbow) throw Error('Missing preset skeleton: ' + entry.assetId);
    const direction = elbow.getWorldPosition(new THREE.Vector3()).sub(arm.getWorldPosition(new THREE.Vector3())).normalize();
    const neutral = new THREE.Vector3(Math.sign(direction.x) * 0.2, -1, 0.02).normalize();
    const delta = new THREE.Quaternion().setFromUnitVectors(direction, neutral);
    const world = arm.getWorldQuaternion(new THREE.Quaternion()).premultiply(delta);
    arm.quaternion.copy(arm.parent.getWorldQuaternion(new THREE.Quaternion()).invert().multiply(world));
    scene.updateMatrixWorld(true);
  }
  poses[entry.assetId] = bones.map(bone => ({name: bone.name, position: bone.position.toArray(), quaternion: bone.quaternion.toArray(), scale: bone.scale.toArray()}));
}
const thumbnailNames = new Set(manifest.characters.map(entry => path.basename(entry.thumbnailUrl)));
const types = {'.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json', '.glb': 'model/gltf-binary', '.png': 'image/png'};
const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://127.0.0.1');
    const send = (data, type) => {res.writeHead(200, {'Content-Type': type, 'Cache-Control': 'no-store'});res.end(data);};
    if (req.method === 'POST' && url.pathname.startsWith('/thumbnails/')) {
      const name = url.pathname.slice('/thumbnails/'.length);
      if (!thumbnailNames.has(name)) throw Error('Unknown thumbnail');
      const chunks = [];
      let length = 0;
      for await (const chunk of req) {
        length += chunk.length;
        if (length > 1024 * 1024) throw Error('Image too large');
        chunks.push(chunk);
      }
      const image = Buffer.concat(chunks);
      if (!image.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) throw Error('Invalid PNG');
      await fs.writeFile(path.join(assets, name), image);
      return send(JSON.stringify({saved: name}), types['.json']);
    }
    if (req.method !== 'GET') throw Error('GET required');
    if (url.pathname === '/poses.json') return send(JSON.stringify(poses), types['.json']);
    if (url.pathname === '/manifest.json') return send(JSON.stringify(manifest), types['.json']);
    let root, relative;
    if (url.pathname === '/') {root = path.join(repo, 'scripts');relative = 'preview-characters.html';}
    else if (url.pathname === '/preview.js') {root = path.join(repo, 'scripts');relative = 'preview-characters.js';}
    else if (url.pathname.startsWith('/three/')) {root = path.join(repo, 'node_modules/three');relative = decodeURIComponent(url.pathname.slice(7));}
    else if (url.pathname.startsWith('/assets/characters/')) {root = assets;relative = decodeURIComponent(url.pathname.slice('/assets/characters/'.length));}
    else throw Error('Not found');
    const file = path.resolve(root, relative);
    const normalized = path.relative(root, file);
    if (normalized.startsWith('..') || path.isAbsolute(normalized)) throw Error('Invalid path');
    return send(await fs.readFile(file), types[path.extname(file)] || 'application/octet-stream');
  } catch (error) {res.writeHead(400, {'Content-Type': 'text/plain'});res.end(error.message);}
});
const port = Number(process.argv[2] || 4212);
server.listen(port, '127.0.0.1', () => console.log('Character thumbnail studio: http://127.0.0.1:' + port));
