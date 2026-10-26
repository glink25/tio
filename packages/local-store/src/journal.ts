import { openDB } from 'idb';
/** Reusable durable slot, independent of the IndexedDB object repository. */
export class RecoveryJournal<T> {
  private db = openDB('tio-provider-recovery', 1, {
    upgrade(db) {
      db.createObjectStore('journals');
    },
  });
  constructor(private key: string) {}
  async load(): Promise<T | undefined> {
    return (await this.db).get('journals', this.key);
  }
  async save(state: T): Promise<void> {
    await (await this.db).put('journals', state, this.key);
  }
  close() {
    void this.db.then((db) => db.close());
  }
}
