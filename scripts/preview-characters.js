import * as THREE from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';

const status = document.querySelector('#status');
const save = document.querySelector('#save');
const thumbnails = [];
try {
  const [manifest, poses] = await Promise.all(['/manifest.json', '/poses.json'].map(url => fetch(url).then(response => response.json())));
  const renderer = new THREE.WebGLRenderer({antialias: true, preserveDrawingBuffer: true});
  renderer.setSize(320, 240);
  renderer.setPixelRatio(1);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.4;
  document.body.append(renderer.domElement);
  const camera = new THREE.PerspectiveCamera(30, 4 / 3, 0.05, 100);
  camera.position.set(0.8, 1.55, 4.9);
  camera.lookAt(0, 1.02, 0);
  for (const entry of manifest.characters) {
    const scene = new THREE.Scene();
    scene.background = new THREE.Color('#141719');
    scene.add(new THREE.HemisphereLight(0xeef5ff, 0x626b75, 2));
    const key = new THREE.DirectionalLight(0xffffff, 3.3);
    key.position.set(-2, 4, 3);
    key.castShadow = true;
    key.shadow.mapSize.set(1024, 1024);
    Object.assign(key.shadow.camera, {left: -2, right: 2, top: 3, bottom: -1, near: 0.1, far: 12});
    key.shadow.bias = -0.0003;
    scene.add(key);
    const rim = new THREE.DirectionalLight(0xb5ceff, 1.4);
    rim.position.set(2, 3, -2);
    scene.add(rim);
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(200, 200), new THREE.MeshStandardMaterial({color: '#252a2f', roughness: 1}));
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    scene.add(floor);
    const {scene: character} = await new GLTFLoader().loadAsync(entry.mediaUrl);
    scene.add(character);
    for (const pose of poses[entry.assetId]) {
      const bone = character.getObjectByName(pose.name);
      bone.position.fromArray(pose.position);
      bone.quaternion.fromArray(pose.quaternion);
      bone.scale.fromArray(pose.scale);
    }
    character.updateMatrixWorld(true);
    character.traverse(node => {if (node.isMesh) {node.castShadow = true;node.receiveShadow = true;}});
    const bounds = new THREE.Box3().setFromObject(character, true);
    character.position.y -= bounds.min.y;
    character.position.x -= (bounds.max.x + bounds.min.x) / 2;
    character.position.z -= (bounds.max.z + bounds.min.z) / 2;
    renderer.render(scene, camera);
    const image = new Image();
    image.src = renderer.domElement.toDataURL('image/png');
    image.alt = entry.displayName;
    const figure = document.createElement('figure');
    const caption = document.createElement('figcaption');
    caption.textContent = entry.displayName;
    figure.append(image, caption);
    document.querySelector('#cards').append(figure);
    thumbnails.push({name: entry.thumbnailUrl.split('/').at(-1), blob: await new Promise(resolve => renderer.domElement.toBlob(resolve, 'image/png'))});
    status.value = thumbnails.length + ' / ' + manifest.characters.length;
    scene.traverse(node => {
      if (node.geometry) node.geometry.dispose();
      if (node.material) for (const material of Array.isArray(node.material) ? node.material : [node.material]) material.dispose();
    });
  }
  renderer.dispose();
  save.disabled = false;
  save.addEventListener('click', async () => {
    save.disabled = true;
    try {
      for (const item of thumbnails) {
        const response = await fetch('/thumbnails/' + item.name, {method: 'POST', headers: {'Content-Type': 'image/png'}, body: item.blob});
        if (!response.ok) throw Error(await response.text());
      }
      status.value = thumbnails.length + ' thumbnails saved';
    } catch (error) {status.value = error.message;}
    finally {save.disabled = false;}
  });
} catch (error) {status.value = error.message;console.error(error);}
