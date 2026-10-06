const fs = require('node:fs');
const path = require('node:path');
const parser = require('@babel/parser');
const traverse = require('@babel/traverse').default;

function edit(source, replacements) {
  let end = source.length;
  for (const replacement of replacements.sort((a, b) => b.start - a.start)) {
    if (replacement.end > end) throw new Error('Overlapping extension worker edits');
    source = source.slice(0, replacement.start) + replacement.text + source.slice(replacement.end);
    end = replacement.start;
  }
  return source;
}

function replaceNode(replacements, node, text) {
  replacements.push({ start: node.start, end: node.end, text });
}

function topBindings(body) {
  const bindings = new Map();
  for (const statement of body) {
    if (statement.type === 'VariableDeclaration') {
      for (const declaration of statement.declarations) {
        if (declaration.id.type === 'Identifier') bindings.set(declaration.id.name, declaration);
      }
    } else if (statement.type === 'FunctionDeclaration') {
      bindings.set(statement.id.name, statement);
    }
  }
  return bindings;
}

function required(bindings, name, type) {
  const node = bindings.get(name);
  if (!node || (type && node.type !== type)) throw new Error(`Missing extension worker binding ${name}`);
  return node;
}

function assertStaticWorkers(source, label) {
  traverse(parser.parse(source), {
    NewExpression(p) {
      const node = p.node;
      if (node.callee.name !== 'Worker') return;
      if (node.arguments[0]?.type !== 'NewExpression' || node.arguments[0].callee.name !== 'URL') {
        throw new Error(`Unpackaged dynamic Worker in ${label}`);
      }
    },
  });
}

function packageSplatWorker(source, writeWorker) {
  const ast = parser.parse(source);
  const body = ast.program.body[0]?.expression?.callee?.body?.body;
  if (!body) throw new Error('Unexpected splat worker wrapper');
  const bindings = topBindings(body);
  const replacements = [];
  const slice = node => source.slice(node.start, node.end);

  // This bundled fflate build uses one asynchronous inflate operation. Its
  // dependencies and initialization loops can be packaged without stringifying code.
  const inflate = required(bindings, 'inflate', 'FunctionDeclaration');
  let inflateInit;
  traverse(ast, {
    CallExpression(p) {
      if (p.node.callee.name !== 'cbify') return;
      if (p.node.start < inflate.start || p.node.end > inflate.end || p.node.arguments[4]?.value !== 1) {
        throw new Error('Unexpected asynchronous splat decompression operation');
      }
      if (inflateInit) throw new Error('Multiple splat inflate handlers');
      inflateInit = p.node.arguments[3];
    },
  });
  if (!inflateInit) throw new Error('Missing splat inflate handler');
  const inflateStart = body.findIndex(node => node.type === 'VariableDeclaration' && node.declarations.some(item => item.id.name === 'u8'));
  const inflateEnd = body.findIndex(node => node.type === 'VariableDeclaration' && node.declarations.some(item => item.id.name === 'Gunzip'));
  if (inflateStart < 0 || inflateEnd <= inflateStart) throw new Error('Unexpected splat inflate dependencies');
  const omit = new Set(['mrg', 'wcln', 'ch', 'cbfs', 'wrkr', 'cbify', 'bInflt']);
  const inflateStatements = body.slice(inflateStart, inflateEnd).filter(node => {
    if (node === inflate) return false;
    return node.type !== 'VariableDeclaration' || !node.declarations.some(item => omit.has(item.id.name));
  });
  writeWorker('spark-inflate.js', `${inflateStatements.map(slice).join('\n')}\nself.onmessage = function () { self.onmessage = ${slice(inflateInit)}; };\naddEventListener('error', function (event) { const error = event.error; postMessage({$e$: [error.message, error.code, error.stack]}); });\n`);

  const wk = required(bindings, 'wk').init;
  let nestedWorker;
  traverse(ast, {
    NewExpression(p) {
      if (p.node.callee.name !== 'Worker') return;
      if (nestedWorker || p.node.start < wk.start || p.node.end > wk.end) throw new Error('Unexpected nested splat worker');
      nestedWorker = p.node;
    },
  });
  if (!nestedWorker) throw new Error('Missing nested splat worker');
  replaceNode(replacements, nestedWorker.arguments[0], "new URL('spark-inflate.js', self.location.href)");
  replaceNode(replacements, required(bindings, 'wrkr').init.body,
    '{ if (id !== 1) throw new Error("Unsupported packaged inflate operation"); return wk(null, id, null, [], cb); }');
  // The library already provides an interpreted PLY parser; select it directly
  // so neither a CSP probe nor parser compilation runs in an extension worker.
  replaceNode(replacements, required(bindings, 'UNSAFE_EVAL_ALLOWED').init, 'false');
  replaceNode(replacements, required(bindings, 'createCompiledParserFn').body,
    '{ return createDynamicParserFn(properties, littleEndian); }');
  const patched = edit(source, replacements);
  assertStaticWorkers(patched, 'spark-splats.js');
  return patched;
}

function patchExtensionWorkers(source, extensionRoot) {
  const ast = parser.parse(source);
  const assignment = ast.program.body.find(node => node.type === 'ExpressionStatement' && node.expression.type === 'AssignmentExpression');
  const entries = assignment?.expression?.right?.properties;
  if (!entries) throw new Error('Unexpected director module bundle');
  const modules = new Map(entries.map(node => [String(node.key.value), node.value]));
  const replacements = [];
  const outputs = new Map();
  const writeWorker = (name, worker) => {
    parser.parse(worker);
    outputs.set(name, worker);
  };
  const pageURL = name => `new URL(${JSON.stringify(`vendor/extension-workers/${name}`)}, document.baseURI)`;

  for (const config of [
    { id: '67263', fn: 'v', cache: 'w', name: 'frame-merger.js' },
    { id: '70235', fn: 'eR', cache: 't', name: 'timers.js' },
    { id: '84497', fn: 'w', cache: 'b', name: 'alpha-splitter.js' },
  ]) {
    const module = modules.get(config.id);
    if (!module) throw new Error(`Missing worker module ${config.id}`);
    const binding = required(topBindings(module.body.body), config.fn);
    if (binding.init?.type !== 'ArrowFunctionExpression') throw new Error(`Unexpected ${config.fn} worker source`);
    writeWorker(config.name, `(${source.slice(binding.init.start, binding.init.end)})();\n`);
    let workers = 0;
    let blobFactories = 0;
    traverse(ast, {
      enter(p) {
        if (p.node.end < module.start || p.node.start > module.end) p.skip();
      },
      NewExpression(p) {
        if (p.node.callee.name !== 'Worker') return;
        if (p.node.arguments[0]?.name !== config.cache) throw new Error(`Unexpected worker URL in module ${config.id}`);
        workers++;
        replaceNode(replacements, p.node.arguments[0], pageURL(config.name));
      },
      IfStatement(p) {
        if (config.id === '70235' || p.node.test.type !== 'UnaryExpression' || p.node.test.argument.name !== config.cache) return;
        const statement = source.slice(p.node.start, p.node.end);
        if (!statement.includes(`${config.fn}.toString()`)) return;
        blobFactories++;
        replaceNode(replacements, p.node, '');
        p.skip();
      },
      VariableDeclaration(p) {
        if (config.id !== '70235' || !p.node.declarations.some(node => node.id.name === 't' && node.init?.type === 'CallExpression') || !source.slice(p.node.start, p.node.end).includes('eR.toString()')) return;
        blobFactories++;
        replaceNode(replacements, p.node, '');
        p.skip();
      },
      CallExpression(p) {
        if (config.id === '70235' && p.node.callee.type === 'MemberExpression' && p.node.callee.object.name === 'URL' && p.node.callee.property.name === 'revokeObjectURL' && p.node.arguments[0]?.name === 't') {
          replaceNode(replacements, p.node, 'void 0');
        }
      },
    });
    if (workers !== 1 || blobFactories !== 1) throw new Error(`Unexpected dynamic worker count in module ${config.id}`);
  }

  const splatModule = modules.get('89752');
  if (!splatModule) throw new Error('Missing splat worker module');
  const splatBindings = topBindings(splatModule.body.body);
  for (const config of [
    { source: 'G', blob: 'S', factory: 'R', name: 'spark-splats.js' },
    { source: 'Is', blob: 'It', factory: 'Ie', name: 'spark-decoder.js' },
  ]) {
    const literal = required(splatBindings, config.source).init;
    if (literal?.type !== 'StringLiteral') throw new Error(`Missing static ${config.source} worker payload`);
    const workerSource = config.source === 'G' ? packageSplatWorker(literal.value, writeWorker) : literal.value;
    writeWorker(config.name, workerSource);
    replaceNode(replacements, literal, 'null');
    replaceNode(replacements, required(splatBindings, config.blob).init, 'null');
    replaceNode(replacements, required(splatBindings, config.factory).body,
      `{ return new Worker(${pageURL(config.name)}, {name: A == null ? undefined : A.name}); }`);
  }

  const result = edit(source, replacements);
  assertStaticWorkers(result, 'modules.js');
  const directory = path.join(extensionRoot, 'vendor', 'extension-workers');
  fs.mkdirSync(directory, { recursive: true });
  for (const [name, worker] of outputs) fs.writeFileSync(path.join(directory, name), worker);
  return result;
}

module.exports = { patchExtensionWorkers };
