import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';

const extractedRoot = path.resolve(process.argv[2] || 'dist/win-unpacked');
const payloadRoot = path.join(extractedRoot, 'resources', 'app');
const repoRoot = path.resolve(import.meta.dirname, '..');
const manifest = JSON.parse((await fs.readFile(path.join(repoRoot, 'dist', 'desktop-release-manifest.json'), 'utf8')).replace(/^\uFEFF/, ''));
const hash = content => createHash('sha256').update(content).digest('hex');
for (const entry of manifest.files) {
  assert(!/(^|\/)(state|captures|node_modules|\.git|\.env)(\/|$)/.test(entry.path), 'Private state must not be packaged');
  assert.equal(hash(await fs.readFile(path.join(payloadRoot, entry.path))), entry.sha256, entry.path);
}
const packaged = JSON.parse(await fs.readFile(path.join(payloadRoot, 'package.json'), 'utf8'));
assert.equal(packaged.productName, manifest.product);
assert.equal(packaged.version, '1.5.0');
assert.equal(hash(await fs.readFile(path.join(payloadRoot, 'web', 'vendor', 'modules.js'))), hash(await fs.readFile(path.join(repoRoot, 'web', 'vendor', 'modules.js'))));
await fs.access(path.join(extractedRoot, manifest.product + '.exe'));
const guide = await fs.readFile(path.join(payloadRoot, 'docs', 'user-guide.html'), 'utf8');
assert.match(guide, /绮绘预演台V1\.5/);
assert.match(guide, /快捷键/);
assert(!/<(?:script|link)[^>]+(?:src|href)=["']https?:/i.test(guide), 'The tutorial must be available offline');
assert.match(await fs.readFile(path.join(payloadRoot, 'desktop', 'main.cjs'), 'utf8'), /user-guide\.html/);
const privateRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'director-release-'));
const { startDirectorServer } = await import(pathToFileURL(path.join(payloadRoot, 'web', 'server.mjs')).href);
const server = await startDirectorServer({ webRoot: path.join(payloadRoot, 'web'), stateDir: path.join(privateRoot, 'state'), assetsRoot: path.join(privateRoot, 'Assets'), port: 0 });
try {
  const origin = `http://127.0.0.1:${server.address().port}`;
  const documentResponse = await fetch(origin + '/api/document');
  assert.equal(documentResponse.status, 404, 'Fresh desktop profile must not ship a saved scene');
  const page = await fetch(origin + '/');
  assert.equal(page.status, 200);
  assert.match(await page.text(), /host\.js/);
  const motions = await fetch(origin + '/assets/motions/manifest.json').then(response => response.json());
  assert(motions.motions.length >= 13);
  const catalog = await fetch(origin + '/api/assets/catalog').then(response => response.json());
  for (const category of ['characters', 'models', 'motions', 'poses']) {
    assert.equal(catalog[category].length, 0);
    assert((await fs.stat(catalog.directories[category])).isDirectory());
  }
  console.log(JSON.stringify({ status: 'passed', extractedRoot, filesVerified: manifest.files.length, motions: motions.motions.length, privateProfile: true, noSavedScene: true }, null, 2));
} finally {
  await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  await fs.rm(privateRoot, { recursive: true, force: true });
}
