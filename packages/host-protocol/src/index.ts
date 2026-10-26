import {
  HostError,
  type WorkspaceEvent,
  type AssetData,
  type CommitRequest,
  type CommitResult,
  type WorkspaceRepository,
  type WorkspaceSnapshot,
  type ObjectQuery,
  type ObjectPage,
  type PageQuery,
  type NavigationPage,
  type RecordQuery,
  type SearchQuery,
  type SearchPage,
  type RepositoryCapabilities,
} from '@tio/core';

import {
  envelope,
  snapshot as parseSnapshot,
  result as parseResult,
  event as parseEvent,
  requestPayload,
} from './validation';
export const PROTOCOL_VERSION = 1;
export interface HostContext {
  sessionId: string;
  workspaceId: string;
}
export interface Capability {
  name: string;
  version: number;
}
export interface Extension {
  capability: Capability;
  invoke(input: unknown): Promise<unknown>;
}
/** Implement with a trusted WebView channel; binary transfer references never contain filesystem paths. */
export interface Transport {
  send(message: Message): void;
  subscribe(listener: (message: Message) => void): () => void;
  upload(bytes: Uint8Array): Promise<string>;
  download(reference: string): Promise<Uint8Array>;
  release(reference: string): Promise<void>;
}
export interface Message extends HostContext {
  protocol: number;
  id: string;
  kind: 'request' | 'response' | 'changed';
  method?: string;
  payload?: any;
  error?: { code: string; message: string };
}
export class BridgeRepository implements WorkspaceRepository {
  private pending = new Map<
    string,
    {
      resolve: (value: any) => void;
      reject: (error: Error) => void;
      timer: ReturnType<typeof setTimeout>;
    }
  >();
  private listeners = new Set<(event: WorkspaceEvent) => void>();
  private unsubscribe: () => void;
  private closed = false;
  private ready = false;
  capabilities: Capability[] = [];
  storageCapabilities?: RepositoryCapabilities;
  constructor(
    private transport: Transport,
    readonly context: HostContext,
    private timeout = 10000,
  ) {
    this.unsubscribe = transport.subscribe((message) => {
      if (!envelope(message)) return;
      if (
        message.sessionId !== context.sessionId ||
        message.workspaceId !== context.workspaceId ||
        message.protocol !== PROTOCOL_VERSION
      )
        return;
      if (message.kind === 'changed') {
        try {
          const event = parseEvent(message.payload);
          this.listeners.forEach((listener) => listener(event));
        } catch {
          /* invalid notification cannot alter state */
        }
        return;
      }
      if (message.kind !== 'response') return;
      const request = this.pending.get(message.id);
      if (!request) return;
      this.pending.delete(message.id);
      clearTimeout(request.timer);
      if (message.error)
        request.reject(
          new HostError(message.error.code as HostError['code'], message.error.message),
        );
      else request.resolve(message.payload);
    });
  }
  async connect() {
    const response = await this.request('hello', { version: PROTOCOL_VERSION });
    if (
      !Array.isArray(response?.capabilities) ||
      !response.capabilities.every(
        (c: any) => typeof c.name === 'string' && Number.isSafeInteger(c.version),
      )
    )
      throw new HostError('invalid');
    this.capabilities = response.capabilities;
    this.storageCapabilities = response.storageCapabilities;
    this.ready = true;
  }
  private request(method: string, payload?: unknown): Promise<any> {
    if (this.closed) return Promise.reject(new HostError('closed'));
    if (!this.ready && method !== 'hello')
      return Promise.reject(new HostError('unsupported', 'Handshake required'));
    const id = crypto.randomUUID();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new HostError('timeout'));
      }, this.timeout);
      this.pending.set(id, { resolve, reject, timer });
      try {
        this.transport.send({
          ...this.context,
          protocol: PROTOCOL_VERSION,
          id,
          kind: 'request',
          method,
          payload,
        });
      } catch (error) {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(error);
      }
    });
  }
  async readObjects(ids: string[]): Promise<WorkspaceSnapshot> {
    return parseSnapshot(await this.request('readObjects', { ids }));
  }
  async queryNavigation(query: PageQuery): Promise<NavigationPage> {
    return this.page(await this.request('queryNavigation', query));
  }
  async search(query: SearchQuery): Promise<SearchPage> {
    const page = this.page(await this.request('search', query));
    if (!Number.isSafeInteger(page.scanned) || page.scanned < 0) throw new HostError('invalid');
    return page;
  }
  private page(value: any) {
    if (
      !value ||
      !Number.isSafeInteger(value.version) ||
      value.version < 0 ||
      !Array.isArray(value.items) ||
      typeof value.complete !== 'boolean' ||
      (value.next !== undefined && typeof value.next !== 'string') ||
      value.complete !== !value.next ||
      value.items.some(
        (o: any) =>
          !o ||
          typeof o.id !== 'string' ||
          o.workspaceId !== this.context.workspaceId ||
          typeof o.type !== 'string',
      )
    )
      throw new HostError('invalid');
    return value;
  }
  async queryRecords(query: RecordQuery): Promise<ObjectPage> {
    const page = await this.request('queryRecords', query);
    const snapshot = parseSnapshot(page);
    if (page.next !== undefined && typeof page.next !== 'string') throw new HostError('invalid');
    return { ...snapshot, next: page.next };
  }
  async scan(query: PageQuery): Promise<ObjectPage> {
    const page = await this.request('scan', query);
    const snapshot = parseSnapshot(page);
    if (page.next !== undefined && typeof page.next !== 'string') throw new HostError('invalid');
    return { ...snapshot, next: page.next };
  }
  async queryObjects(query: ObjectQuery): Promise<ObjectPage> {
    const page = await this.request('queryObjects', query);
    const snapshot = parseSnapshot(page);
    if (page.next !== undefined && typeof page.next !== 'string') throw new HostError('invalid');
    return { ...snapshot, next: page.next };
  }
  async readSnapshot(): Promise<WorkspaceSnapshot> {
    return parseSnapshot(await this.request('readSnapshot'));
  }
  acknowledgeCommits(clientId: string, sequence: number): Promise<void> {
    return this.request('acknowledgeCommits', { clientId, sequence });
  }
  async readChanges(since: number): Promise<WorkspaceSnapshot> {
    return parseSnapshot(await this.request('readChanges', { since }));
  }
  async commit(request: CommitRequest): Promise<CommitResult> {
    return parseResult(await this.request('commit', request));
  }
  async getCommitResult(id: string): Promise<CommitResult | undefined> {
    const receipt = await this.request('getCommitResult', { id });
    return receipt == null ? undefined : parseResult(receipt);
  }
  subscribeChanges = (listener: (event: WorkspaceEvent) => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  async stageAsset(id: string, asset: AssetData) {
    const reference = await this.transport.upload(asset.bytes);
    // Timeout is not cancellation: the host releases after consuming, or the lease expires.
    await this.request('stageAsset', { id, name: asset.name, mime: asset.mime, reference });
    await this.transport.release(reference);
  }
  async readAsset(id: string): Promise<AssetData | undefined> {
    const asset = await this.request('readAsset', { id });
    if (!asset) return undefined;
    if (
      typeof asset.name !== 'string' ||
      typeof asset.mime !== 'string' ||
      typeof asset.reference !== 'string'
    )
      throw new HostError('invalid');
    try {
      return {
        name: asset.name,
        mime: asset.mime,
        bytes: await this.transport.download(asset.reference),
      };
    } finally {
      await this.transport.release(asset.reference);
    }
  }
  async releaseAsset(id: string) {
    await this.request('releaseAsset', { id });
  }
  async invoke(name: string, version: number, input: unknown) {
    if (!this.capabilities.some((c) => c.name === name && c.version === version))
      throw new HostError('unsupported');
    return this.request('extension', { name, version, input });
  }
  dispose() {
    this.closed = true;
    this.unsubscribe();
    this.listeners.clear();
    for (const request of this.pending.values()) {
      clearTimeout(request.timer);
      request.reject(new HostError('closed'));
    }
    this.pending.clear();
  }
}
export function serveHost(
  transport: Transport,
  context: HostContext,
  repository: WorkspaceRepository,
  extensions: Extension[] = [],
) {
  let ready = false;
  let disposed = false;
  const reply = (request: Message, payload?: unknown, error?: Message['error']) => {
    if (!disposed)
      transport.send({
        ...context,
        protocol: PROTOCOL_VERSION,
        kind: 'response',
        id: request.id,
        payload,
        error,
      });
  };
  const unsubscribe = transport.subscribe((request) => {
    if (!envelope(request)) return;
    if (
      request.kind !== 'request' ||
      request.sessionId !== context.sessionId ||
      request.workspaceId !== context.workspaceId
    )
      return;
    void (async () => {
      try {
        if (request.protocol !== PROTOCOL_VERSION)
          throw new HostError('unsupported', 'Protocol version mismatch');
        const p = request.payload;
        requestPayload(request.method, p);
        let result: unknown;
        if (request.method === 'hello') {
          if (p?.version !== PROTOCOL_VERSION) throw new HostError('unsupported');
          ready = true;
          result = {
            capabilities: extensions.map((e) => e.capability),
            storageCapabilities: repository.storageCapabilities,
          };
        } else {
          if (!ready) throw new HostError('unsupported', 'Handshake required');
          switch (request.method) {
            case 'readObjects':
              if (!repository.readObjects) throw new HostError('unsupported');
              result = await repository.readObjects(p.ids);
              break;
            case 'queryNavigation':
            case 'queryRecords':
            case 'search':
            case 'scan': {
              const method: ((query: any) => Promise<unknown>) | undefined =
                repository[request.method];
              if (!method) throw new HostError('unsupported');
              result = await method.call(repository, p);
              break;
            }
            case 'queryObjects':
              if (!repository.queryObjects)
                throw new HostError('unsupported', 'Paged queries unavailable');
              result = await repository.queryObjects(p);
              break;
            case 'readSnapshot':
              result = await repository.readSnapshot();
              break;
            case 'commit':
              if (p.changes.some((object: any) => object.workspaceId !== context.workspaceId))
                throw new HostError('permission', 'Workspace mismatch');
              result = await repository.commit({ ...p, origin: 'editor:' + context.sessionId });
              break;
            case 'acknowledgeCommits':
              if (typeof p?.clientId !== 'string' || !Number.isSafeInteger(p.sequence))
                throw new HostError('invalid');
              await repository.acknowledgeCommits?.(p.clientId, p.sequence);
              break;
            case 'readChanges':
              result = repository.readChanges
                ? await repository.readChanges(p.since)
                : await repository.readSnapshot();
              break;
            case 'getCommitResult':
              result = await repository.getCommitResult(p.id);
              break;
            case 'stageAsset':
              if (
                typeof p?.id !== 'string' ||
                typeof p.reference !== 'string' ||
                typeof p.mime !== 'string'
              )
                throw new HostError('invalid');
              await repository.stageAsset(p.id, {
                name: p.name,
                mime: p.mime,
                bytes: await transport.download(p.reference),
              });
              await transport.release(p.reference);
              break;
            case 'readAsset': {
              const asset = await repository.readAsset(p.id);
              result = asset
                ? {
                    name: asset.name,
                    mime: asset.mime,
                    reference: await transport.upload(asset.bytes),
                  }
                : undefined;
              break;
            }
            case 'releaseAsset':
              await repository.releaseAsset(p.id);
              break;
            case 'extension': {
              const extension = extensions.find(
                (e) => e.capability.name === p.name && e.capability.version === p.version,
              );
              if (!extension) throw new HostError('unsupported');
              result = await extension.invoke(p.input);
              break;
            }
            default:
              throw new HostError('unsupported');
          }
        }
        reply(request, result);
      } catch (error) {
        reply(request, undefined, {
          code: error instanceof HostError ? error.code : 'unavailable',
          message: error instanceof Error ? error.message : String(error),
        });
      }
    })();
  });
  const stopChanges = repository.subscribeChanges((event) => {
    if (ready && !disposed)
      transport.send({
        ...context,
        protocol: PROTOCOL_VERSION,
        kind: 'changed',
        payload: event,
        id: crypto.randomUUID(),
      });
  });
  return () => {
    disposed = true;
    unsubscribe();
    stopChanges();
  };
}
/** Async structured-clone transport for tests and integration examples; no persistence in the editor. */
export function createLoopback() {
  const a = new Set<(message: Message) => void>(),
    b = new Set<(message: Message) => void>();
  const transfers = new Map<string, { bytes: Uint8Array; expires: number }>();
  const endpoint = (own: typeof a, other: typeof a): Transport => ({
    send(message) {
      const data = JSON.parse(JSON.stringify(message));
      queueMicrotask(() => other.forEach((listener) => listener(data)));
    },
    subscribe(listener) {
      own.add(listener);
      return () => {
        own.delete(listener);
      };
    },
    async upload(bytes) {
      const id = crypto.randomUUID();
      for (const [key, value] of transfers) if (value.expires < Date.now()) transfers.delete(key);
      transfers.set(id, { bytes: bytes.slice(), expires: Date.now() + 60000 });
      return id;
    },
    async download(id) {
      const bytes = transfers.get(id);
      if (!bytes || bytes.expires < Date.now())
        throw new HostError('invalid', 'Transfer unavailable');
      return bytes.bytes.slice();
    },
    async release(id) {
      transfers.delete(id);
    },
  });
  return { client: endpoint(a, b), host: endpoint(b, a) };
}
