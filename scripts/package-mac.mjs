import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { createReadStream, createWriteStream } from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { pipeline } from 'node:stream/promises';
import yauzl from 'yauzl';
import yazl from 'yazl';
import plist from 'plist';
import png2icons from 'png2icons';

const repoRoot = path.resolve(import.meta.dirname, '..');
const distRoot = path.join(repoRoot, 'dist');
const metadata = JSON.parse(await fs.readFile(path.join(repoRoot, 'package.json'), 'utf8'));
const electronVersion = metadata.devDependencies.electron;
const archiveName = `electron-v${electronVersion}-darwin-arm64.zip`;
const electronZipDir = path.resolve(process.argv[2] || process.env.ELECTRON_MAC_ZIP_DIR || '');
const runtimeArchive = path.join(electronZipDir, archiveName);
const checksums = JSON.parse(await fs.readFile(path.join(repoRoot, 'node_modules/electron/checksums.json'), 'utf8'));

async function digest(file) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest('hex');
}

const electronArchiveSha256 = await digest(runtimeArchive);
assert.equal(electronArchiveSha256, checksums[archiveName], 'The Electron ARM64 archive must match its official checksum');

async function readRuntimeInventory(file) {
  return new Promise((resolve, reject) => {
    yauzl.open(file, { lazyEntries: true }, (error, zip) => {
      if (error) return reject(error);
      const entries = new Map();
      zip.on('error', reject);
      zip.on('entry', async entry => {
        try {
          const mode = entry.externalFileAttributes >>> 16;
          const record = { mode, bytes: entry.uncompressedSize };
          if ((mode & 0o170000) === 0o100000 && (mode & 0o111)) {
            const stream = await new Promise((yes, no) => zip.openReadStream(entry, (e, value) => e ? no(e) : yes(value)));
            const hash = createHash('sha256');
            let header;
            for await (const chunk of stream) {
              header ||= chunk.subarray(0, 32);
              hash.update(chunk);
            }
            if (header?.length >= 8 && header.readUInt32LE(0) === 0xfeedfacf) {
              assert.equal(header.readUInt32LE(4), 0x0100000c, 'Every runtime executable must be ARM64');
              record.sha256 = hash.digest('hex');
            }
          }
          entries.set(entry.fileName, record);
          zip.readEntry();
        } catch (error) { zip.close(); reject(error); }
      });
      zip.on('end', () => resolve(entries));
      zip.readEntry();
    });
  });
}

const runtimeEntries = await readRuntimeInventory(runtimeArchive);
execFileSync(process.execPath, ['scripts/build-vendor.cjs'], { cwd: repoRoot, stdio: 'inherit' });
await fs.mkdir(distRoot, { recursive: true });
const stageRoot = await fs.mkdtemp(path.join(distRoot, 'mac-stage-'));
assert(stageRoot.startsWith(distRoot + path.sep));
const payloadSource = path.join(stageRoot, 'source');
await fs.mkdir(payloadSource);

async function copySources(source, destination, relative = '') {
  await fs.mkdir(destination, { recursive: true });
  for (const entry of await fs.readdir(source, { withFileTypes: true })) {
    const next = path.posix.join(relative, entry.name);
    if (next === 'web/state' || next === 'web/assets/captures') continue;
    assert(!entry.isSymbolicLink(), `Unexpected source symlink: ${next}`);
    if (entry.isDirectory()) await copySources(path.join(source, entry.name), path.join(destination, entry.name), next);
    else await fs.copyFile(path.join(source, entry.name), path.join(destination, entry.name));
  }
}

for (const directory of ['desktop', 'web', 'docs']) {
  await copySources(path.join(repoRoot, directory), path.join(payloadSource, directory), directory);
}
for (const name of ['package.json', 'app.ico', 'THIRD_PARTY.md']) {
  await fs.copyFile(path.join(repoRoot, name), path.join(payloadSource, name));
}
await fs.mkdir(path.join(payloadSource, 'seed'));

// Reuse the existing brand artwork; png2icons emits all macOS icon resolutions.
const ico = await fs.readFile(path.join(repoRoot, 'app.ico'));
assert.equal(ico.readUInt16LE(2), 1);
const images = Array.from({ length: ico.readUInt16LE(4) }, (_, index) => {
  const offset = 6 + index * 16;
  return { width: ico[offset] || 256, bytes: ico.readUInt32LE(offset + 8), offset: ico.readUInt32LE(offset + 12) };
}).sort((a, b) => b.width - a.width);
const largest = images[0];
const png = ico.subarray(largest.offset, largest.offset + largest.bytes);
assert(png.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])));
const icns = png2icons.createICNS(png, png2icons.BICUBIC, 0);
assert(icns, 'Could not convert the application icon');
const iconPath = path.join(stageRoot, 'app.icns');
await fs.writeFile(iconPath, icns);

const outputRoot = path.join(stageRoot, 'output');
const appName = metadata.productName + '.app';
const appRoot = path.join(outputRoot, appName);
const payloadRoot = path.join(appRoot, 'Contents/Resources/app');
const symlinks = [];

function brandedPath(name) {
  if (!name.startsWith('Electron.app/')) return name;
  return name.split('/').map(part => {
    if (part === 'Electron.app') return appName;
    if (part === 'Electron') return metadata.productName;
    if (part.startsWith('Electron Helper')) return metadata.productName + part.slice('Electron'.length);
    return part;
  }).join('/');
}

const sourcePaths = new Map([...runtimeEntries.keys()].map(name => [brandedPath(name), name]));
// Store Unix links directly in ZIP; the Windows staging tree needs no symlinks.
await new Promise((resolve, reject) => {
  yauzl.open(runtimeArchive, { lazyEntries: true }, (error, input) => {
    if (error) return reject(error);
    input.on('error', reject);
    input.on('entry', async entry => {
      try {
        const name = brandedPath(entry.fileName);
        const destination = path.resolve(outputRoot, name);
        assert(destination.startsWith(outputRoot + path.sep));
        const mode = entry.externalFileAttributes >>> 16;
        if (entry.fileName === 'Electron.app/Contents/Resources/default_app.asar'
          || entry.fileName === 'Electron.app/Contents/Resources/electron.icns') {
          input.readEntry();
          return;
        }
        if (entry.fileName.endsWith('/')) await fs.mkdir(destination, { recursive: true });
        else {
          const stream = await new Promise((yes, no) => input.openReadStream(entry, (e, value) => e ? no(e) : yes(value)));
          if ((mode & 0o170000) === 0o120000) {
            const chunks = [];
            await new Promise((yes, no) => {
              stream.on('data', chunk => chunks.push(chunk));
              stream.on('end', yes);
              stream.on('error', no);
            });
            const target = Buffer.concat(chunks).toString('utf8');
            const relative = name.slice(appName.length + 1);
            const resolved = path.posix.normalize(path.posix.join(path.posix.dirname(relative), target));
            assert(name.startsWith(appName + '/') && !path.posix.isAbsolute(target) && !resolved.startsWith('../'));
            symlinks.push({ path: relative, target });
          } else {
            await fs.mkdir(path.dirname(destination), { recursive: true });
            await pipeline(stream, createWriteStream(destination));
            const mainPlist = entry.fileName === 'Electron.app/Contents/Info.plist';
            const helperPlist = entry.fileName.match(/\/(Electron Helper[^/]*)\.app\/Contents\/Info\.plist$/);
            if (mainPlist || helperPlist) {
              const info = plist.parse(await fs.readFile(destination, 'utf8'));
              const suffix = mainPlist ? '' : helperPlist[1].slice('Electron'.length);
              info.CFBundleName = metadata.productName + suffix;
              info.CFBundleDisplayName = metadata.productName + suffix;
              info.CFBundleExecutable = metadata.productName + suffix;
              const role = suffix.replace(' Helper', '').replace(/[()]/g, '').trim().toLowerCase();
              info.CFBundleIdentifier = metadata.build.appId + (mainPlist ? '' : '.helper' + (role ? '.' + role : ''));
              info.CFBundleVersion = metadata.version;
              info.CFBundleShortVersionString = metadata.version;
              if (mainPlist) {
                info.CFBundleIconFile = 'app.icns';
                info.LSApplicationCategoryType = 'public.app-category.video';
                info.NSRequiresAquaSystemAppearance = false;
                delete info.ElectronAsarIntegrity;
              }
              await fs.writeFile(destination, plist.build(info));
            }
          }
        }
        input.readEntry();
      } catch (error) { input.close(); reject(error); }
    });
    input.on('end', resolve);
    input.readEntry();
  });
});
await fs.cp(payloadSource, payloadRoot, { recursive: true });
await fs.copyFile(iconPath, path.join(appRoot, 'Contents/Resources/app.icns'));
const appPlist = plist.parse(await fs.readFile(path.join(appRoot, 'Contents/Info.plist'), 'utf8'));
const guideName = metadata.productName + '-使用教程.html';
const installName = metadata.productName + '-macOS-安装说明.html';
await fs.copyFile(path.join(repoRoot, 'docs/user-guide.html'), path.join(outputRoot, guideName));
await fs.copyFile(path.join(repoRoot, 'docs/mac-install.html'), path.join(outputRoot, installName));

const files = [];
async function recordPayload(directory, relative = '') {
  for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
    const name = path.posix.join(relative, entry.name);
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) await recordPayload(file, name);
    else {
      const sha256 = await digest(file);
      assert.equal(sha256, await digest(path.join(repoRoot, name)), `Packaged source changed: ${name}`);
      files.push({ path: name, bytes: (await fs.stat(file)).size, sha256 });
    }
  }
}
await recordPayload(payloadRoot);

const archiveRoot = metadata.productName + '-macOS-arm64';
const archive = archiveRoot + '.zip';
const archivePath = path.join(distRoot, archive);
const runtimeBinaries = [];
const zip = new yazl.ZipFile();
const completed = pipeline(zip.outputStream, createWriteStream(archivePath));

async function addDirectory(directory, relative = '') {
  for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
    const name = path.posix.join(relative, entry.name);
    const file = path.join(directory, entry.name);
    const zipName = path.posix.join(archiveRoot, name);
    const stat = await fs.lstat(file);
    const appRelative = name.startsWith(appName + '/') ? name.slice(appName.length + 1) : null;
    const sourcePath = sourcePaths.get(name);
    const original = runtimeEntries.get(sourcePath);
    assert(!stat.isSymbolicLink(), 'Unexpected host symlink in the build directory');
    if (stat.isDirectory()) {
      zip.addEmptyDirectory(zipName, { mode: 0o40755, mtime: stat.mtime });
      await addDirectory(file, name);
    } else {
      const mode = original?.mode || 0o100644;
      if (original?.sha256) {
        const sha256 = await digest(file);
        assert.equal(sha256, original.sha256, `Runtime signature would be invalidated: ${name}`);
        runtimeBinaries.push({ path: appRelative, sourcePath, bytes: stat.size, sha256, mode });
      }
      zip.addFile(file, zipName, { mode, mtime: stat.mtime, compressionLevel: 6 });
    }
  }
}

try {
  await addDirectory(outputRoot);
  assert.equal(runtimeBinaries.length, [...runtimeEntries.values()].filter(entry => entry.sha256).length, 'A runtime executable is missing');
  assert.equal(symlinks.length, [...runtimeEntries.values()].filter(entry => (entry.mode & 0o170000) === 0o120000).length, 'A framework link is missing');
  for (const link of symlinks) {
    zip.addBuffer(Buffer.from(link.target), path.posix.join(archiveRoot, appName, link.path), { mode: 0o120777, compress: false });
  }
  zip.end();
  await completed;
} catch (error) {
  zip.outputStream.destroy(error);
  await completed.catch(() => {});
  throw error;
}

const guideDirectory = path.join(distRoot, 'macOS-arm64');
await fs.mkdir(guideDirectory, { recursive: true });
const artifacts = [];
for (const name of [archive, path.posix.join('macOS-arm64', guideName), path.posix.join('macOS-arm64', installName)]) {
  const file = path.join(distRoot, name);
  if (name !== archive) await fs.copyFile(path.join(outputRoot, path.basename(name)), file);
  artifacts.push({ name, bytes: (await fs.stat(file)).size, sha256: await digest(file) });
}
const manifest = {
  product: metadata.productName, version: metadata.version, platform: 'darwin', arch: 'arm64',
  electron: electronVersion, electronArchiveSha256, minimumSystemVersion: appPlist.LSMinimumSystemVersion,
  developerIdSigned: false, notarized: false, macRuntimeTested: false,
  runtimeSignatures: 'Original Electron ARM64 executable bytes preserved',
  appRoot, archiveRoot, archive, files, runtimeBinaries, symlinks, artifacts,
};
await fs.writeFile(path.join(distRoot, 'mac-release-manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
console.log(JSON.stringify({ artifacts, sourceFiles: files.length, runtimeBinaries: runtimeBinaries.length, symlinks: symlinks.length, appRoot }, null, 2));
