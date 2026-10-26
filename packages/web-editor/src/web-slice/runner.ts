/** Stringified into the sandbox. Keep all dependencies inside this function. */
function bootstrap(token: string) {
  token = token || new URLSearchParams(location.hash.slice(1)).get('token') || '';
  let port: MessagePort;
  let sequence = 0;
  const pending = new Map<
    string,
    {
      resolve: (value: any) => void;
      reject: (error: Error) => void;
      timer: ReturnType<typeof setTimeout>;
    }
  >();
  const listeners = new Set<(event: unknown) => void>();
  const call = (method: string, payload: unknown = {}, options?: { requestId?: string }) =>
    new Promise<any>((resolve, reject) => {
      const id = options?.requestId ?? `${++sequence}`;
      if (pending.has(id)) {
        reject(new Error('Request already pending'));
        return;
      }
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(
          Object.assign(new Error('Request timed out; retry with the same requestId'), {
            code: 'TIMEOUT',
            requestId: id,
          }),
        );
      }, 15000);
      pending.set(id, { resolve, reject, timer });
      port.postMessage({ protocol: 1, kind: 'request', id, method, payload });
    });
  const table = (databaseId: string) => ({
    get: () => call('databases.get', { databaseId }),
    records: {
      query: (options = {}) => call('records.query', { ...options, databaseId }),
      get: (id: string) => call('records.get', { databaseId, id }),
      create: (properties: unknown, options?: { requestId?: string }) =>
        call('records.create', { databaseId, properties }, options),
      update: (
        id: string,
        properties: unknown,
        version: string,
        options?: { requestId?: string },
      ) => call('records.update', { databaseId, id, properties, version }, options),
      delete: (id: string, version: string, options?: { requestId?: string }) =>
        call('records.delete', { databaseId, id, version }, options),
    },
    fields: {
      list: () => call('fields.list', { databaseId }),
      create: (field: unknown, version: string) =>
        call('fields.create', { databaseId, field, version }),
      update: (id: string, changes: unknown, version: string) =>
        call('fields.update', { databaseId, id, changes, version }),
      delete: (id: string, version: string) => call('fields.delete', { databaseId, id, version }),
      find: async (name: string) => {
        const result = await call('fields.list', { databaseId });
        const matches = result.fields.filter((f: any) => f.name === name);
        if (matches.length !== 1) throw new Error('Field missing or ambiguous');
        return matches[0];
      },
    },
    views: {
      list: () => call('views.list', { databaseId }),
      create: (changes: unknown) => call('views.create', { databaseId, changes }),
      update: (id: string, changes: unknown, version: string) =>
        call('views.update', { databaseId, id, changes, version }),
      delete: (id: string, version: string) => call('views.delete', { databaseId, id, version }),
    },
  });
  const tio = {
    apiVersion: 1,
    request: call,
    context: { get: () => call('context.get') },
    page: {
      get: () => call('page.get'),
      getBlocks: () => call('page.getBlocks'),
      update: (changes: unknown, version: string) => call('page.update', { changes, version }),
      insertBlocks: (blocks: unknown[], version: string) =>
        call('page.insertBlocks', { blocks, version }),
      updateBlock: (id: string, changes: unknown, version: string) =>
        call('page.updateBlock', { id, changes, version }),
      removeBlock: (id: string, version: string) => call('page.removeBlock', { id, version }),
    },
    pages: {
      get: (pageId: string) => ({
        get: () => call('pages.get', { pageId }),
        getBlocks: () => call('pages.getBlocks', { pageId }),
        update: (changes: unknown, version: string) =>
          call('pages.update', { pageId, changes, version }),
        insertBlocks: (blocks: unknown[], version: string) =>
          call('pages.insertBlocks', { pageId, blocks, version }),
        updateBlock: (id: string, changes: unknown, version: string) =>
          call('pages.updateBlock', { pageId, id, changes, version }),
        removeBlock: (id: string, version: string) =>
          call('pages.removeBlock', { pageId, id, version }),
      }),
    },
    databases: {
      list: () => call('databases.list'),
      get: table,
      create: (options: unknown, retry?: { requestId?: string }) =>
        call('databases.create', options, retry),
      find: async (name: string) => {
        const matches = (await call('databases.list')).filter((d: any) => d.name === name);
        if (matches.length !== 1) throw new Error('Database missing or ambiguous');
        return table(matches[0].id);
      },
    },
    subscribe: (listener: (event: unknown) => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    ui: { resize: (height: number) => call('ui.resize', { height }) },
  };
  window.addEventListener('message', function receive(event) {
    if (
      event.source !== parent ||
      event.data?.kind !== 'tio-connect' ||
      event.data?.token !== token ||
      !event.ports[0]
    )
      return;
    window.removeEventListener('message', receive);
    port = event.ports[0];
    port.onmessage = (event) => {
      const message = event.data;
      if (message.kind === 'changed') {
        for (const listener of listeners) listener(message.payload);
        return;
      }
      const request = pending.get(message.id);
      if (!request) return;
      clearTimeout(request.timer);
      pending.delete(message.id);
      if (message.error)
        request.reject(
          Object.assign(new Error(message.error.message), { code: message.error.code }),
        );
      else request.resolve(message.result);
    };
    Object.defineProperty(window, 'tio', { value: tio, writable: false });
    const log = (message: unknown) =>
      port.postMessage({ kind: 'log', message: String(message).slice(0, 4000) });
    window.addEventListener('error', (e) => log(e.message));
    window.addEventListener('unhandledrejection', (e) => log(e.reason));
    for (const key of ['log', 'warn', 'error'] as const) {
      const original = console[key].bind(console);
      console[key] = (...args: unknown[]) => {
        original(...args);
        log(
          args
            .map((a) => (typeof a === 'object' ? JSON.stringify(a) : (JSON.stringify(a) ?? '')))
            .join(' '),
        );
      };
    }
    // Parse inertly; install content only after the SDK and dedicated channel exist.
    const source = new DOMParser().parseFromString(event.data.html, 'text/html');
    source.querySelectorAll('meta[http-equiv],base').forEach((node) => node.remove());
    const scripts = [...source.querySelectorAll('script')];
    const jobs = scripts.map((node) => {
      const placeholder = source.createElement('span');
      node.replaceWith(placeholder);
      return { node, placeholder };
    });
    for (const node of [...source.head.childNodes]) document.head.appendChild(node);
    for (const node of [...source.body.childNodes]) document.body.appendChild(node);
    for (const attr of [...source.body.attributes])
      document.body.setAttribute(attr.name, attr.value);
    void (async () => {
      for (const { node, placeholder } of jobs) {
        const script = document.createElement('script');
        for (const attr of [...node.attributes]) script.setAttribute(attr.name, attr.value);
        script.async = node.hasAttribute('async');
        script.textContent = node.textContent;
        const external = !!script.src || script.type === 'module';
        const done = external
          ? new Promise<void>((resolve) => {
              script.onload = () => resolve();
              script.onerror = () => {
                log('Script failed: ' + script.src);
                resolve();
              };
            })
          : Promise.resolve();
        placeholder.replaceWith(script);
        if (!script.async) await done;
      }
      document.dispatchEvent(new Event('DOMContentLoaded'));
      window.dispatchEvent(new Event('load'));
    })();
    let previousHeight = 0;
    new ResizeObserver(() => {
      const height = Math.ceil(document.body.getBoundingClientRect().height + 24);
      if (Math.abs(height - previousHeight) > 2) {
        previousHeight = height;
        void tio.ui.resize(height).catch(() => {});
      }
    }).observe(document.body);
    window.addEventListener('pagehide', () => {
      port.postMessage({ kind: 'closed' });
      port.close();
    });
  });
  parent.postMessage({ kind: 'tio-ready', token }, '*');
}
export function runnerDocument(token: string, external: boolean) {
  const network = external ? 'https:' : '';
  const csp = `default-src 'none'; script-src 'unsafe-inline' ${network}; style-src 'unsafe-inline' ${network}; img-src data: blob: ${network}; font-src data: ${network}; media-src data: blob: ${network}; connect-src ${external ? 'https: wss:' : "'none'"}; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'; worker-src 'none'`;
  return `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${csp}"><style>body{margin:12px;font-family:system-ui}*{box-sizing:border-box}</style></head><body><script>(${bootstrap.toString()})(${JSON.stringify(token)})</script></body></html>`;
}
