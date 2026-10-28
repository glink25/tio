import { HostError } from '@tio/core';
import { LocalCatalog } from '@tio/local-store';

/** Shared with other windows; deleted instances can never be written by an old session. */
export class WorkspaceLifecycle {
  private channel =
    typeof BroadcastChannel === 'undefined'
      ? undefined
      : new BroadcastChannel('tio-workspace-lifecycle');
  private queues = new Map<string, Promise<unknown>>();
  constructor(
    private catalog: LocalCatalog,
    onStop: (id: string) => Promise<void>,
  ) {
    if (this.channel)
      this.channel.onmessage = (event) => {
        if (typeof event.data?.id === 'string') void onStop(event.data.id);
      };
  }
  lock<T>(
    id: string,
    work: () => Promise<T>,
    mode: 'shared' | 'exclusive' = 'exclusive',
  ): Promise<T> {
    if (globalThis.navigator?.locks)
      return navigator.locks.request('tio-lifecycle-' + id, { mode }, work);
    const next = (this.queues.get(id) ?? Promise.resolve()).then(work);
    this.queues.set(
      id,
      next.catch(() => {}),
    );
    return next;
  }
  async assertOpen(id: string) {
    if (await this.catalog.read('workspace-lifecycle/' + id)) throw new HostError('closed');
  }
  async mark(id: string, state: 'deleting' | 'deleted') {
    await this.catalog.write('workspace-lifecycle/' + id, state);
    this.channel?.postMessage({ id });
  }
  guard<T extends object>(id: string, repository: T): T {
    // Keep the provider as the receiver of its own methods. A separate facade also lets
    // callers decorate a method without recursively entering the same lifecycle lock.
    const facade = Object.create(Object.getPrototypeOf(repository)) as T;
    const seen = new Set<PropertyKey>();
    for (
      let source: object | null = repository;
      source && source !== Object.prototype;
      source = Object.getPrototypeOf(source)
    ) {
      for (const key of Reflect.ownKeys(source)) {
        if (key === 'constructor' || seen.has(key)) continue;
        seen.add(key);
        const value = Reflect.get(repository, key);
        if (typeof value === 'function') {
          const invoke = (...args: unknown[]) => {
            const method = Reflect.get(repository, key);
            if (typeof method !== 'function') throw new HostError('unsupported');
            return Reflect.apply(method, repository, args);
          };
          const guarded = (...args: unknown[]) =>
            this.lock(
              id,
              async () => {
                await this.assertOpen(id);
                return invoke(...args);
              },
              'shared',
            );
          Object.defineProperty(facade, key, {
            configurable: true,
            writable: true,
            value:
              key === 'close' || key === 'subscribe' || key === 'subscribeChanges'
                ? invoke
                : guarded,
          });
        } else {
          Object.defineProperty(facade, key, {
            configurable: true,
            get: () => Reflect.get(repository, key),
            set: (next: unknown) => {
              Reflect.set(repository, key, next);
            },
          });
        }
      }
    }
    return facade;
  }
  close() {
    this.channel?.close();
  }
}
