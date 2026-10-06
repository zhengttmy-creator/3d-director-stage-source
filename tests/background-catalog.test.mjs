import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';

const records = [false, true, false].map((deleted, index) => ({
  assetId: `image-${index}`, revisionId: '1', title: `Background ${index}`,
  mediaUrl: `/assets/captures/${index}.png`, extension: '.png', width: 64, height: 32,
  backgroundDeleted: deleted,
}));
const requests = [];
let rejectWrite = false;
const scope = vm.createContext({URL, console, window: {}, location: {href: 'http://localhost/', origin: 'http://localhost'},
  fetch: async (url, options = {}) => {
    requests.push({url, ...options});
    if (!options.method) return {ok: true, json: async () => ({items: structuredClone(records)})};
    if (rejectWrite) return {ok: false};
    assert.equal(options.method, 'PATCH');
    const id = decodeURIComponent(url.split('/')[3]);
    const record = records.find(item => item.assetId === id);
    assert.ok(record);
    record.backgroundDeleted = JSON.parse(options.body).deleted;
    return {ok: true, json: async () => structuredClone(record)};
  },
});
vm.runInContext(await fs.readFile(new URL('../web/captures.js', import.meta.url), 'utf8'), scope);
const {port, catalog} = scope.window.localDirectorCaptures;
const firstPage = await catalog.listImages({limit: 1});
assert.equal(firstPage.items[0].assetId, 'image-0');
assert.equal(firstPage.items[0].localBackgroundAsset, true);
assert.equal(firstPage.hasMore, true);
const secondPage = await catalog.listImages({limit: 1, cursor: firstPage.cursor});
assert.equal(secondPage.items[0].assetId, 'image-2', 'Deleted images are excluded before pagination');
assert.equal(secondPage.hasMore, false);
assert.equal((await catalog.resolveImages({resourceIds: ['image-1']}))[0].mediaUrl, 'http://localhost/assets/captures/1.png',
  'Saved scenes can still resolve a removed background');
await port.removeBackground('image-0');
assert.equal((await catalog.listImages()).items.length, 1);
await port.restoreBackground('image-0');
assert.equal((await catalog.listImages()).items.length, 2);
rejectWrite = true;
await assert.rejects(port.removeBackground('image-2'), /删除背景失败/);
assert.equal(records[2].backgroundDeleted, false);
assert.ok(requests.every(request => request.url.startsWith('/api/captures')));
console.log('Background catalog passed: delete/restore, filtered pagination, saved-scene resolution and failed writes.');
