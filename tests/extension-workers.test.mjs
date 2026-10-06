import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { after, test } from 'node:test';
import { deflateRawSync } from 'node:zlib';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const parser = require('@babel/parser');
const traverse = require('@babel/traverse').default;
const { patchExtensionWorkers } = require('../scripts/extension-workers.cjs');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'director-extension-workers-test-'));
const source = fs.readFileSync(new URL('../web/vendor/modules.js', import.meta.url), 'utf8');
const result = patchExtensionWorkers(source, root);
const workerDirectory = path.join(root, 'vendor', 'extension-workers');
const readWorker = name => fs.readFileSync(path.join(workerDirectory, name), 'utf8');
after(() => fs.rmSync(root, { recursive: true, force: true }));

function sandbox(extra = {}) {
  const messages = [];
  const listeners = new Map();
  const context = vm.createContext({
    ...extra,
    postMessage: (...args) => messages.push(args),
    addEventListener: (name, listener) => listeners.set(name, listener),
  }, { codeGeneration: { strings: false, wasm: false } });
  context.self = context;
  return { context, messages, listeners };
}

test('all eight main workers use packaged URLs and all six packaged workers parse under strict CSP', () => {
  let workers = 0;
  traverse(parser.parse(result), {
    NewExpression(p) {
      if (p.node.callee.name !== 'Worker') return;
      workers++;
      assert.equal(p.node.arguments[0].type, 'NewExpression');
      assert.equal(p.node.arguments[0].callee.name, 'URL');
    },
  });
  assert.equal(workers, 8);
  assert.equal(fs.readdirSync(workerDirectory).length, 6);
  for (const filename of fs.readdirSync(workerDirectory)) {
    traverse(parser.parse(readWorker(filename)), {
      NewExpression(p) {
        assert.notEqual(p.node.callee.name, 'Function', filename);
        if (p.node.callee.name === 'Worker') assert.equal(p.node.arguments[0].callee.name, 'URL');
      },
      CallExpression(p) { assert.notEqual(p.node.callee.name, 'eval', filename); },
    });
  }
});

test('timer worker supports timeout, interval, and cancellation without runtime code generation', async () => {
  const queue = new Map();
  let nextTimer = 0;
  const { context, messages } = sandbox({
    setTimeout(fn) { const id = ++nextTimer; queue.set(id, fn); return id; },
    setInterval(fn) { const id = ++nextTimer; queue.set(id, fn); return id; },
    clearTimeout(id) { queue.delete(id); },
    clearInterval(id) { queue.delete(id); },
  });
  vm.runInContext(readWorker('timers.js'), context);
  context.onmessage({ data: { type: 'set-timeout', timerId: 'timeout', delay: 5 } });
  queue.get(1)();
  assert.equal(messages[0][0].timerId, 'timeout');
  context.onmessage({ data: { type: 'set-timeout', timerId: 'cancel', delay: 5 } });
  context.onmessage({ data: { type: 'clear-timeout', timerId: 'cancel' } });
  assert.equal(queue.has(2), false);
  context.onmessage({ data: { type: 'set-interval', timerId: 'repeat', delay: 5 } });
  queue.get(3)();
  queue.get(3)();
  assert.equal(messages.length, 3);
  context.onmessage({ data: { type: 'clear-interval', timerId: 'repeat' } });
  assert.equal(queue.has(3), false);
});

test('static video workers preserve request errors and close transferred frames', async () => {
  for (const filename of ['frame-merger.js', 'alpha-splitter.js']) {
    let closed = 0;
    const frame = { format: null, close: () => { closed++; } };
    const { context, messages, listeners } = sandbox();
    vm.runInContext(readWorker(filename), context);
    const data = filename === 'frame-merger.js' ? { id: 7, color: frame, alpha: frame } : { id: 7, sourceFrame: frame };
    listeners.get('message')({ data });
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(messages[0][0].id, 7);
    assert.match(messages[0][0].error, /known VideoFrame format/);
    assert.equal(closed, filename === 'frame-merger.js' ? 2 : 1);
  }
});

test('packaged nested inflate worker preserves data handshake and transfers decompressed bytes', () => {
  const input = Buffer.from('packaged splat data '.repeat(300));
  const compressed = new Uint8Array(deflateRawSync(input));
  const { context, messages } = sandbox();
  vm.runInContext(readWorker('spark-inflate.js'), context);
  context.onmessage({ data: null });
  assert.equal(messages.length, 0);
  context.onmessage({ data: [compressed, {}] });
  assert.deepEqual(Buffer.from(messages[0][0]), input);
  assert.equal(messages[0][1][0], messages[0][0].buffer);
});

test('packaged PLY parser handles scalar and list properties in both byte orders without eval', () => {
  const worker = readWorker('spark-splats.js');
  const declarations = new Map();
  const wanted = new Set(['UNSAFE_EVAL_ALLOWED', 'F_REST_REGEX', 'FIELD_BYTES', 'PARSE_FIELD', 'createParseFn', 'safeToCompile', 'createCompiledParserFn', 'createDynamicParserFn']);
  traverse(parser.parse(worker), {
    VariableDeclarator(p) {
      if (wanted.has(p.node.id.name)) declarations.set(p.node.id.name, `const ${worker.slice(p.node.start, p.node.end)};`);
    },
    FunctionDeclaration(p) {
      if (wanted.has(p.node.id.name)) declarations.set(p.node.id.name, worker.slice(p.node.start, p.node.end));
    },
  });
  assert.equal(declarations.size, wanted.size);
  const { context } = sandbox();
  vm.runInContext([...declarations.values()].join('\n'), context);
  const properties = { x: { type: 'float' }, vertices: { isList: true, type: 'ushort', countType: 'uchar' } };
  for (const littleEndian of [true, false]) {
    const data = new DataView(new ArrayBuffer(9));
    data.setFloat32(0, 2.5, littleEndian);
    data.setUint8(4, 2);
    data.setUint16(5, 3, littleEndian);
    data.setUint16(7, 257, littleEndian);
    const item = { vertices: [] };
    const parse = context.createParseFn(properties, littleEndian);
    assert.equal(parse(data, 0, item), 9);
    assert.equal(item.x, 2.5);
    assert.deepEqual(item.vertices, [3, 257]);
  }
});

test('unexpected additional workers fail the build instead of silently producing a broken extension', () => {
  assert.throws(() => patchExtensionWorkers(`${source}\nnew Worker('blob:unpackaged');`, root), /Unpackaged dynamic Worker/);
});
