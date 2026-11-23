import { createHostCatalog } from './catalog';

/** Remote transport cache shares the native catalog's durability. */
export class NativeRemoteCache<Snapshot> {
  private catalog = createHostCatalog();
  private prefix: string;
  constructor(namespace: readonly string[]) {
    this.prefix = 'remote-cache/' + JSON.stringify(namespace) + '/';
  }
  async getSnapshot(): Promise<Snapshot | undefined> {
    return (await this.catalog.read(this.prefix + 'snapshot')) ?? undefined;
  }
  async setSnapshot(snapshot: Snapshot) {
    await this.catalog.write(this.prefix + 'snapshot', snapshot);
  }
  async getBlob(sha: string): Promise<Uint8Array | undefined> {
    const bytes: number[] | null = await this.catalog.read(this.prefix + 'blob/' + sha);
    return bytes ? Uint8Array.from(bytes) : undefined;
  }
  async putBlob(sha: string, bytes: Uint8Array) {
    await this.catalog.write(this.prefix + 'blob/' + sha, Array.from(bytes));
  }
}
