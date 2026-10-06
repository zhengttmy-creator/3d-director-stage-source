import * as THREE from 'three';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';

const bodyTypes = [
  { id: 'standard', label: '标准', description: '成年标准体型', maleHeight: 1.8, femaleHeight: 1.68 },
  { id: 'teen', label: '少年', description: '少年比例，较窄肩部和较短四肢', maleHeight: 1.53, femaleHeight: 1.48, leg: 0.82, torso: 0.84, arm: 0.82, head: 0.97, shoulder: 0.85, hip: 0.88, chest: 0.85, waist: 0.85, depth: 0.88, limb: 0.82, hand: 0.86, foot: 0.87 },
  { id: 'child', label: '儿童', description: '儿童比例，较大头身比和较短四肢', maleHeight: 1.12, femaleHeight: 1.1, leg: 0.56, torso: 0.62, arm: 0.58, head: 0.94, shoulder: 0.69, hip: 0.73, chest: 0.7, waist: 0.76, depth: 0.75, limb: 0.7, hand: 0.7, foot: 0.72 },
  { id: 'slender', label: '纤瘦', description: '纤细腰身和四肢', maleHeight: 1.8, femaleHeight: 1.68, shoulder: 0.94, hip: 0.9, chest: 0.86, waist: 0.74, depth: 0.82, limb: 0.76 },
  { id: 'athletic', label: '健壮', description: '宽肩、厚实胸背和较强壮四肢', maleHeight: 1.84, femaleHeight: 1.73, shoulder: 1.17, hip: 1.04, chest: 1.24, waist: 1.02, depth: 1.17, limb: 1.25, forearm: 1.13, calf: 1.12 },
  { id: 'full', label: '丰腴', description: '丰满腰腹、臀胯和四肢', maleHeight: 1.8, femaleHeight: 1.68, shoulder: 1.04, hip: 1.25, chest: 1.23, waist: 1.5, depth: 1.43, limb: 1.3, forearm: 1.16, calf: 1.17 },
];

export const bodyPresets = bodyTypes.flatMap(type => ['male', 'female'].map(gender => ({
  ...type,
  gender,
  bodyType: type.id,
  id: `${gender}-${type.id}`,
  assetId: `local-body-${gender}-${type.id}`,
  displayName: `${gender === 'male' ? '男性' : '女性'} · ${type.label}`,
  heightMeters: gender === 'male' ? type.maleHeight : type.femaleHeight,
})));

const canonicalName = name => name.replace(/[^a-z0-9]/gi, '').toLowerCase();
const shortName = name => name.replace(/^mixamorig/i, '');

export function createBodyPreset(source, hierarchy, preset) {
  source.updateMatrixWorld(true);
  const sourceBones = new Map();
  const sourceMeshes = [];
  source.traverse(node => {
    if (node.isBone && !sourceBones.has(canonicalName(node.name))) sourceBones.set(canonicalName(node.name), node);
    if (node.isSkinnedMesh) sourceMeshes.push(node);
  });
  const original = hierarchy.map(entry => {
    const bone = sourceBones.get(canonicalName(entry.name));
    if (!bone) throw new Error(`Missing canonical bone: ${entry.name}`);
    return { position: bone.getWorldPosition(new THREE.Vector3()), rotation: bone.getWorldQuaternion(new THREE.Quaternion()) };
  });
  const boneIndices = new Map(hierarchy.map((entry, index) => [canonicalName(entry.name), index]));
  const point = name => original[boneIndices.get(canonicalName(`mixamorig${name}`))].position;
  const factors = Object.fromEntries(['leg', 'torso', 'arm', 'head', 'shoulder', 'hip', 'chest', 'waist', 'depth', 'limb', 'hand', 'foot'].map(name => [name, preset[name] ?? 1]));
  const youngFemale = preset.gender === 'female' && ['teen', 'child'].includes(preset.bodyType);
  const youthChestDepth = youngFemale ? preset.bodyType === 'child' ? 0.64 : 0.85 : 1;
  if (youngFemale) factors.hip *= preset.bodyType === 'child' ? 0.87 : 0.96;
  const hips = point('Hips');
  const neck = point('Neck');
  const heightAt = y => y <= hips.y ? y * factors.leg : y <= neck.y ? hips.y * factors.leg + (y - hips.y) * factors.torso : hips.y * factors.leg + (neck.y - hips.y) * factors.torso + (y - neck.y) * factors.head;
  const mappedPositions = original.map(({ position }, index) => {
    const name = shortName(hierarchy[index].name);
    const side = name.startsWith('Left') ? 'Left' : 'Right';
    const mapped = new THREE.Vector3(position.x, heightAt(position.y), position.z);
    if (/Shoulder|Arm|Hand/.test(name)) {
      const shoulder = point(`${side}Arm`);
      const hand = point(`${side}Hand`);
      const isFinger = /Hand.+/.test(name);
      mapped.x = shoulder.x * factors.shoulder + (position.x - shoulder.x) * factors.arm;
      if (isFinger) mapped.x = shoulder.x * factors.shoulder + (hand.x - shoulder.x) * factors.arm + (position.x - hand.x) * factors.hand;
      mapped.y = heightAt(shoulder.y) + (position.y - shoulder.y) * factors.arm;
      mapped.z = shoulder.z * factors.depth + (position.z - shoulder.z) * factors.arm;
    } else if (/Leg|Foot|Toe/.test(name)) {
      const hip = point(`${side}UpLeg`);
      const foot = point(`${side}Foot`);
      mapped.x = hip.x * factors.hip + (position.x - hip.x) * factors.leg;
      mapped.z = position.z * factors.leg;
      if (/Toe/.test(name)) {
        mapped.y = heightAt(foot.y) + (position.y - foot.y) * factors.foot;
        mapped.z = foot.z * factors.leg + (position.z - foot.z) * factors.foot;
      }
    } else if (/Head/.test(name)) {
      mapped.x *= factors.head;
      mapped.z = neck.z * factors.depth + (position.z - neck.z) * factors.head;
    } else {
      mapped.x *= factors.hip;
      mapped.z *= factors.depth;
    }
    return mapped;
  });

  // Rest-shape transforms are blended with the original skin weights, so joints
  // and surfaces deform together without adding nonuniform animated bone scales.
  const radialScales = hierarchy.map(({ name: fullName }) => {
    const name = shortName(fullName);
    if (/Head/.test(name)) return new THREE.Vector3().setScalar(factors.head);
    if (/Hand/.test(name)) return new THREE.Vector3().setScalar(factors.hand);
    if (/ForeArm/.test(name)) return new THREE.Vector3(factors.arm, preset.forearm ?? factors.limb, preset.forearm ?? factors.limb);
    if (/Arm|Shoulder/.test(name)) return new THREE.Vector3(factors.arm, factors.limb, factors.limb);
    if (/Foot|Toe/.test(name)) return new THREE.Vector3(factors.foot, factors.foot, factors.foot);
    if (/UpLeg/.test(name)) return new THREE.Vector3(factors.limb * (youngFemale ? preset.bodyType === 'child' ? 0.88 : 0.95 : 1), factors.leg, factors.limb);
    if (/Leg/.test(name)) return new THREE.Vector3(preset.calf ?? factors.limb, factors.leg, preset.calf ?? factors.limb);
    if (name === 'Hips') return new THREE.Vector3(factors.hip, factors.leg, factors.depth);
    if (name === 'Spine') return new THREE.Vector3(factors.waist, factors.torso, factors.depth);
    if (name === 'Spine1') return new THREE.Vector3(Math.sqrt(factors.waist * factors.chest), factors.torso, factors.depth * Math.sqrt(youthChestDepth));
    if (/Spine/.test(name)) return new THREE.Vector3(factors.chest, factors.torso, factors.depth * youthChestDepth);
    return new THREE.Vector3(factors.head, factors.torso, factors.head);
  });
  const scene = new THREE.Group();
  scene.name = `body_${preset.id}`;
  const bones = hierarchy.map(({ name }) => { const bone = new THREE.Bone(); bone.name = name; return bone; });
  const targetWorld = mappedPositions.map((position, index) => new THREE.Matrix4().compose(position, original[index].rotation, new THREE.Vector3(1, 1, 1)));
  for (let index = 0; index < bones.length; index++) {
    const parentIndex = hierarchy[index].parentIndex;
    const parent = parentIndex < 0 ? scene : bones[parentIndex];
    const localMatrix = parentIndex < 0 ? targetWorld[index] : targetWorld[parentIndex].clone().invert().multiply(targetWorld[index]);
    localMatrix.decompose(bones[index].position, bones[index].quaternion, bones[index].scale);
    parent.add(bones[index]);
  }
  const restPoint = new THREE.Vector3();
  const deformedPoint = new THREE.Vector3();
  const contribution = new THREE.Vector3();
  for (const sourceMesh of sourceMeshes) {
    const geometry = sourceMesh.geometry.clone();
    const positions = geometry.attributes.position;
    const weights = geometry.attributes.skinWeight;
    const oldIndices = geometry.attributes.skinIndex;
    const indices = new Uint16Array(positions.count * 4);
    for (let vertex = 0; vertex < positions.count; vertex++) {
      sourceMesh.getVertexPosition(vertex, restPoint).applyMatrix4(sourceMesh.matrixWorld);
      deformedPoint.set(0, 0, 0);
      let total = 0;
      for (let slot = 0; slot < 4; slot++) {
        const weight = weights.getComponent(vertex, slot);
        const sourceBone = sourceMesh.skeleton.bones[oldIndices.getComponent(vertex, slot)];
        const index = sourceBone ? boneIndices.get(canonicalName(sourceBone.name)) : 0;
        if (index === undefined) throw new Error(`Unmapped skin bone: ${sourceBone.name}`);
        indices[vertex * 4 + slot] = index;
        if (!weight) continue;
        contribution.copy(restPoint).sub(original[index].position).multiply(radialScales[index]).add(mappedPositions[index]);
        deformedPoint.addScaledVector(contribution, weight);
        total += weight;
      }
      if (total <= 0) throw new Error('Unweighted character vertex');
      deformedPoint.divideScalar(total);
      positions.setXYZ(vertex, deformedPoint.x, deformedPoint.y, deformedPoint.z);
    }
    geometry.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(indices, 4));
    const compact = mergeVertices(geometry, 1e-4);
    compact.computeVertexNormals();
    compact.computeBoundingBox();
    compact.computeBoundingSphere();
    const joint = /joint/i.test(sourceMesh.name);
    const mesh = new THREE.SkinnedMesh(compact, new THREE.MeshStandardMaterial({ name: joint ? 'Body_Joints' : 'Body_Surface', color: joint ? 0x8b9196 : 0xd9ddde, roughness: 0.74, metalness: 0.04 }));
    mesh.name = sourceMesh.name;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    scene.add(mesh);
    geometry.dispose();
  }
  const bounds = new THREE.Box3();
  for (const mesh of scene.children.filter(node => node.isSkinnedMesh)) bounds.union(mesh.geometry.boundingBox);
  const factor = preset.heightMeters * 100 / bounds.getSize(new THREE.Vector3()).y;
  const ground = bounds.min.y;
  for (const bone of bones) bone.position.multiplyScalar(factor);
  bones[0].position.y -= ground * factor;
  for (const mesh of scene.children.filter(node => node.isSkinnedMesh)) {
    const positions = mesh.geometry.attributes.position;
    for (let vertex = 0; vertex < positions.count; vertex++) positions.setXYZ(vertex, positions.getX(vertex) * factor, (positions.getY(vertex) - ground) * factor, positions.getZ(vertex) * factor);
    mesh.geometry.computeBoundingBox();
    mesh.geometry.computeBoundingSphere();
  }
  scene.updateMatrixWorld(true);
  const skeleton = new THREE.Skeleton(bones);
  skeleton.calculateInverses();
  for (const mesh of scene.children.filter(node => node.isSkinnedMesh)) {
    mesh.bind(skeleton, new THREE.Matrix4());
    mesh.normalizeSkinWeights();
  }
  scene.scale.setScalar(0.01);
  scene.updateMatrixWorld(true);
  scene.animations = [];
  return scene;
}
