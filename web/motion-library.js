(() => {
  const draftKey = 'director-stage:motion-library:v1';
  const operations = new Map();
  let queue = Promise.resolve();
  let pendingDraft;
  const failure = (code, message) => ({ ok: false, error: { code, message } });
  const cancelled = () => failure('cancelled', '\u64cd\u4f5c\u5df2\u53d6\u6d88');
  const clone = value => structuredClone(value);
  const validVersion = value => typeof value === 'string' && /^(0|[1-9]\d*)$/.test(value);
  const validPayload = value => value && typeof value === 'object' &&
    [1, 2].includes(value.version) && Array.isArray(value.motions);
  function enqueue(run) {
    const result = queue.then(run, run);
    queue = result.then(() => undefined, () => undefined);
    return result;
  }
  function current(token) {
    const record = token && operations.get(token.id);
    return record?.token === token && record.active ? record : undefined;
  }
  async function request(record, options, signal) {
    if (!record.active || signal?.aborted) throw new DOMException('Aborted', 'AbortError');
    const controller = new AbortController();
    const abort = () => controller.abort();
    // A started PUT may already be committed. Finish reading its version before the next write.
    const cancellable = options.method !== 'PUT';
    record.requests.set(controller, cancellable);
    if (cancellable) signal?.addEventListener('abort', abort, { once: true });
    try {
      const response = await fetch('/api/motion-library', { ...options, credentials: 'omit', cache: 'no-store', signal: controller.signal });
      if (cancellable && (!record.active || signal?.aborted)) throw new DOMException('Aborted', 'AbortError');
      if (!response.ok) {
        if (response.status === 409) return failure('conflict', '\u52a8\u4f5c\u5e93\u5df2\u5728\u5176\u4ed6\u7a97\u53e3\u66f4\u65b0\uff0c\u672a\u8986\u76d6\u5df2\u4fdd\u5b58\u6570\u636e');
        return failure('request-failed', '\u672c\u5730\u52a8\u4f5c\u5e93\u8bfb\u5199\u5931\u8d25');
      }
      const data = await response.json();
      if (cancellable && (!record.active || signal?.aborted)) throw new DOMException('Aborted', 'AbortError');
      return { ok: true, data };
    } finally {
      if (cancellable) signal?.removeEventListener('abort', abort);
      record.requests.delete(controller);
    }
  }
  function exception(error) {
    return error?.name === 'AbortError' ? cancelled() : failure('request-failed', error instanceof Error ? error.message : '\u52a8\u4f5c\u5e93\u4fdd\u5b58\u5931\u8d25');
  }
  const port = {
    async beginAccountOperation(scope) {
      const token = Object.freeze({ id: crypto.randomUUID() });
      operations.set(token.id, { token, scope, active: true, version: undefined, requests: new Map() });
      return { ok: true, data: token };
    },
    getDraft(key, token) {
      return enqueue(async () => {
        const record = current(token);
        if (!record) return cancelled();
        if (key !== draftKey) return failure('unsupported', '\u4e0d\u652f\u6301\u6b64\u8349\u7a3f\u7c7b\u578b');
        try {
          const result = await request(record, { method: 'GET' });
          if (!result.ok) return result;
          if (!validVersion(result.data.versionId) || !validPayload(result.data.payload)) {
            return failure('invalid-data', '\u672c\u5730\u52a8\u4f5c\u5e93\u683c\u5f0f\u65e0\u6548');
          }
          record.version = result.data.versionId;
          record.serialized = JSON.stringify(result.data.payload);
          return { ok: true, data: { payload: result.data.payload, versionId: record.version } };
        } catch (error) {
          return exception(error);
        }
      });
    },
    saveDraft(key, kind, payload, projectId, token, options = {}) {
      const record = current(token);
      if (!record) return Promise.resolve(cancelled());
      if (key !== draftKey || kind !== 'generation' || !validPayload(payload)) {
        return Promise.resolve(failure('invalid-data', '\u52a8\u4f5c\u8349\u7a3f\u683c\u5f0f\u65e0\u6548'));
      }
      let draft;
      let body;
      try {
        draft = clone(payload);
        body = JSON.stringify(draft);
      } catch (error) {
        return Promise.resolve(exception(error));
      }
      const entry = { payload: draft, savedAt: new Date().toISOString(), operationId: token.id };
      pendingDraft = entry;
      return enqueue(async () => {
        if (!current(token) || options.signal?.aborted) return cancelled();
        if (!validVersion(record.version)) return failure('not-loaded', '\u8bf7\u5148\u8bfb\u53d6\u672c\u5730\u52a8\u4f5c\u5e93');
        if (body === record.serialized) {
          if (pendingDraft === entry) pendingDraft = undefined;
          return !record.active || options.signal?.aborted ? cancelled() : { ok: true, data: { versionId: record.version } };
        }
        try {
          const result = await request(record, {
            method: 'PUT', headers: { 'Content-Type': 'application/json', 'If-Match': record.version }, body,
          }, options.signal);
          if (!result.ok) return result;
          if (!validVersion(result.data.versionId)) return failure('invalid-data', '\u52a8\u4f5c\u5e93\u4fdd\u5b58\u54cd\u5e94\u65e0\u6548');
          record.version = result.data.versionId;
          record.serialized = body;
          if (pendingDraft === entry) pendingDraft = undefined;
          return !record.active || options.signal?.aborted ? cancelled() : { ok: true, data: { versionId: record.version } };
        } catch (error) {
          return exception(error);
        }
      });
    },
    async endAccountOperation(token) {
      const record = current(token);
      if (!record) return;
      record.active = false;
      for (const [controller, cancellable] of record.requests) if (cancellable) controller.abort();
      operations.delete(token.id);
    },
    getPendingDraft() {
      return pendingDraft ? clone(pendingDraft) : undefined;
    },
    fbx: {
      async save({ fileName, bytes, operation }) {
        if (!current(operation)) return cancelled();
        if (typeof fileName !== 'string' || !fileName.toLowerCase().endsWith('.fbx') ||
            !(bytes instanceof Uint8Array) || bytes.byteLength === 0) {
          return failure('invalid-data', '\u5bfc\u51fa\u52a8\u4f5c\u6587\u4ef6\u65e0\u6548');
        }
        try {
          const url = URL.createObjectURL(new Blob([bytes], { type: 'application/octet-stream' }));
          const link = document.createElement('a');
          link.href = url;
          link.download = fileName.replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_');
          link.click();
          setTimeout(() => URL.revokeObjectURL(url), 60000);
          return { ok: true, data: { fileName: link.download } };
        } catch (error) {
          return exception(error);
        }
      },
    },
  };
  window.localDirectorMotionLibrary = port;
})();
