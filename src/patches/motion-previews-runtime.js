function __localResolveModelResource(url, resources) {
  if (resources[url]) return resources[url];
  const normalize = value => {
    try {value = decodeURIComponent(value);} catch {}
    return value.replace(/\\/g, '/').replace(/^(\.\/)+/, '');
  };
  const requested = normalize(url);
  const entries = Object.entries(resources).map(([path, value]) => [normalize(path), value]);
  const unique = matches => {const urls = new Set(matches.map(([, value]) => value));return urls.size === 1 ? [...urls][0] : undefined;};
  const exact = unique(entries.filter(([path]) => path === requested));
  if (exact) return exact;
  const relative = entries.filter(([path]) => !/^(?:[a-z][a-z\d+.-]*:|\/)/i.test(path) && path.includes('/') && requested.endsWith('/' + path));
  if (relative.length) {
    const longest = Math.max(...relative.map(([path]) => path.length));
    const match = unique(relative.filter(([path]) => path.length === longest));
    if (match) return match;
  }
  const name = requested.split('/').at(-1);
  return unique(entries.filter(([path]) => path.split('/').at(-1) === name)) || url;
}

// All cards share one renderer; only their inexpensive 2D canvases are mounted.
class __LocalMotionPreviewService {
  constructor() {
    this.slots = new Set();
    this.prepared = new Map();
    this.queue = Promise.resolve();
    this.active = null;
    this.frame = 0;
    this.modelKey = '';
  }

  async initialize(target) {
    const modelUrl = target?.asset?.extension === '.fbx' ? target.asset.mediaUrl : '/assets/character.fbx';
    const resources = target?.asset?.resources || {};
    const key = modelUrl + ':' + (target?.asset?.revisionId || '') + ':' + JSON.stringify(resources) + ':' + (target?.color || '#c9cdd1');
    if (this.modelKey === key && this.model) return;
    if (!this.renderer) {
      this.renderer = new pN.JeP({antialias: true, alpha: false, powerPreference: 'low-power'});
      this.renderer.setPixelRatio(1);
      this.renderer.setSize(320, 320, false);
      this.renderer.outputColorSpace = 'srgb';
      this.renderer.toneMapping = 4;
      this.renderer.toneMappingExposure = 1.05;
      this.renderer.setClearColor(0x22262a, 1);
      this.renderer.shadowMap.enabled = true;
      this.renderer.shadowMap.type = 2;
      this.scene = new so.Z58();
      this.scene.add(new so.dth(0xe9f1ff, 0x42464c, 2.2));
      const keyLight = new so.ZyN(0xffffff, 3.2);
      keyLight.position.set(3, 5, 5);
      keyLight.castShadow = true;
      keyLight.shadow.mapSize.set(512, 512);
      Object.assign(keyLight.shadow.camera, {left: -4, right: 4, top: 4, bottom: -4, near: 0.1, far: 20});
      keyLight.shadow.bias = -0.001;
      this.scene.add(keyLight);
      const fill = new so.ZyN(0xbad4ed, 1.5);
      fill.position.set(-4, 2, -3);
      this.scene.add(fill);
      this.camera = new so.ubm(32, 1, 0.01, 100);
      this.camera.up.set(0, 1, 0);
      this.grid = new so.fTw(8, 16, 0x52585e, 0x383e44);
      this.grid.material.transparent = true;
      this.grid.material.opacity = 0.65;
      this.scene.add(this.grid);
      this.floor = new so.eaF(new so.iNn(8, 0.01, 8), new so._4j({color: 0x2b3035, roughness: 1}));
      this.floor.receiveShadow = true;
      this.scene.add(this.floor);
    }
    if (this.model) {
      this.mixer.stopAllAction();
      this.mixer.uncacheRoot(this.bones[0]);
      this.scene.remove(this.wrapper);
      pq(this.model);
      this.prepared.clear();
      this.model = null;
    }
    const manager = new so.KPJ();
    manager.setURLModifier(url => __localResolveModelResource(url, resources));
    const model = await new pD.w(manager).loadAsync(new URL(modelUrl, location.href).href);
    const bones = lJ(model);
    if (!bones) {
      pq(model);
      throw Error('Preview model does not have the supported skeleton');
    }
    this.model = model;
    this.bones = bones;
    this.bindPositions = bones.map(bone => bone.position.clone());
    this.bindRotations = bones.map(bone => bone.quaternion.clone());
    this.bindWorldRotations = l0(bones, new Map(bones.map((bone, index) => [bone, this.bindRotations[index]])));
    this.bindScales = bones.map(bone => bone.scale.clone());
    this.bindReference = new vb(bones);
    this.mixer = new so.Iw4(bones[0]);
    this.wrapper = new so.YJl();
    this.wrapper.scale.setScalar(0.01);
    this.wrapper.add(model);
    this.scene.add(this.wrapper);
    model.traverse(node => {
      if (!(node instanceof so.eaF)) return;
      node.frustumCulled = false;
      node.castShadow = true;
      node.receiveShadow = true;
      for (const material of Array.isArray(node.material) ? node.material : [node.material]) {
        for (const value of Object.values(material)) if (value instanceof so.gPd) value.dispose();
        material.dispose();
      }
      node.material = new so._4j({color: target?.color || 0xc9cdd1, roughness: 0.76, metalness: 0.08});
    });
    this.model.updateMatrixWorld(true);
    this.modelKey = key;
  }

  async prepare(slot) {
    await this.initialize(slot.target);
    let motion;
    if (slot.savedMotion) motion = slot.savedMotion;
    else if (slot.entry.selection?.motion) motion = slot.entry.selection.motion;
    else motion = await slot.resolve(slot.entry.catalogAssetId, slot.entry.catalogAsset);
    if (!motion) throw Error('Preview motion is unavailable');
    const key = this.modelKey + ':' + (motion.assetPath || (motion.id + ':' + (motion.updatedAt || '')));
    let prepared = this.prepared.get(key);
    if (prepared) return prepared;
    if (motion.assetPath) {
      const asset = await __localDirectorLoadMotion(motion.assetPath);
      const sourceBones = lJ(asset);
      const clip = asset.animations.find(clip => clip.duration > 0 && clip.tracks.length);
      if (!sourceBones || !clip) throw Error('Preview animation does not have the supported skeleton');
      const result = this.bindReference.resolve().prepareClip(new vv(sourceBones), clip, this.bones);
      prepared = {clip: result.clip, duration: result.clip.duration};
      prepared.action = this.mixer.clipAction(prepared.clip);
    } else {
      prepared = {motion, duration: motion.durationSec};
    }
    if (!(prepared.duration > 0)) throw Error('Preview animation has no duration');
    // Fit sampled poses, with root movement removed only in this isolated preview.
    const bounds = new so.NRn();
    const fixedPose = String(motion.id || '').startsWith('local-pose-') ||
      (motion.keyframes?.length === 2 && JSON.stringify(motion.keyframes[0].pose) === JSON.stringify(motion.keyframes[1].pose) &&
        JSON.stringify(motion.keyframes[0].rootTranslation) === JSON.stringify(motion.keyframes[1].rootTranslation));
    const sampleCount = fixedPose ? 1 : 16;
    for (let index = 0; index < sampleCount; index++) {
      this.pose(prepared, prepared.duration * index / sampleCount);
      this.model.traverse(node => { if (node instanceof so.I46) node.computeBoundingBox(); });
      bounds.union(new so.NRn().setFromObject(this.wrapper));
      if (index % 4 === 3) await new Promise(resolve => setTimeout(resolve, 0));
    }
    const size = bounds.getSize(new so.Pq0());
    const center = bounds.getCenter(new so.Pq0());
    const radius = Math.max(size.length() * 0.5, 0.5);
    prepared.center = center;
    prepared.distance = radius / Math.sin(16 * Math.PI / 180) * 1.12;
    prepared.floor = bounds.min.y - 0.005;
    prepared.posterTime = Math.min(prepared.duration * 0.2, 0.6);
    this.prepared.set(key, prepared);
    return prepared;
  }

  pose(prepared, time) {
    this.mixer.stopAllAction();
    this.bones.forEach((bone, index) => {
      bone.position.copy(this.bindPositions[index]);
      bone.quaternion.copy(this.bindRotations[index]);
      bone.scale.copy(this.bindScales[index]);
    });
    if (prepared.action) {
      prepared.action.reset().setLoop(2200, 1);
      prepared.action.clampWhenFinished = true;
      prepared.action.play();
      this.mixer.setTime(time);
    } else {
      const sample = s6({...prepared.motion, loop: false}, time);
      const rotations = new Map(sample.rotations.map(rotation => [rotation.boneIndex, rotation]));
      const direct = sample.transferMode === 'direct-local';
      this.bones.forEach((bone, index) => {
        const value = rotations.get(index);
        if (!value) return;
        const rotation = new so.PTz().setFromEuler(new so.O9p(value.rotation.x * Math.PI / 180, value.rotation.y * Math.PI / 180, value.rotation.z * Math.PI / 180, 'XYZ'));
        if (direct) bone.quaternion.copy(rotation);
        else {
          const bind = new so.PTz(value.bindWorldRotation.x, value.bindWorldRotation.y, value.bindWorldRotation.z, value.bindWorldRotation.w).normalize();
          bone.quaternion.copy(this.bindRotations[index]).multiply(l2(l1(rotation, bind), this.bindWorldRotations[index]));
        }
      });
      if (sample.rootTranslation) {
        const translation = new so.Pq0(sample.rootTranslation.x, sample.rootTranslation.y, sample.rootTranslation.z);
        if (direct) this.bones[0].position.copy(translation);
        else this.bones[0].position.add(translation);
      }
    }
    const root = this.bones[0];
    root.position.x = this.bindPositions[0].x;
    root.position.z = this.bindPositions[0].z;
    this.wrapper.updateMatrixWorld(true);
  }

  draw(slot, time, poster = false) {
    const prepared = slot.prepared;
    if (!prepared || slot.disposed || (!slot.visible && !poster)) return;
    this.pose(prepared, time);
    const direction = new so.Pq0(0.7, 0.3, 1.8).normalize();
    this.camera.position.copy(prepared.center).addScaledVector(direction, prepared.distance);
    this.camera.lookAt(prepared.center);
    this.camera.updateMatrixWorld(true);
    this.grid.position.y = prepared.floor;
    this.floor.position.y = prepared.floor - 0.006;
    this.renderer.render(this.scene, this.camera);
    const canvas = slot.canvas;
    if (canvas.width !== 320 || canvas.height !== 320) { canvas.width = 320; canvas.height = 320; }
    const context = canvas.getContext('2d', {alpha: false});
    context.drawImage(this.renderer.domElement, 0, 0);
    canvas.dataset.previewTime = time.toFixed(4);
    canvas.dataset.previewFrames = String(Number(canvas.dataset.previewFrames || 0) + 1);
    canvas.dataset.previewState = poster ? 'ready' : 'playing';
    if (poster) {
      slot.poster = document.createElement('canvas');
      slot.poster.width = 320;
      slot.poster.height = 320;
      slot.poster.getContext('2d', {alpha: false}).drawImage(canvas, 0, 0);
    }
  }

  enqueue(slot) {
    if (slot.disposed || slot.loading || slot.prepared || !slot.visible) return;
    slot.loading = true;
    slot.update('loading');
    this.queue = this.queue.catch(() => {}).then(async () => {
      // A timer also yields when a hidden tab has suspended animation frames.
      await new Promise(resolve => setTimeout(resolve, 0));
      if (slot.disposed) return;
      try {
        slot.prepared = await this.prepare(slot);
        if (slot.disposed) return;
        this.draw(slot, slot.prepared.posterTime, true);
        slot.update('ready');
        if (this.active === slot) this.animate(slot);
      } catch (error) {
        slot.prepared = null;
        slot.canvas.dataset.previewError = error.message;
        slot.canvas.dataset.previewState = 'error';
        if (!slot.disposed) slot.update('error');
      } finally {
        slot.loading = false;
      }
    });
  }

  activate(slot) {
    if (this.active !== slot) this.deactivate(this.active);
    this.active = slot;
    if (!slot.prepared) this.enqueue(slot);
    else this.animate(slot);
  }

  animate(slot) {
    cancelAnimationFrame(this.frame);
    const started = performance.now();
    let lastDraw = -Infinity;
    const tick = now => {
      if (this.active !== slot || slot.disposed || !slot.visible || document.hidden) return;
      if (now - lastDraw >= 1000 / 30) {
        this.draw(slot, (Math.max(0, now - started) / 1000) % slot.prepared.duration);
        lastDraw = now;
      }
      this.frame = requestAnimationFrame(tick);
    };
    this.frame = requestAnimationFrame(tick);
  }

  deactivate(slot) {
    if (!slot) return;
    if (this.active === slot) {
      cancelAnimationFrame(this.frame);
      this.active = null;
    }
    if (slot.poster && !slot.disposed) {
      slot.canvas.getContext('2d', {alpha: false}).drawImage(slot.poster, 0, 0);
      slot.canvas.dataset.previewState = 'ready';
      slot.canvas.dataset.previewTime = slot.prepared.posterTime.toFixed(4);
    }
  }

  attach(slot) {
    clearTimeout(this.cleanupTimer);
    this.slots.add(slot);
    const observer = new IntersectionObserver(entries => {
      slot.visible = entries.some(entry => entry.isIntersecting);
      if (slot.visible) this.enqueue(slot);
      else this.deactivate(slot);
    }, {rootMargin: '120px'});
    observer.observe(slot.canvas);
    const button = slot.canvas.closest('button');
    const activate = () => this.activate(slot);
    const deactivate = () => this.deactivate(slot);
    const visibility = () => document.hidden ? deactivate() : (button?.matches(':hover, :focus-within') && activate());
    button?.addEventListener('pointerenter', activate);
    button?.addEventListener('pointerleave', deactivate);
    button?.addEventListener('focusin', activate);
    button?.addEventListener('focusout', deactivate);
    document.addEventListener('visibilitychange', visibility);
    slot.retry = () => this.enqueue(slot);
    return () => {
      this.deactivate(slot);
      slot.disposed = true;
      observer.disconnect();
      button?.removeEventListener('pointerenter', activate);
      button?.removeEventListener('pointerleave', deactivate);
      button?.removeEventListener('focusin', activate);
      button?.removeEventListener('focusout', deactivate);
      document.removeEventListener('visibilitychange', visibility);
      this.slots.delete(slot);
      if (!this.slots.size) this.cleanupTimer = setTimeout(() => this.dispose(), 1000);
    };
  }

  dispose() {
    if (this.slots.size) return;
    cancelAnimationFrame(this.frame);
    // Serialize disposal behind any pending asset load or retarget preparation.
    this.queue = this.queue.catch(() => {}).then(() => {
      if (this.slots.size) return;
      this.mixer?.stopAllAction();
      if (this.model) pq(this.model);
      this.grid?.geometry.dispose();
      if (this.grid) for (const material of Array.isArray(this.grid.material) ? this.grid.material : [this.grid.material]) material.dispose();
      this.floor?.geometry.dispose();
      this.floor?.material.dispose();
      this.scene?.traverse(node => {
        node.shadow?.map?.dispose();
        node.shadow?.mapPass?.dispose();
      });
      this.renderer?.dispose();
      this.renderer?.forceContextLoss();
      this.renderer = null;
      this.model = null;
      this.wrapper = null;
      this.scene = null;
      this.grid = null;
      this.floor = null;
      this.mixer = null;
      this.bones = null;
      this.bindReference = null;
      this.bindPositions = null;
      this.bindRotations = null;
      this.bindWorldRotations = null;
      this.bindScales = null;
      this.modelKey = '';
      this.active = null;
      this.prepared.clear();
    });
  }
}

const __localMotionPreviewService = new __LocalMotionPreviewService();

function __LocalMotionPreviewCard(props) {
  const {entry, target, savedMotions, resolve} = props;
  const canvasRef = n.useRef(null);
  const slotRef = n.useRef(null);
  const [status, setStatus] = n.useState('loading');
  const savedMotion = entry.selection?.kind === 'saved' ? savedMotions.find(motion => motion.id === entry.selection.id) : undefined;
  const targetKey = (target?.asset?.mediaUrl || '') + ':' + (target?.asset?.revisionId || '') + ':' + JSON.stringify(target?.asset?.resources || {}) + ':' + (target?.color || '');
  n.useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const slot = {canvas, entry, target, savedMotion, resolve, update: setStatus, visible: false, disposed: false};
    slotRef.current = slot;
    setStatus('loading');
    return __localMotionPreviewService.attach(slot);
  }, [entry.key, targetKey, savedMotion, resolve]);
  return i.jsxs('span', {
    style: {position: 'relative', width: '100%', height: '100%', display: 'block', overflow: 'hidden', background: '#22262a'},
    onClick: event => {
      if (status !== 'error') return;
      event.stopPropagation();
      slotRef.current?.retry?.();
    },
    children: [
      i.jsx('canvas', {
        ref: canvasRef, width: 320, height: 320, role: 'img',
        'aria-label': entry.name + ' \u52a8\u4f5c\u9884\u89c8',
        'data-motion-preview': entry.key,
        'data-motion-preview-id': entry.catalogAssetId || entry.selection?.id,
        'data-preview-state': status,
        style: {display: 'block', width: '100%', height: '100%', objectFit: 'contain'},
      }),
      status === 'loading' && i.jsx('span', {
        style: {position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', background: '#22262a'},
        children: i.jsx(dn.A, {size: 18, className: 'animate-spin', 'aria-label': '\u52a0\u8f7d\u9884\u89c8'}),
      }),
      status === 'error' && i.jsx('span', {
        style: {position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', padding: 12, color: '#e4b7ac', background: '#22262a', fontSize: 11, textAlign: 'center'},
        children: '\u9884\u89c8\u5931\u8d25 \u00b7 \u70b9\u51fb\u91cd\u8bd5',
      }),
    ],
  });
}
