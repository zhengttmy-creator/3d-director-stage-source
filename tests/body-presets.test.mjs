import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { loadSource, THREE, repositoryRoot } from '../src/motions/motion-source-utils.mjs';
import { bodyPresets } from '../src/characters/body-presets.mjs';

const directory = path.join(repositoryRoot, 'web/assets/characters');
const manifest = JSON.parse(await fs.readFile(path.join(directory, 'manifest.json'), 'utf8'));
const hierarchy = JSON.parse(await fs.readFile(path.join(repositoryRoot, 'web/assets/motions/walk.motion.json'), 'utf8')).bones;
assert.equal(manifest.format, 'local-director-character-catalog');
assert.equal(manifest.version, 1);
assert.equal(manifest.characters.length, 12);
assert.deepEqual(manifest.characters.map(entry => entry.assetId), bodyPresets.map(entry => entry.assetId));

const reports = new Map();
for (const entry of manifest.characters) {
  const scene = await loadSource(path.join(directory, path.basename(entry.mediaUrl)));
  scene.updateMatrixWorld(true);
  assert.equal(scene.animations.length, 0, 'A body preset must not start an embedded animation');
  const bones = new Map();
  const meshes = [];
  scene.traverse(node => {
    if (node.isBone) { assert.ok(!bones.has(node.name)); bones.set(node.name, node); }
    if (node.isSkinnedMesh) meshes.push(node);
  });
  assert.equal(bones.size, 65);
  assert.equal(meshes.length, 2);
  assert.ok(meshes.every(mesh => mesh.name.startsWith(entry.gender === 'male' ? 'Alpha_' : 'Beta_')), 'Gender labels must match the verified source mesh silhouettes');
  for (const joint of hierarchy) {
    const bone = bones.get(joint.name);
    assert.ok(bone, joint.name);
    if (joint.parentIndex >= 0) assert.equal(bone.parent.name, hierarchy[joint.parentIndex].name);
  }
  assert.ok(bones.get('mixamorigHips').position.length() > 40, 'Local skeleton positions must remain in centimetres for the existing retargeter');
  const bounds = new THREE.Box3().setFromObject(scene, true);
  assert.ok(Math.abs(bounds.min.y) < 1e-5, `${entry.assetId} must stand on the ground`);
  assert.ok(Math.abs(bounds.getSize(new THREE.Vector3()).y - entry.heightMeters) < 1e-5);
  const samples = [];
  for (const mesh of meshes) {
    assert.equal(mesh.skeleton.bones.length, 65);
    assert.ok(!mesh.material.map, 'Built-in body presets must not depend on external textures');
    const geometry = mesh.geometry;
    const attribute = geometry.attributes.position;
    for (let vertex = 0; vertex < attribute.count; vertex += 137) {
      const rest = new THREE.Vector3().fromBufferAttribute(attribute, vertex).applyMatrix4(mesh.matrixWorld);
      const skinned = mesh.getVertexPosition(vertex, new THREE.Vector3()).applyMatrix4(mesh.matrixWorld);
      assert.ok(skinned.distanceTo(rest) < 1e-5, `${entry.assetId} has a changed bind pose`);
      const weights = geometry.attributes.skinWeight;
      const sum = [0, 1, 2, 3].reduce((total, slot) => total + weights.getComponent(vertex, slot), 0);
      assert.ok(Math.abs(sum - 1) < 1e-5);
      samples.push({ mesh, vertex, position: skinned });
    }
  }
  const waist = new THREE.Box3();
  for (const mesh of meshes) {
    const geometry = mesh.geometry;
    for (let vertex = 0; vertex < geometry.attributes.position.count; vertex++) {
      let waistWeight = 0;
      for (let slot = 0; slot < 4; slot++) {
        const bone = mesh.skeleton.bones[geometry.attributes.skinIndex.getComponent(vertex, slot)];
        if (bone.name === 'mixamorigSpine') waistWeight += geometry.attributes.skinWeight.getComponent(vertex, slot);
      }
      if (waistWeight > 0.3) waist.expandByPoint(mesh.getVertexPosition(vertex, new THREE.Vector3()).applyMatrix4(mesh.matrixWorld));
    }
  }
  const neck = bones.get('mixamorigNeck').getWorldPosition(new THREE.Vector3());
  const headTop = bones.get('mixamorigHeadTop_End').getWorldPosition(new THREE.Vector3());
  const leftShoulder = bones.get('mixamorigLeftArm').getWorldPosition(new THREE.Vector3());
  const rightShoulder = bones.get('mixamorigRightArm').getWorldPosition(new THREE.Vector3());
  const report = { id: entry.assetId, height: entry.heightMeters, headRatio: (headTop.y - neck.y) / entry.heightMeters, waist: waist.getSize(new THREE.Vector3()).x, shoulders: leftShoulder.distanceTo(rightShoulder), sampledVertices: samples.length };

  bones.get('mixamorigLeftArm').rotateZ(Math.PI / 3);
  bones.get('mixamorigRightUpLeg').rotateX(Math.PI / 5);
  scene.updateMatrixWorld(true);
  let movement = 0;
  for (const sample of samples) {
    const moved = sample.mesh.getVertexPosition(sample.vertex, new THREE.Vector3()).applyMatrix4(sample.mesh.matrixWorld);
    assert.ok(moved.toArray().every(Number.isFinite));
    movement = Math.max(movement, moved.distanceTo(sample.position));
    assert.ok(moved.length() < entry.heightMeters * 2, `${entry.assetId} has exploded skin after a joint rotation`);
  }
  assert.ok(movement > 0.1, `${entry.assetId} must deform with its skeleton`);
  reports.set(entry.assetId, report);
}

console.log(JSON.stringify([...reports.values()], null, 2));
for (const gender of ['male', 'female']) {
  const report = type => reports.get(`local-body-${gender}-${type}`);
  assert.ok(report('child').headRatio > report('standard').headRatio * 1.35, 'Children must have different head-to-body proportions, not just a scaled adult mesh');
  assert.ok(report('teen').headRatio > report('standard').headRatio * 1.08);
  assert.ok(report('full').waist > report('standard').waist * 1.2);
  assert.ok(report('slender').waist < report('standard').waist * 0.9);
  assert.ok(report('athletic').shoulders > report('standard').shoulders * 1.1);
}
assert.ok(reports.get('local-body-male-standard').shoulders / 1.8 > reports.get('local-body-female-standard').shoulders / 1.68);
console.log('All 12 character body presets passed geometry, skeleton, bind-pose, proportion, and joint deformation checks.');
