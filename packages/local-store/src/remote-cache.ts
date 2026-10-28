import type { IDBPDatabase } from 'idb';

import { openHostDatabase } from './database';

/** Host-owned remote bytes, separate from the editable replica and its ACKs. */
export class RemoteFileCache<Snapshot> {
  private prefix: string;
  constructor(
    namespace: readonly string[],
    private dbName = 'tio-workspaces',
  ) {
    this.prefix = `remote-cache/${JSON.stringify(namespace)}/`;
  }
  private async access<T>(work: (db: IDBPDatabase) => Promise<T>): Promise<T> {
    const db = await openHostDatabase(this.dbName);
    try {
      return await work(db);
    } finally {
      db.close();
    }
  }
  getSnapshot(): Promise<Snapshot | undefined> {
    return this.access((db) => db.get('settings', this.prefix + 'snapshot'));
  }
  async setSnapshot(snapshot: Snapshot): Promise<void> {
    await this.access((db) => db.put('settings', snapshot, this.prefix + 'snapshot'));
  }
  getBlob(sha: string): Promise<Uint8Array | undefined> {
    return this.access((db) => db.get('settings', this.prefix + 'blob/' + sha));
  }
  async putBlob(sha: string, bytes: Uint8Array): Promise<void> {
    await this.access((db) => db.put('settings', bytes, this.prefix + 'blob/' + sha));
  }
}
