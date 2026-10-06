(() => {
  const cache = {};
  function require(id) {
    if (cache[id]) return cache[id].exports;
    const factory = window.directorFactories[id];
    if (!factory) throw new Error('Missing local module ' + id);
    const module = cache[id] = { exports: {} };
    try { factory.call(module.exports, module, module.exports, require); }
    catch (error) { delete cache[id]; throw error; }
    return module.exports;
  }
  require.o = (object, key) => Object.prototype.hasOwnProperty.call(object, key);
  require.d = (target, getters, values) => {
    for (const [key, get] of Object.entries(getters || {})) if (!require.o(target, key)) Object.defineProperty(target, key, { enumerable: true, get });
    for (const [key, value] of Object.entries(values || {})) if (!require.o(target, key)) Object.defineProperty(target, key, { enumerable: true, value });
  };
  require.r = target => {
    Object.defineProperty(target, '__esModule', { value: true });
    Object.defineProperty(target, Symbol.toStringTag, { value: 'Module' });
  };
  require.n = module => { const get = module?.__esModule ? () => module.default : () => module; require.d(get, { a: get }); return get; };
  require.t = function(value, mode) {
    if (mode & 1) value = require(value);
    if (mode & 8 || value && typeof value === 'object' && ((mode & 4 && value.__esModule) || (mode & 16 && typeof value.then === 'function'))) return value;
    const namespace = Object.create(null);
    require.r(namespace);
    const getters = { default: () => value };
    if (mode & 2) for (let current = value; current && ![Object.prototype, Array.prototype, Function.prototype].includes(current); current = Object.getPrototypeOf(current)) {
      for (const key of Object.getOwnPropertyNames(current)) if (key !== 'default') getters[key] = () => value[key];
    }
    require.d(namespace, getters);
    return namespace;
  };
  require.p = location.origin + '/';
  require.b = document.baseURI;
  require.nc = undefined;
  const workers = { 1656: 'director-stage-motion-library.6fc020542d.js', 9513: 'director-stage-fbx-import.873b633fba.js', 7278: 'director-stage-fbx-export.ca9b42ae2c.js' };
  require.u = id => workers[id] ? 'vendor/workers/static/js/async/' + workers[id] : 'vendor/chunks/' + id + '.js';
  const chunks = new Map();
  require.e = id => {
    if ([41, 1500, 8350, 7660].includes(Number(id))) return Promise.resolve();
    if (!chunks.has(id)) chunks.set(id, new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = require.p + require.u(id);
      script.onload = resolve;
      script.onerror = () => reject(new Error('Unavailable local chunk ' + id));
      document.head.append(script);
    }));
    return chunks.get(id);
  };
  globalThis.__LOADABLE_LOADED_CHUNKS__ = { push(chunk) { Object.assign(window.directorFactories, chunk[1]); } };
  const i18n = {
    language: 'zh-CN',
    t(key, params, fallback) {
      const value = window.directorLocale[key] ?? fallback ?? key;
      return typeof value === 'string' ? value.replace(/\{\{?(\w+)\}?\}/g, (match, name) => params?.[name] ?? match) : value;
    },
    dir: () => 'ltr',
  };
  window.directorFactories[78425] = (module, exports) => { exports.Ay = i18n; exports.F2 = i18n; };
  window.directorRequire = require;
})();
