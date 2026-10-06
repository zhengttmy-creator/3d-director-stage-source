import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import vm from 'node:vm';
import {THREE, loadSource, normalize, repositoryRoot, moduleFactoriesFile, motionsDirectory, targetModelFile} from '../src/motions/motion-source-utils.mjs';
import {originalRetargetClasses, makeMotionRig} from '../src/motions/original-retarget-utils.mjs';

const factories = JSON.parse(await fs.readFile(moduleFactoriesFile, 'utf8'));
const walk = JSON.parse(await fs.readFile(path.join(motionsDirectory, 'walk.motion.json'), 'utf8'));
const hierarchy = walk.bones.map(bone => ({name: bone.name, ...bone.parentIndex < 0 ? {} : {parentName: walk.bones[bone.parentIndex].name}}));
const classes = originalRetargetClasses(factories, hierarchy);
const aliases = {
  YJl: THREE.Group, $Kf: THREE.Bone, Pq0: THREE.Vector3, PTz: THREE.Quaternion,
  Iw4: THREE.AnimationMixer, Z58: THREE.Scene, dth: THREE.HemisphereLight,
  ZyN: THREE.DirectionalLight, ubm: THREE.PerspectiveCamera, fTw: THREE.GridHelper,
  eaF: THREE.Mesh, I46: THREE.SkinnedMesh, gPd: THREE.Texture, _4j: THREE.MeshStandardMaterial,
  NRn: THREE.Box3, O9p: THREE.Euler, iNn: THREE.BoxGeometry,
  cj9: THREE.MathUtils,
  KPJ: THREE.LoadingManager,
};
let rendererCount = 0;
class TestRenderer {
  constructor() { this.shadowMap = {}; rendererCount++; }
  setPixelRatio() {}
  setSize() {}
  setClearColor() {}
}
const context = vm.createContext({
  so: aliases,
  pN: {JeP: TestRenderer},
  pD: {w: class { loadAsync() { return loadSource(targetModelFile); } }},
  vb: classes.BindReference,
  vv: classes.Retargeter,
  lq: normalize,
  lV: hierarchy,
  URL,
  setTimeout,
  location: {href: 'http://127.0.0.1/'},
  pq: object => object.traverse(node => {
    if (!node.isMesh) return;
    node.geometry.dispose();
    for (const material of Array.isArray(node.material) ? node.material : [node.material]) material.dispose();
  }),
  __localDirectorLoadMotion: async assetPath => {
    const filename = path.basename(new URL(assetPath, 'http://127.0.0.1').pathname);
    const data = JSON.parse(await fs.readFile(path.join(motionsDirectory, filename), 'utf8'));
    const rig = makeMotionRig(data.bones);
    rig.scene.animations = [THREE.AnimationClip.parse(data.clip)];
    return rig.scene;
  },
});
const original = factories['53401'];
vm.runInContext(original.slice(original.indexOf('function lJ('), original.indexOf('function lY(')), context);
vm.runInContext(original.slice(original.indexOf('function l0('), original.indexOf('Object.freeze(lV.flatMap', original.indexOf('function l0('))), context);
vm.runInContext(original.slice(original.indexOf('function s6('), original.indexOf('function le(', original.indexOf('function s6('))), context);
vm.runInContext(original.slice(original.indexOf('function lr('), original.indexOf('function li(', original.indexOf('function lr('))), context);
const runtime = await fs.readFile(path.join(repositoryRoot, 'src/patches/motion-previews-runtime.js'), 'utf8');
vm.runInContext(runtime + '\nthis.previewService = __localMotionPreviewService;', context);
const service = context.previewService;
const manifest = JSON.parse(await fs.readFile(path.join(motionsDirectory, 'manifest.json'), 'utf8'));
const results = [];
for (const motion of manifest.motions.filter(motion => motion.motionUsage === 'direct')) {
  const prepared = await service.prepare({entry: {selection: {motion: {...motion, assetPath: motion.mediaUrl}}}});
  const samples = [];
  for (const fraction of [0, 0.23, 0.51, 0.77]) {
    service.pose(prepared, prepared.duration * fraction);
    const positions = [];
    service.model.traverse(node => {
      if (!node.isSkinnedMesh || !node.visible) return;
      for (const weighted of node.skeleton.bones) {
        const canonical = service.bones.find(bone => normalize(bone.name) === normalize(weighted.name));
        assert.ok(canonical, 'Every weighted joint must map to a canonical animation joint');
        assert.ok(weighted.getWorldPosition(new THREE.Vector3()).distanceTo(canonical.getWorldPosition(new THREE.Vector3())) < 1e-5, `${motion.assetId}: weighted joint must follow its canonical parent without doubled translation`);
        assert.ok(weighted.getWorldQuaternion(new THREE.Quaternion()).normalize().angleTo(canonical.getWorldQuaternion(new THREE.Quaternion()).normalize()) < 1e-5, `${motion.assetId}: ${weighted.name} must not receive its rotation twice`);
      }
      const count = node.geometry.attributes.position.count;
      for (let index = 0; index < count; index += Math.max(1, Math.floor(count / 80))) {
        positions.push(node.getVertexPosition(index, new THREE.Vector3()).applyMatrix4(node.matrixWorld));
      }
    });
    samples.push(positions);
    assert.ok(positions.length > 10, 'The preview must contain actual skinned character geometry');
    assert.ok(positions.every(position => position.toArray().every(Number.isFinite)));
    const direction = new THREE.Vector3(0.7, 0.3, 1.8).normalize();
    service.camera.position.copy(prepared.center).addScaledVector(direction, prepared.distance);
    service.camera.lookAt(prepared.center);
    service.camera.updateMatrixWorld(true);
    for (const position of positions) {
      const projected = position.clone().project(service.camera);
      assert.ok(Math.abs(projected.x) < 0.98 && Math.abs(projected.y) < 0.98, `${motion.assetId} must fit fully in the thumbnail`);
    }
  }
  let movement = 0;
  for (const sample of samples.slice(1)) for (let index = 0; index < sample.length; index++) movement = Math.max(movement, sample[index].distanceTo(samples[0][index]));
  assert.ok(movement > 0.005, `${motion.assetId} must visibly move actual skin vertices`);
  results.push({id: motion.assetId, sampledVertices: samples[0].length, maxVertexMovementMeters: Number(movement.toFixed(4)), framed: true});
}
const savedPose = {
  id: 'pose-preview-regression', durationSec: 1, loop: false, source: 'recorded',
  locomotion: {mode: 'embedded'},
  keyframes: [0, 1].map(timeSec => ({timeSec, rootTranslation: {x: 0, y: -28.5, z: 0}, pose: {
    signature: 'preview-test-rig',
    rotations: service.bones.map((bone, index) => ({
      boneIndex: index,
      rotation: {x: index === 55 ? 45 : 0, y: 0, z: 0},
      bindWorldRotation: Object.fromEntries(['x', 'y', 'z', 'w'].map(axis => [axis, service.bindWorldRotations[index][axis]])),
    })),
  }})),
};
const posePreview = await service.prepare({savedMotion: savedPose});
service.pose(posePreview, 0.4);
assert.ok(Math.abs(service.bones[0].position.y - (service.bindPositions[0].y - 28.5)) < 1e-9, 'Saved pose root translation must remain a bind-relative offset');
for (let index = 0; index < service.bones.length; index++) {
  const expected = service.bindRotations[index].clone();
  if (index === 55) expected.multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(Math.PI / 4, 0, 0)));
  assert.ok(service.bones[index].quaternion.clone().normalize().angleTo(expected.normalize()) < 1e-6, 'Saved pose preview must apply bind-relative rotations exactly once');
}
assert.equal(rendererCount, 1, 'All thumbnails must reuse one WebGL renderer');
console.log(JSON.stringify({previewRendererInstances: rendererCount, savedPoseBindRelativePreview: true, motions: results.length, results}, null, 2));
