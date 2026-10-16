import fs from 'node:fs/promises';
import { createWriteStream } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { once } from 'node:events';
import yazl from 'yazl';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const metadata = JSON.parse(await fs.readFile(path.join(root, 'package.json'), 'utf8'));
const versionLabel = 'V' + metadata.version.split('.').slice(0, 2).join('.');
const folder = 'Qihui-Previz-' + versionLabel;
const output = path.resolve(process.argv[2] || path.join(root, 'dist'));
await fs.mkdir(output, { recursive: true });
const files = [];
const excluded = /(^|\/)(node_modules|\.git|\.npm-cache|\.env(?:\.[^/]*)?|state|captures|video-files|capture-files|reports|dist)(\/|$)|\.(?:log|pending)$/i;
async function collect(relative) {
  if (excluded.test(relative) || /^web\/assets\/videos(?:\/|$)/.test(relative)) return;
  const stat = await fs.lstat(path.join(root, relative));
  if (stat.isSymbolicLink()) throw new Error('Unexpected symbolic link: ' + relative);
  if (stat.isDirectory()) {
    for (const name of (await fs.readdir(path.join(root, relative))).sort()) await collect(relative + '/' + name);
  } else if (stat.isFile()) files.push(relative);
}
for (const dir of ['desktop', 'docs', 'extension', 'scripts', 'sources', 'src', 'tests', 'web']) await collect(dir);
for (const file of ['package.json', 'package-lock.json', 'README.md', 'CHANGELOG.md', 'THIRD_PARTY.md', 'app.ico', '.gitignore', 'START-HERE.md', 'start-windows.cmd', 'start-macos.command', 'seed/.gitkeep']) await collect(file);
try { await fs.access(path.join(root, 'LICENSE')); await collect('LICENSE'); } catch (error) { if (error.code !== 'ENOENT') throw error; }
for (const required of ['src/vendor/module-factories.json', 'web/vendor/modules.js', 'web/vendor/locale.js', 'web/assets/character.fbx', 'web/assets/characters/manifest.json', 'web/assets/motions/manifest.json', 'web/assets/poses/manifest.json']) {
  if (!files.includes(required)) throw new Error('Missing full-project resource: ' + required);
}
const records = [];
for (const file of files.sort()) {
  const content = await fs.readFile(path.join(root, file));
  records.push({ path: file, bytes: content.length, sha256: createHash('sha256').update(content).digest('hex') });
}
const manifest = { product: metadata.productName, version: metadata.version, format: 'qihui-full-project', fileCount: records.length, totalBytes: records.reduce((n, f) => n + f.bytes, 0), files: records };
const archive = path.join(output, folder + '-Full-Project.zip');
const zip = new yazl.ZipFile();
const stream = createWriteStream(archive);
const complete = once(stream, 'close');
zip.outputStream.on('error', error => stream.destroy(error));
zip.outputStream.pipe(stream);
for (const entry of records) zip.addFile(path.join(root, entry.path), folder + '/' + entry.path, { mode: entry.path.endsWith('.command') ? 0o100755 : 0o100644 });
zip.addBuffer(Buffer.from(JSON.stringify(manifest, null, 2) + '\n'), folder + '/FULL-PROJECT-MANIFEST.json');
zip.end();
await complete;
const content = await fs.readFile(archive);
const sha256 = createHash('sha256').update(content).digest('hex');
await fs.writeFile(path.join(output, 'SHA256-Full-Project.txt'), sha256 + '  ' + path.basename(archive) + '\n');
await fs.writeFile(path.join(output, 'full-project-release-manifest.json'), JSON.stringify({ ...manifest, archive: path.basename(archive), bytes: content.length, sha256 }, null, 2) + '\n');
console.log(JSON.stringify({ archive, bytes: content.length, sha256, fileCount: records.length, totalBytes: manifest.totalBytes }));
