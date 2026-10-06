import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';

const require = createRequire(import.meta.url);
const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const output = path.join(repo, 'dist', 'browser-extension');
await fs.mkdir(output, {recursive: true});
const copy = async (from, to) => fs.cp(path.join(repo, from), path.join(output, to), {recursive: true});
for (const folder of ['assets', 'styles', 'vendor']) {
  await fs.cp(path.join(repo, 'web', folder), path.join(output, folder), {recursive: true,
    filter: source => !/^captures$|^videos$/.test(path.basename(source))});
}
for (const name of ['host.css', 'runtime.js', 'motion-library.js']) await copy('web/' + name, name);
for (const name of ['manifest.json', 'background.js', 'browser-backend.js', 'browser-ui.js']) await copy('extension/' + name, name);
await copy('THIRD_PARTY.md', 'THIRD_PARTY.md');
await copy('extension/INSTALL.md', 'INSTALL.md');

function replaceOnce(source, before, after, label) {
  if (source.split(before).length !== 2) throw new Error('Extension patch mismatch: ' + label);
  return source.replace(before, after);
}
function replaceFunction(source, name, body) {
  const ast = require('@babel/parser').parse(source);
  let node;
  require('@babel/traverse').default(ast, {FunctionDeclaration(p) {if (p.node.id?.name === name) node = p.node;}});
  if (!node) throw new Error('Missing extension host function: ' + name);
  return source.slice(0, node.start) + body + source.slice(node.end);
}
let html = await fs.readFile(path.join(repo, 'web/index.html'), 'utf8');
html = replaceOnce(html, '<script src="/captures.js"></script>', '<script src="/browser-backend.js"></script>\n  <script src="/browser-ui.js"></script>\n  <script src="/captures.js"></script>', 'bootstrap');
await fs.writeFile(path.join(output, 'index.html'), html);
let host = await fs.readFile(path.join(repo, 'web/host.js'), 'utf8');
if (!host.startsWith('(async () => {')) throw new Error('Missing host bootstrap');
host = host.replace('(async () => {', '(async () => {\n  await window.localDirectorExtension.ready;');
host = replaceOnce(host, 'const [startup, setStartup] = React.useState(null);', 'const [startup, setStartup] = React.useState({connected: false});', 'offline startup');
host = replaceFunction(host, 'AssetFolders', 'function AssetFolders(props) {return h(window.localDirectorExtension.AssetLibrary, props);}');
await fs.writeFile(path.join(output, 'host.js'), host);
let captures = await fs.readFile(path.join(repo, 'web/captures.js'), 'utf8');
captures = captures.replaceAll("if (url.origin !== location.origin)", "if (url.origin !== location.origin && !window.localDirectorExtension.ownsMediaUrl(url.href))");
captures = replaceOnce(captures, 'return await uploadCapturesToRemoteCanvas(captures);',
  "const items = Array.isArray(captures) && captures.length ? captures : await readIndex();\n        for (const item of items) window.localDirectorExtension.download(item.mediaUrl, item.title || 'capture.jpg');\n        return {ok: true, captureIds: items.map(item => item.captureId || item.id || item.assetId)};", 'local photo export');
captures = replaceOnce(captures, 'await uploadVideosToRemoteCanvas([asset]);', '', 'local video storage');
await fs.writeFile(path.join(output, 'captures.js'), captures);
let modules = await fs.readFile(path.join(repo, 'web/vendor/modules.js'), 'utf8');
modules = require('./extension-workers.cjs').patchExtensionWorkers(modules, output);
const ast = require('@babel/parser').parse(modules);
let resourceNode;
require('@babel/traverse').default(ast, {FunctionDeclaration(p) {if (p.node.id?.name === '__localResolveModelResource') resourceNode = p.node;}});
if (!resourceNode) throw new Error('Missing imported texture URL resolver');
const original = modules.slice(resourceNode.start, resourceNode.end);
const inner = original.replace('__localResolveModelResource', '__extensionOriginalModelResource');
modules = modules.slice(0, resourceNode.start) + inner + '\nfunction __localResolveModelResource(...args){return window.localDirectorExtension.resolveAssetUrl(__extensionOriginalModelResource(...args));}\n' + modules.slice(resourceNode.end);
await fs.writeFile(path.join(output, 'vendor/modules.js'), modules);

const ico = await fs.readFile(path.join(repo, 'app.ico'));
await fs.mkdir(path.join(output, 'icons'), {recursive: true});
for (let index = 0; index < ico.readUInt16LE(4); index++) {
  const entry = 6 + index * 16;
  const size = ico[entry] || 256;
  if (![16, 32, 48, 128].includes(size)) continue;
  const offset = ico.readUInt32LE(entry + 12);
  const png = ico.subarray(offset, offset + ico.readUInt32LE(entry + 8));
  if (png.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a') throw new Error('Extension icon must be PNG');
  await fs.writeFile(path.join(output, 'icons', size + '.png'), png);
}
const manifest = JSON.parse(await fs.readFile(path.join(output, 'manifest.json'), 'utf8'));
const extensionId = [...createHash('sha256').update(Buffer.from(manifest.key, 'base64')).digest('hex').slice(0, 32)].map(char => String.fromCharCode(97 + parseInt(char, 16))).join('');
console.log(JSON.stringify({output, extensionId, url: 'chrome-extension://' + extensionId + '/index.html'}, null, 2));
