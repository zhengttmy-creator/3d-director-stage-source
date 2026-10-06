const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const MODULE_ID = '89752';
const EXPECTED_LENGTH = 163283;
const EXPECTED_SHA256 = '8b93f8c03d97c54d13a349eff33e2db9217ec9fd57d68657b8bb977ea95bbb83';
const RELATIVE_FILE = 'assets/spark_rs_bg.wasm';

module.exports = function localizeWasm(factories, out) {
  assert(factories && typeof factories === 'object', 'Expected module source map');
  const source = factories[MODULE_ID];
  assert.equal(typeof source, 'string', 'Missing Spark module 89752 source');
  assert.equal(typeof out, 'string', 'Expected output directory');

  const initialization = source.indexOf('async function gv(A){');
  assert(initialization >= 0, 'Spark WASM initializer changed');
  assert.equal(source.indexOf('async function gv(A){', initialization + 1), -1,
    'Spark WASM initializer is ambiguous');

  const pattern = /new URL\("data:application\/wasm;base64,([A-Za-z0-9+/=]+)"\)/g;
  const matches = [...source.matchAll(pattern)];
  assert.equal(matches.length, 1, 'Expected one Spark default WASM URL');
  const match = matches[0];
  assert(match.index > initialization && match.index - initialization < 500,
    'WASM URL does not belong to the expected initializer');
  assert(source.slice(0, match.index).endsWith('void 0===A&&(A='),
    'Unexpected Spark default argument expression');

  const bytes = Buffer.from(match[1], 'base64');
  assert.equal(bytes.toString('base64'), match[1], 'Noncanonical WASM base64');
  assert.equal(bytes.length, EXPECTED_LENGTH, 'Spark WASM length changed');
  assert.deepEqual(bytes.subarray(0, 8), Buffer.from([0, 97, 115, 109, 1, 0, 0, 0]),
    'Invalid WASM module header');
  const sha256 = crypto.createHash('sha256').update(bytes).digest('hex');
  assert.equal(sha256, EXPECTED_SHA256, 'Unexpected Spark WASM contents');

  const replacement = 'new URL("/assets/spark_rs_bg.wasm",window.location.href)';
  const localized = source.slice(0, match.index) + replacement +
    source.slice(match.index + match[0].length);
  assert.equal(localized.split(replacement).length - 1, 1,
    'Expected a single localized Spark WASM URL');

  const target = path.join(path.resolve(out), RELATIVE_FILE);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, bytes);
  factories[MODULE_ID] = localized;
  return { moduleId: MODULE_ID, file: RELATIVE_FILE, byteLength: bytes.length, sha256 };
};
