import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';

const directory = fileURLToPath(new URL('../../sources/motions/', import.meta.url));
const catalogFile = path.join(directory, 'sources.json');
const catalog = JSON.parse(await fs.readFile(catalogFile, 'utf8'));
const sourceFiles = [
  ['xbot.glb', 'mrdoob/three.js', '1a1c86699f9c38d4bef1cf51652e5f0e0680d745', 'examples/models/gltf/Xbot.glb'],
  ['jump.fbx', 'aaronsnoswell/3DCharacter', '1902fb9674350f2b68b5a26b8eccd64570ac8dd4', 'Mixamo/Jump.fbx'],
  ...[
    ['roll', 'Roll'],
    ['dodge-back', 'Dodging Back'],
    ['crouch-down', 'Standing To Crouched'],
    ['stand-up', 'Crouched To Standing'],
    ['sneak', 'Sneaking Forward'],
    ['strafe-left', 'Left Strafe Walking'],
    ['strafe-right', 'Right Strafe Walking'],
    ['falling-idle', 'Falling Idle'],
  ].map(([id, name]) => [id + '.fbx', 'aaronsnoswell/3DCharacter', '1902fb9674350f2b68b5a26b8eccd64570ac8dd4', 'Mixamo/' + name + '.fbx']),
];

for (const [name, repository, commit, file] of sourceFiles) {
  const url = `https://raw.githubusercontent.com/${repository}/${commit}/${file.split('/').map(encodeURIComponent).join('/')}`;
  const downloadUrl = `https://cdn.jsdelivr.net/gh/${repository}@${commit}/${file.split('/').map(encodeURIComponent).join('/')}`;
  const response = await fetch(downloadUrl);
  if (!response.ok) throw new Error(`${response.status}: ${url}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  await fs.writeFile(path.join(directory, name), bytes);
  const record = {name, url, downloadUrl, repository, commit, bytes: bytes.length, sha256};
  const existing = catalog.findIndex(entry => entry.name === name);
  if (existing < 0) catalog.push(record);
  else catalog[existing] = record;
  console.log(name, bytes.length, sha256);
}
await fs.writeFile(catalogFile, JSON.stringify(catalog, null, 2) + '\n');
