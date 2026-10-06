import fs from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const parser = require('@babel/parser');
const testSource = await fs.readFile(path.join(root, 'tests/extension-backend.test.cjs'), 'utf8');
const parsed = parser.parse(testSource);
const testNode = parsed.program.body.find(node => node.type === 'FunctionDeclaration' && node.id.name === 'browserChecks');
if (!testNode) throw new Error('Missing browserChecks fixture');
const runId = randomUUID();
const backend = (await fs.readFile(path.join(root, 'extension/browser-backend.js'), 'utf8'))
  .replace("const dbName = 'qihui-director-extension-v1';", "const dbName = 'qihui-director-extension-test-" + runId + "';");
const testScript = testSource.slice(testNode.start, testNode.end) + `
(async () => {
  const report = result => {
    document.body.textContent = JSON.stringify(result, null, 2);
    document.body.dataset.testStatus = result.status;
  };
  try {
    const key = 'qihui-backend-test-${runId}';
    const stored = sessionStorage.getItem(key);
    if (!stored) {
      const result = await browserChecks();
      sessionStorage.setItem(key, JSON.stringify(result));
      report({status:'reloading',...result});
      location.reload();
      return;
    }
    await localDirectorExtension.ready;
    const result = JSON.parse(stored);
    const catalog = await (await fetch('/api/assets/catalog')).json();
    const capture = (await (await fetch('/api/captures')).json()).items[0];
    if(catalog.models[0].assetId !== result.modelId || capture.assetId !== result.captureId || !(await fetch(capture.mediaUrl)).ok || !localDirectorExtension.ownsMediaUrl(capture.mediaUrl)) throw new Error('Reload persistence failed');
    if(capture.backgroundDeleted !== true) throw new Error('Background deletion lost after reload');
    const restore = await fetch('/api/captures/' + capture.assetId + '/background', {method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({deleted:false})});
    if(!restore.ok || (await restore.json()).backgroundDeleted !== false) throw new Error('Background restore after reload failed');
    report({status:'passed',checks:result.checks,reloadPersistence:true,backgroundDeletionPersistence:true,modelId:result.modelId,captureId:result.captureId});
  } catch(error) {
    console.error(error);
    report({status:'failed',message:error.message,stack:error.stack});
  }
})();
`;
const server = http.createServer((request, response) => {
  response.setHeader('Cache-Control', 'no-store');
  response.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; connect-src 'self' blob:; object-src 'none'");
  if (request.url === '/browser-backend.js') { response.setHeader('Content-Type', 'text/javascript'); response.end(backend); }
  else if (request.url === '/cases.js') { response.setHeader('Content-Type', 'text/javascript'); response.end(testScript); }
  else if (request.url === '/') { response.setHeader('Content-Type', 'text/html; charset=utf-8'); response.end('<!doctype html><meta charset="utf-8"><title>Extension backend verification</title><body>Running extension backend tests<script src="/browser-backend.js"></script><script src="/cases.js"></script>'); }
  else { response.statusCode = 404; response.end('Not found'); }
});
server.listen(4216, '127.0.0.1', () => console.log(JSON.stringify({ port: 4216, pid: process.pid, runId })));
