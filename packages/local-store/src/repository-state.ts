import { HostError, type RepositoryStateStore } from '@tio/core';
import { openDB } from 'idb';

/** Small independent keys: ordinary operations never clone the entire recovery journal. */
export class IndexedRepositoryState implements RepositoryStateStore {
  private db = openDB('tio-file-state', 1, {
    upgrade(db) {
      db.createObjectStore('state');
    },
  });
  private closed = false;
  private async database() {
    if (this.closed) throw new HostError('closed');
    const db = await this.db;
    if (this.closed) throw new HostError('closed');
    return db;
  }
  private channel?: BroadcastChannel;
  private listeners = new Set<() => void>();
  constructor(private namespace: string) {
    if (typeof BroadcastChannel !== 'undefined') {
      this.channel = new BroadcastChannel('tio-file-state/' + namespace);
      this.channel.onmessage = () => this.listeners.forEach((fn) => fn());
    }
  }
  private key(key: string) {
    return this.namespace + '/' + key;
  }
  async read<T>(key: string): Promise<T | undefined> {
    return (await this.database()).get('state', this.key(key));
  }
  async readMany<T>(keys: string[]): Promise<(T | undefined)[]> {
    const tx = (await this.database()).transaction('state');
    const values = await Promise.all(keys.map((key) => tx.store.get(this.key(key))));
    await tx.done;
    return values;
  }
  async entries<T>(prefix: string, after?: string, limit?: number) {
    const tx = (await this.database()).transaction('state');
    const range = IDBKeyRange.bound(
      this.key(after ?? prefix),
      this.key(prefix + '\uffff'),
      !!after,
    );
    const [keys, values] = await Promise.all([
      tx.store.getAllKeys(range, limit),
      tx.store.getAll(range, limit),
    ]);
    await tx.done;
    return keys.map((key, index) => ({
      key: (key as string).slice(this.namespace.length + 1),
      value: values[index] as T,
    }));
  }
  async write(puts: { key: string; value: unknown }[], deletes: string[] = []) {
    const tx = (await this.database()).transaction('state', 'readwrite');
    try {
      // Keep one atomic transaction, but bound outstanding structured clones and IDB requests.
      for (let offset = 0; offset < deletes.length; offset += 512)
        await Promise.all(
          deletes.slice(offset, offset + 512).map((key) => tx.store.delete(this.key(key))),
        );
      for (let offset = 0; offset < puts.length; offset += 512)
        await Promise.all(
          puts
            .slice(offset, offset + 512)
            .map(({ key, value }) => tx.store.put(value, this.key(key))),
        );
      await tx.done;
    } catch (error) {
      try {
        tx.abort();
      } catch {
        /* transaction may already have aborted */
      }
      await tx.done.catch(() => {});
      throw error;
    }
    if (puts.some((entry) => entry.key === 'version')) this.channel?.postMessage(null);
  }
  subscribe(listener: () => void) {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }
  async delete() {
    const db = await this.database();
    await db.delete('state', IDBKeyRange.bound(this.key(''), this.key('\uffff')));
  }
  close() {
    this.closed = true;
    this.channel?.close();
    this.listeners.clear();
    void this.db.then((db) => db.close());
  }
}
