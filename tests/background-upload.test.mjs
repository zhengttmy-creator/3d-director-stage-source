import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';

const source = await fs.readFile(new URL('../src/patches/background-upload-runtime.js', import.meta.url), 'utf8');
const context = vm.createContext({File, AbortController});
vm.runInContext(source, context);
const {__localMergeBackgroundImages: merge, __localBackgroundFile: validate,
  __localReadBackgroundImages: read, __localSaveBackgroundImages: save} = context;
const plain = value => JSON.parse(JSON.stringify(value));
const asset = id => ({assetId: id, revisionId: '1', mediaUrl: '/assets/captures/' + id + '.png',
  title: id, extension: '.png', width: 4, height: 3});
const png = new File([new Uint8Array([137, 80, 78, 71])], 'room.png', {type: 'image/png'});

assert.equal(validate(png), png);
assert.equal(validate(new File(['jpeg'], 'PHOTO.JPEG')).type, 'image/jpeg');
assert.throws(() => validate(new File(['svg'], 'room.svg', {type: 'image/svg+xml'})), /PNG/);
assert.throws(() => validate(new File([], 'empty.png', {type: 'image/png'})), /\u4e3a\u7a7a/);
assert.throws(() => validate({type: 'image/png', name: 'large.png', size: 16 * 1024 * 1024 + 1}), /16 MB/);
assert.equal(validate({type: 'image/png', name: 'limit.png', size: 16 * 1024 * 1024}).size, 16 * 1024 * 1024);
assert.deepEqual(plain(merge([{...asset('same'), nodeId: 'canvas-node'}], [asset('same'), asset('new')])).map(item => item.assetId), ['same', 'new']);
assert.equal(merge([{...asset('same'), nodeId: 'canvas-node'}], [asset('same')])[0].nodeId, 'canvas-node');

const requests = [];
const catalog = {async listImages(params) {
  requests.push(params);
  return params.cursor ? {items: [asset('a'), asset('b')], hasMore: false}
    : {items: [asset('a')], cursor: '100', hasMore: true};
}};
const images = await read(catalog);
assert.deepEqual(plain(requests), [{limit: 100}, {limit: 100, cursor: '100'}]);
assert.deepEqual(plain(images).map(item => item.nodeId), ['local-background-a', 'local-background-b']);
await assert.rejects(read({listImages: async () => ({items: [], hasMore: true, cursor: 'repeat'})}), /\u5206\u9875/);
await assert.rejects(read({listImages: async () => ({items: null})}), /\u5217\u8868/);
const aborted = new AbortController(); aborted.abort();
await assert.rejects(read(catalog, aborted.signal), {name: 'AbortError'});

let cloudCalls = 0, savedCalls = 0;
const stored = [], immediatelyVisible = [];
const port = {
  async saveCaptures([file]) {
    savedCalls++;
    if (file.name === 'corrupt.png') return [{ok: false, reason: 'failed'}];
    if (file.name === 'network.png') throw Error('offline');
    const item = {...asset('stored-' + stored.length), title: file.name};
    stored.push(item);
    return [{ok: true, asset: item}];
  },
  async placeCaptures() { cloudCalls++; },
};
const result = await save([png, new File(['x'], 'bad.svg', {type: 'image/svg+xml'}),
  new File(['x'], 'corrupt.png', {type: 'image/png'}), new File(['x'], 'network.png', {type: 'image/png'}),
  new File(['x'], 'last.webp', {type: 'image/webp'})], port, image => immediatelyVisible.push(image));
assert.equal(result.images.length, 2);
assert.equal(result.errors.length, 3);
assert.equal(savedCalls, 4, 'Invalid format is rejected before persistence');
assert.equal(cloudCalls, 0, 'Background import never uploads to a remote canvas');
assert.equal(immediatelyVisible.length, 2, 'Each successful file is visible before a catalog refresh');
assert.equal(result.images[1].title, 'last.webp', 'One failed image does not prevent later imports');
await assert.rejects(read({listImages: async () => { throw Error('refresh offline'); }}), /offline/);
assert.equal(immediatelyVisible.length, 2, 'Refresh failure cannot discard successful upload results');
const reloaded = await read({listImages: async () => ({items: stored, hasMore: false})});
assert.deepEqual(plain(reloaded), plain(result.images), 'Catalog reload resolves persisted uploads to the same background nodes');
assert.equal((await save([png], null)).errors.length, 1);
assert.deepEqual(plain(await save([], port)), {images: [], errors: []});

function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return {promise, resolve, reject};
}
function hookHarness(capturePort, originalImages = [asset('existing')]) {
  const hooks = [], effects = [];
  let cursor = 0, writesAfterUnmount = 0, mounted = true;
  const react = {
    useState(initial) {
      const index = cursor++;
      if (!hooks[index]) hooks[index] = {value: initial};
      return [hooks[index].value, value => {
        if (!mounted) writesAfterUnmount++;
        hooks[index].value = typeof value === 'function' ? value(hooks[index].value) : value;
      }];
    },
    useRef(initial) {
      const index = cursor++;
      if (!hooks[index]) hooks[index] = {current: initial};
      return hooks[index];
    },
    useCallback(callback) {
      const index = cursor++;
      return hooks[index] || (hooks[index] = callback);
    },
    useMemo: callback => { cursor++; return callback(); },
    useEffect(callback) {
      const index = cursor++;
      if (!hooks[index]) { hooks[index] = true; effects.push(callback); }
    },
  };
  const isolated = vm.createContext({File, AbortController, n: react, window: {localDirectorCaptures: capturePort}});
  vm.runInContext(source, isolated);
  const render = () => { cursor = 0; return isolated.__localUseBackgroundImages(originalImages); };
  render();
  const cleanups = effects.map(effect => effect());
  return {render, unmount() { mounted = false; cleanups.forEach(cleanup => cleanup()); },
    get writesAfterUnmount() { return writesAfterUnmount; }};
}
const staleRead = deferred(), saved = deferred(), refreshStarted = deferred(), failedRefresh = deferred();
let reads = 0, pendingSignal;
const hook = hookHarness({
  port: {saveCaptures: () => saved.promise},
  catalog: {listImages: (_, signal) => {
    if (!reads++) { pendingSignal = signal; return staleRead.promise; }
    refreshStarted.resolve();
    return failedRefresh.promise;
  }},
});
const uploading = hook.render().upload([png]);
assert.equal(pendingSignal.aborted, true, 'An upload cancels an older catalog request');
saved.resolve([{ok: true, asset: asset('new-upload')}]);
await refreshStarted.promise;
assert.deepEqual(plain(hook.render().images).map(item => item.assetId), ['existing', 'new-upload']);
failedRefresh.reject(Error('offline'));
await uploading;
assert.match(hook.render().error, /\u5217\u8868/);
assert.equal(hook.render().busy, false);
staleRead.resolve({items: [asset('stale')], hasMore: false});
await staleRead.promise;
await Promise.resolve();
assert.deepEqual(plain(hook.render().images).map(item => item.assetId), ['existing', 'new-upload'], 'A late aborted read cannot restore stale images');
const lateSave = deferred();
const unmounted = hookHarness({port: {saveCaptures: () => lateSave.promise},
  catalog: {listImages: async () => ({items: [], hasMore: false})}});
const pendingUpload = unmounted.render().upload([png]);
unmounted.unmount();
lateSave.resolve([{ok: true, asset: asset('late')}]);
await pendingUpload;
assert.equal(unmounted.writesAfterUnmount, 0, 'Async upload completion never updates an unmounted panel');

const removable = {...asset('removable'), localBackgroundAsset: true};
const external = {...asset('external'), mediaUrl: 'https://canvas.example/external.png'};
const removePending = deferred(), restorePending = deferred();
let deleteCount = 0, restoreCount = 0, deleted = false, failDelete = false, failRestore = true;
const removedCallbacks = [];
const deleting = hookHarness({
  catalog: {listImages: async () => ({items: deleted ? [] : [removable], hasMore: false})},
  port: {
    async removeBackground(id) {
      deleteCount++;
      assert.equal(id, removable.assetId);
      if (failDelete) throw Error('offline');
      await removePending.promise;
      deleted = true;
    },
    async restoreBackground(id) {
      restoreCount++;
      assert.equal(id, removable.assetId);
      if (failRestore) throw Error('offline');
      await restorePending.promise;
      deleted = false;
    },
  },
}, [asset('removable'), external]);
await deleting.render().retry();
let deleteLibrary = deleting.render();
assert.equal(deleteLibrary.canRemove(deleteLibrary.images[0]), true, 'The local catalog marks an original same-ID image as deletable');
assert.equal(deleteLibrary.canRemove(external), false, 'External canvas images are never deletable');
await deleteLibrary.remove(external);
assert.equal(deleteCount, 0);
const deletingNow = deleteLibrary.remove(deleteLibrary.images[0], id => removedCallbacks.push(id));
assert.equal(deleteCount, 1);
assert.equal(deleting.render().images.length, 2, 'A card remains present until its membership deletion is persisted');
assert.deepEqual(removedCallbacks, [], 'The current scene is not hidden before persistence succeeds');
await deleteLibrary.remove(deleteLibrary.images[0]);
assert.equal(deleteCount, 1, 'A double click cannot start a second removal');
removePending.resolve();
await deletingNow;
assert.deepEqual(removedCallbacks, ['removable']);
assert.deepEqual(plain(deleting.render().images).map(item => item.assetId), ['external']);
assert.equal(deleting.render().undoAvailable, true);
assert.match(deleting.render().notice, /\u5df2\u5220\u9664/);
await deleting.render().undoRemove();
assert.equal(deleting.render().undoAvailable, true, 'A failed restore preserves the undo action');
assert.equal(deleting.render().images.length, 1);
assert.match(deleting.render().error, /\u6062\u590d/);
failRestore = false;
const restoringNow = deleting.render().undoRemove();
assert.equal(deleting.render().images.length, 1, 'Undo waits for successful persistence before revealing a card');
restorePending.resolve();
await restoringNow;
assert.equal(restoreCount, 2);
assert.equal(deleting.render().images.filter(item => item.assetId === 'removable').length, 1, 'Undo never duplicates original and local descriptors');
assert.equal(deleting.render().undoAvailable, false);
assert.deepEqual(removedCallbacks, ['removable'], 'Undo only restores the library, not a previous scene background');
failDelete = true;
await deleting.render().remove(removable, id => removedCallbacks.push(id));
assert.equal(deleting.render().images.length, 2, 'A failed delete leaves the image available');
assert.match(deleting.render().error, /\u5220\u9664/);
assert.deepEqual(removedCallbacks, ['removable'], 'A failed delete cannot close the current background');

const oldCatalog = deferred();
let catalogReads = 0, initialSignal;
const deleteRace = hookHarness({
  catalog: {listImages: async (_, signal) => {
    if (!catalogReads++) { initialSignal = signal; return oldCatalog.promise; }
    return {items: [removable], hasMore: false};
  }},
  port: {removeBackground: async () => {}},
}, [removable]);
await deleteRace.render().remove(removable);
assert.equal(initialSignal.aborted, true, 'Deletion cancels an older catalog request');
assert.equal(deleteRace.render().images.length, 0, 'Even a stale catalog refresh cannot resurrect a deleted ID');
oldCatalog.resolve({items: [removable], hasMore: false});
await oldCatalog.promise; await Promise.resolve();
assert.equal(deleteRace.render().images.length, 0, 'An initial response arriving after delete cannot resurrect a card');
await deleteRace.render().retry();
assert.equal(deleteRace.render().images.length, 0, 'Explicit refresh also preserves the removed-ID filter');

const lateRemoval = deferred(), unmountedCallbacks = [];
const unmountedRemoval = hookHarness({
  catalog: {listImages: async () => ({items: [removable], hasMore: false})},
  port: {removeBackground: () => lateRemoval.promise},
}, [removable]);
const pendingRemoval = unmountedRemoval.render().remove(removable, id => unmountedCallbacks.push(id));
unmountedRemoval.unmount();
lateRemoval.resolve();
await pendingRemoval;
assert.equal(unmountedRemoval.writesAfterUnmount, 0);
assert.deepEqual(unmountedCallbacks, [], 'A persisted deletion from an unmounted panel cannot affect a new scene');
console.log('Background uploads/deletion passed: validation, paging, local-only persistence, partial errors, reload, cancellation, delete/restore failures, scene callback ordering, deduplication and stale-response protection.');
