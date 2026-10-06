import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import { loadSource, THREE, repositoryRoot } from '../motions/motion-source-utils.mjs';
import { bodyPresets, createBodyPreset } from './body-presets.mjs';

if (!globalThis.FileReader) globalThis.FileReader = class {
  readAsArrayBuffer(blob) { blob.arrayBuffer().then(result => { this.result = result; this.onloadend?.(); }).catch(error => this.onerror?.(error)); }
  readAsDataURL(blob) { blob.arrayBuffer().then(result => { this.result = `data:${blob.type};base64,${Buffer.from(result).toString('base64')}`; this.onloadend?.(); }).catch(error => this.onerror?.(error)); }
};

export async function buildBodyPresets() {
  const directory = path.join(repositoryRoot, 'web/assets/characters');
  await fs.mkdir(directory, { recursive: true });
  const motion = JSON.parse(await fs.readFile(path.join(repositoryRoot, 'web/assets/motions/walk.motion.json'), 'utf8'));
  const sources = {
    male: await loadSource(path.join(repositoryRoot, 'web/assets/character.fbx')),
    female: await loadSource(path.join(repositoryRoot, 'sources/motions/mixamo.fbx')),
  };
  const characters = [];
  for (const preset of bodyPresets) {
    const scene = createBodyPreset(sources[preset.gender], motion.bones, preset);
    const binary = await new GLTFExporter().parseAsync(scene, { binary: true, animations: [], onlyVisible: false });
    const filename = `${preset.id}.glb`;
    await fs.writeFile(path.join(directory, filename), Buffer.from(binary));
    const loaded = await loadSource(path.join(directory, filename));
    loaded.updateMatrixWorld(true);
    const bounds = new THREE.Box3().setFromObject(loaded, true);
    const size = bounds.getSize(new THREE.Vector3());
    const bones = [];
    loaded.traverse(node => { if (node.isBone) bones.push(node.name); });
    if (bones.length !== 65 || new Set(bones).size !== 65 || Math.abs(size.y - preset.heightMeters) > 0.001 || Math.abs(bounds.min.y) > 0.001) throw new Error(`Invalid round-trip body preset: ${preset.id}`);
    characters.push({
      assetId: preset.assetId,
      displayName: preset.displayName,
      nameFallback: preset.displayName,
      description: preset.description,
      thumbnailUrl: `/assets/characters/${preset.id}.png`,
      mediaUrl: `/assets/characters/${filename}`,
      extension: '.glb',
      localAssetKind: 'character',
      heightMeters: preset.heightMeters,
      gender: preset.gender,
      bodyType: preset.bodyType,
    });
    console.log(`${preset.id}: ${binary.byteLength} bytes, ${bones.length} bones, ${size.toArray().map(value => value.toFixed(3)).join(' x ')} m`);
  }
  await fs.writeFile(path.join(directory, 'manifest.json'), JSON.stringify({ format: 'local-director-character-catalog', version: 1, characters }, null, 2) + '\n');
  return characters;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await buildBodyPresets();
