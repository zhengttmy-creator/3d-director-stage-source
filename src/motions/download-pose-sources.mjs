import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';

const directory = fileURLToPath(new URL('../../sources/motions/poses/', import.meta.url));
const repository = 'nirholas/three.ws';
const commit = '8866e5471c1e25d41070f1e1992ecc1dbba80f22';
const files = [
  ['sitting-idle.fbx', 'character-studio/public/lora-assets/animations/SittingIdle.fbx'],
  ['female-sitting.fbx', 'character-studio/public/lora-assets/animations/FemaleSittingPose.fbx'],
  ['male-sitting.fbx', 'character-studio/public/lora-assets/animations/Male_Sitting_Pose_1.fbx'],
  ['kneeling-pointing.fbx', 'character-studio/public/lora-assets/animations/KneelingPointing.fbx'],
  ['kneeling-idle.fbx', 'animation-sources/kneeling idle.fbx'],
  ['sitting-clap.fbx', 'animation-sources/Sitting Clap.fbx'],
  ['sitting-down.fbx', 'character-studio/public/sprite-atlas-assets/animations/Sitting.fbx'],
];
await fs.mkdir(directory, {recursive: true});
const records = [];
for (const [name, remotePath] of files) {
  const encodedPath = remotePath.split('/').map(encodeURIComponent).join('/');
  const url = `https://raw.githubusercontent.com/${repository}/${commit}/${encodedPath}`;
  const downloadUrl = `https://cdn.jsdelivr.net/gh/${repository}@${commit}/${encodedPath}`;
  const response = await fetch(downloadUrl);
  if (!response.ok) throw new Error(`${response.status}: ${downloadUrl}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  await fs.writeFile(path.join(directory, name), bytes);
  records.push({name, url, downloadUrl, repository, commit, bytes: bytes.length, sha256});
  console.log(name, bytes.length, sha256);
}
await fs.writeFile(path.join(directory, 'sources.json'), JSON.stringify(records, null, 2) + '\n');
