import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as THREE from 'three';
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

export { THREE };
export { retarget } from 'three/addons/utils/SkeletonUtils.js';
export const repositoryRoot = fileURLToPath(new URL('../../', import.meta.url));
export const moduleFactoriesFile = path.join(repositoryRoot, 'src/vendor/module-factories.json');
export const motionsDirectory = path.join(repositoryRoot, 'web/assets/motions');
export const targetModelFile = path.join(repositoryRoot, 'web/assets/character.fbx');
export const reportsDirectory = path.join(repositoryRoot, 'reports/motions');

globalThis.fetch = async () => { throw new Error('Motion conversion only loads local source data'); };
globalThis.window = { URL };
globalThis.self = globalThis;

export async function loadSource(file) {
  const bytes = await fs.readFile(file);
  const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  const manager = new THREE.LoadingManager();
  manager.addHandler(/.*/, {setPath() {return this;}, load(uri, onLoad) {const texture = new THREE.Texture(); queueMicrotask(() => onLoad?.(texture)); return texture;}});
  if (path.extname(file).toLowerCase() === '.glb') {
    const loader = new GLTFLoader(manager);
    loader.register(() => ({name:'LOCAL_MOTION_TEXTURE_SKIP', loadTexture() {return Promise.resolve(new THREE.Texture());}}));
    const loaded = await loader.parseAsync(buffer, '');
    loaded.scene.animations = loaded.animations;
    return loaded.scene;
  }
  return new FBXLoader(manager).parse(buffer, '');
}

export const normalize = name => name.replace(/[^a-z0-9]/gi, '').toLowerCase();
