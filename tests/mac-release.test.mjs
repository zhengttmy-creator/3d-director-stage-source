import assert from 'node:assert/strict';
import { createReadStream } from 'node:fs';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import yauzl from 'yauzl';
import plist from 'plist';
import crc32 from 'buffer-crc32';

const repoRoot = path.resolve(import.meta.dirname, '..');
const distRoot = path.join(repoRoot, 'dist');
const manifest = JSON.parse((await fs.readFile(path.join(distRoot, 'mac-release-manifest.json'), 'utf8')).replace(/^\uFEFF/, ''));
const hash = content => createHash('sha256').update(content).digest('hex');
const packageMetadata = JSON.parse(await fs.readFile(path.join(repoRoot, 'package.json'), 'utf8'));
const fileHash = async filename => {
  const digest = createHash('sha256');
  let bytes = 0;
  for await (const chunk of createReadStream(filename)) {
    digest.update(chunk);
    bytes += chunk.length;
  }
  return { bytes, sha256: digest.digest('hex') };
};
const relativePath = value => {
  assert.equal(typeof value, 'string');
  assert(value && !value.includes('\\') && !path.posix.isAbsolute(value), `Invalid package path: ${value}`);
  assert(!value.split('/').some(part => part === '..' || part === '.'), `Unsafe package path: ${value}`);
  return value;
};

async function readZip(filename, retain = () => false) {
  const zip = await new Promise((resolve, reject) => {
    yauzl.open(filename, { lazyEntries: true, strictFileNames: true, validateEntrySizes: true }, (error, archive) => error ? reject(error) : resolve(archive));
  });
  return new Promise((resolve, reject) => {
    const entries = new Map();
    const fail = error => {
      zip.close();
      reject(error);
    };
    zip.on('error', fail);
    zip.on('end', () => resolve(entries));
    zip.on('entry', entry => {
      (async () => {
        const name = relativePath(entry.fileName);
        assert(!entries.has(name), `Duplicate ZIP entry: ${name}`);
        assert.equal(entry.generalPurposeBitFlag & 1, 0, `Encrypted ZIP entry: ${name}`);
        const mode = entry.externalFileAttributes >>> 16;
        const digest = createHash('sha256');
        const chunks = [];
        let prefix = Buffer.alloc(0);
        let bytes = 0;
        let checksum = 0;
        if (!name.endsWith('/')) {
          const stream = await new Promise((accept, rejectStream) => zip.openReadStream(entry, (error, value) => error ? rejectStream(error) : accept(value)));
          await new Promise((accept, rejectStream) => {
            stream.on('data', chunk => {
              digest.update(chunk);
              bytes += chunk.length;
              checksum = crc32.unsigned(chunk, checksum);
              if (prefix.length < 16) prefix = Buffer.concat([prefix, chunk.subarray(0, 16 - prefix.length)]);
              if (retain(name, mode)) chunks.push(chunk);
            });
            stream.once('end', accept);
            stream.once('error', rejectStream);
          });
        }
        assert.equal(bytes, entry.uncompressedSize, `ZIP size mismatch: ${name}`);
        assert.equal(checksum, entry.crc32, `ZIP CRC mismatch: ${name}`);
        entries.set(name, { bytes, sha256: digest.digest('hex'), mode, unix: entry.versionMadeBy >>> 8 === 3, prefix, content: chunks.length ? Buffer.concat(chunks) : Buffer.alloc(0) });
        zip.readEntry();
      })().catch(fail);
    });
    zip.readEntry();
  });
}

assert.equal(manifest.product, packageMetadata.productName);
assert.equal(manifest.version, packageMetadata.version);
assert.equal(manifest.platform, 'darwin');
assert.equal(manifest.arch, 'arm64');
assert.equal(manifest.minimumSystemVersion, '11.0');
assert.equal(manifest.developerIdSigned, false);
assert.equal(manifest.notarized, false);
assert.equal(manifest.macRuntimeTested, false, 'This test verifies package structure and the server, not execution on macOS');
assert.equal(path.basename(manifest.appRoot), `${manifest.product}.app`);
relativePath(manifest.archiveRoot);
assert(!manifest.archiveRoot.includes('/'), 'The archive must have a single top-level directory');
const archive = path.join(distRoot, relativePath(manifest.archive));
const appPrefix = `${manifest.archiveRoot}/${manifest.product}.app/`;
const sourcePrefix = `${appPrefix}Contents/Resources/app/`;
const entries = await readZip(archive, (name, mode) => (mode & 0o170000) === 0o120000 || name.endsWith('.plist') || name.endsWith('.html') || name === `${sourcePrefix}package.json` || name === `${sourcePrefix}desktop/main.cjs`);
for (const name of entries.keys()) {
  assert(name.startsWith(`${manifest.archiveRoot}/`), `Unexpected archive root: ${name}`);
  assert(!/(^|\/)(node_modules|\.git|\.env(?:\.[^/]*)?|captures)(\/|$)/.test(name) && !/(^|\/)web\/state(\/|$)/.test(name), `Private/generated data in release: ${name}`);
}
const getEntry = name => {
  const entry = entries.get(name);
  assert(entry, `Missing ZIP entry: ${name}`);
  return entry;
};

const packagedSources = new Set(manifest.files.map(file => relativePath(file.path)));
assert.equal(packagedSources.size, manifest.files.length, 'Duplicate source manifest entry');
for (const file of manifest.files) {
  const entry = getEntry(sourcePrefix + file.path);
  assert.equal(entry.bytes, file.bytes, `Source size: ${file.path}`);
  assert.equal(entry.sha256, file.sha256, `Source hash: ${file.path}`);
  assert.equal(entry.mode & 0o170000, 0o100000, `Source must be a regular file: ${file.path}`);
  assert.deepEqual(await fileHash(path.join(manifest.appRoot, 'Contents', 'Resources', 'app', file.path)), { bytes: file.bytes, sha256: file.sha256 }, `Staged source mismatch: ${file.path}`);
  if (file.path !== 'package.json') assert.equal((await fileHash(path.join(repoRoot, file.path))).sha256, file.sha256, `Source differs from working tree: ${file.path}`);
}
for (const [name, entry] of entries) {
  if (name.startsWith(sourcePrefix) && !name.endsWith('/')) assert(packagedSources.has(name.slice(sourcePrefix.length)), `Unlisted app source: ${name}`);
  if (name.startsWith(sourcePrefix)) assert.notEqual(entry.mode & 0o170000, 0o120000, `Unexpected app-source symlink: ${name}`);
}
const packaged = JSON.parse(getEntry(`${sourcePrefix}package.json`).content.toString('utf8'));
assert.equal(packaged.productName, manifest.product);
assert.equal(packaged.version, manifest.version);
assert(getEntry(`${sourcePrefix}${relativePath(packaged.main)}`));
const guide = getEntry(`${sourcePrefix}docs/user-guide.html`).content.toString('utf8');
assert.match(guide, /绮绘预演台V1\.5/);
assert.match(guide, /快捷键/);
assert(!/<(?:script|link)[^>]+(?:src|href)=["']https?:/i.test(guide), 'The tutorial must work offline');
assert.match(getEntry(`${sourcePrefix}desktop/main.cjs`).content.toString('utf8'), /user-guide\.html/);
assert.match(getEntry(`${sourcePrefix}desktop/main.cjs`).content.toString('utf8'), /accelerator:\s*["']F1["']/);

for (const [document, filename] of [['user-guide.html', `${manifest.product}-使用教程.html`], ['mac-install.html', `${manifest.product}-macOS-安装说明.html`]]) {
  const expectedHash = hash(await fs.readFile(path.join(repoRoot, 'docs', document)));
  assert.equal(getEntry(`${manifest.archiveRoot}/${filename}`).sha256, expectedHash, `Missing or stale top-level document: ${document}`);
  assert.equal(getEntry(`${sourcePrefix}docs/${document}`).sha256, expectedHash);
}

const mainInfoPath = `${appPrefix}Contents/Info.plist`;
const mainInfo = plist.parse(getEntry(mainInfoPath).content.toString('utf8'));
assert.equal(mainInfo.CFBundleName, manifest.product);
assert.equal(mainInfo.CFBundleDisplayName, manifest.product);
assert.equal(mainInfo.CFBundleExecutable, manifest.product);
assert.equal(mainInfo.CFBundleShortVersionString, manifest.version);
assert.equal(mainInfo.LSMinimumSystemVersion, manifest.minimumSystemVersion);
const arm64 = (entry, name) => {
  assert(entry.prefix.length >= 12, `Missing Mach-O header: ${name}`);
  assert.equal(entry.prefix.readUInt32LE(0), 0xfeedfacf, `Expected a 64-bit Mach-O binary: ${name}`);
  assert.equal(entry.prefix.readUInt32LE(4), 0x0100000c, `Expected Apple Silicon arm64: ${name}`);
};
let executablePlists = 0;
for (const [name, entry] of entries) {
  if (!name.startsWith(appPrefix) || !/\.app\/Contents\/Info\.plist$/.test(name)) continue;
  const info = plist.parse(entry.content.toString('utf8'));
  const executableName = relativePath(info.CFBundleExecutable);
  assert(!executableName.includes('/'));
  const executablePath = `${path.posix.dirname(name)}/MacOS/${executableName}`;
  const executable = getEntry(executablePath);
  assert(executable.unix, `Unix permissions missing: ${executablePath}`);
  assert.equal(executable.mode & 0o170777, 0o100755, `Executable permissions: ${executablePath}`);
  arm64(executable, executablePath);
  executablePlists++;
}
assert(executablePlists >= 5, 'Main app and all Electron helpers must have valid executables');

const runtimeArchive = path.resolve(process.argv[2] || manifest.electronArchive || path.join(os.homedir(), 'AppData', 'Local', 'electron', 'Cache', `electron-v${manifest.electron}-darwin-arm64.zip`));
const officialChecksums = JSON.parse(await fs.readFile(path.join(repoRoot, 'node_modules', 'electron', 'checksums.json'), 'utf8'));
assert.equal((await fileHash(runtimeArchive)).sha256, officialChecksums[`electron-v${manifest.electron}-darwin-arm64.zip`], 'The reference runtime must match the official Electron checksum');
const officialRuntime = await readZip(runtimeArchive);
assert(manifest.runtimeBinaries.length >= executablePlists, 'The runtime manifest must cover all executables');
const binaryPaths = new Set();
for (const binary of manifest.runtimeBinaries) {
  const name = appPrefix + relativePath(binary.path);
  assert(!binaryPaths.has(name), `Duplicate runtime binary: ${name}`);
  binaryPaths.add(name);
  const entry = getEntry(name);
  const original = officialRuntime.get(relativePath(binary.sourcePath));
  assert(original, `Official runtime source missing: ${binary.sourcePath}`);
  assert.equal(entry.sha256, original.sha256, `Official Electron binary changed: ${binary.path}`);
  assert.equal(entry.sha256, binary.sha256, `Runtime binary hash: ${binary.path}`);
  assert.equal(entry.bytes, binary.bytes, `Runtime binary size: ${binary.path}`);
  const expectedMode = typeof binary.mode === 'string' ? Number.parseInt(binary.mode, 8) : binary.mode;
  assert.equal(entry.mode & 0o777, expectedMode & 0o777, `Runtime binary permissions: ${binary.path}`);
  assert.equal(entry.mode & 0o170000, 0o100000, `Runtime must be a regular file: ${binary.path}`);
  assert(entry.unix && (entry.mode & 0o111) !== 0, `Runtime is not executable: ${binary.path}`);
  arm64(entry, name);
}
for (const [name, entry] of entries) {
  if (name.startsWith(appPrefix) && entry.prefix.length >= 8 && entry.prefix.readUInt32LE(0) === 0xfeedfacf) assert(binaryPaths.has(name), `Unverified Mach-O binary: ${name}`);
}

const links = new Map([...entries].filter(([, entry]) => (entry.mode & 0o170000) === 0o120000).map(([name, entry]) => [name, entry.content.toString('utf8')]));
assert.equal(links.size, 14, 'All Electron framework symlinks must be preserved');
assert.equal(manifest.symlinks.length, links.size);
const linkPaths = new Set();
const resolveLink = initial => {
  let current = initial;
  for (let iteration = 0; iteration < 64; iteration++) {
    assert(current.startsWith(appPrefix), `Symlink escapes the app: ${initial}`);
    const parts = current.split('/');
    let replaced = false;
    for (let length = 1; length <= parts.length; length++) {
      const prefix = parts.slice(0, length).join('/');
      if (!links.has(prefix)) continue;
      current = path.posix.normalize(path.posix.join(path.posix.dirname(prefix), links.get(prefix), ...parts.slice(length)));
      replaced = true;
      break;
    }
    if (!replaced) return current;
  }
  assert.fail(`Circular symlink: ${initial}`);
};
for (const link of manifest.symlinks) {
  const name = appPrefix + relativePath(link.path);
  assert(!linkPaths.has(name), `Duplicate symlink manifest entry: ${name}`);
  linkPaths.add(name);
  assert.equal(links.get(name), link.target, `Symlink target mismatch: ${name}`);
  assert(getEntry(name).unix, `Symlink lacks Unix attributes: ${name}`);
  assert(link.target && !path.posix.isAbsolute(link.target) && !link.target.includes('\\'), `Symlink target must be relative: ${name}`);
  const destination = resolveLink(name);
  assert(entries.has(destination) || entries.has(`${destination}/`) || [...entries.keys()].some(key => key.startsWith(`${destination}/`)), `Broken symlink: ${name} -> ${link.target}`);
}
assert(manifest.artifacts.some(artifact => artifact.name === manifest.archive), 'The ZIP must be listed as a release artifact');
for (const artifact of manifest.artifacts) assert.deepEqual(await fileHash(path.join(distRoot, relativePath(artifact.name))), { bytes: artifact.bytes, sha256: artifact.sha256 }, `Release artifact: ${artifact.name}`);

const privateRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'director-mac-release-'));
let server;
let motionCount;
try {
  const payloadRoot = path.join(manifest.appRoot, 'Contents', 'Resources', 'app');
  const { startDirectorServer } = await import(pathToFileURL(path.join(payloadRoot, 'web', 'server.mjs')).href);
  server = await startDirectorServer({ webRoot: path.join(payloadRoot, 'web'), stateDir: path.join(privateRoot, 'state'), assetsRoot: path.join(privateRoot, 'Assets'), port: 0 });
  const origin = `http://127.0.0.1:${server.address().port}`;
  const documentResponse = await fetch(`${origin}/api/document`);
  assert.equal(documentResponse.status, 404, 'Fresh release must not ship a saved scene');
  await documentResponse.text();
  const page = await fetch(`${origin}/`);
  assert.equal(page.status, 200);
  assert.match(await page.text(), /host\.js/);
  const motions = await fetch(`${origin}/assets/motions/manifest.json`).then(response => response.json());
  motionCount = motions.motions.length;
  assert(motionCount >= 16, 'The current built-in motion library must be included');
  const catalog = await fetch(`${origin}/api/assets/catalog`).then(response => response.json());
  for (const category of ['characters', 'models', 'motions', 'poses']) {
    assert.equal(catalog[category].length, 0, `Personal assets leaked into ${category}`);
    assert.equal(await fs.realpath(catalog.directories[category]), await fs.realpath(path.join(privateRoot, 'Assets', category)));
    assert.deepEqual(await fs.readdir(catalog.directories[category]), [], `Fresh asset directory is not empty: ${category}`);
  }
} finally {
  if (server) {
    server.closeIdleConnections?.();
    await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
  assert.equal(path.dirname(path.resolve(privateRoot)), path.resolve(os.tmpdir()), 'Cleanup must stay in the temporary directory');
  assert(path.basename(privateRoot).startsWith('director-mac-release-'));
  await fs.rm(privateRoot, { recursive: true, force: true });
}
console.log(JSON.stringify({ status: 'passed', archive, entries: entries.size, files: manifest.files.length, binaries: manifest.runtimeBinaries.length, links: links.size, motions: motionCount, macRuntimeTested: false }, null, 2));
