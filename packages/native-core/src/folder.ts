import { HostError, type AssetData, type RepositoryStateStore } from '@tio/core';
import type { FileStorageProvider } from '@tio/storage';
export type FolderCall = <T>(request: Record<string, unknown>) => Promise<T>;
export interface FolderGrant {
  kind: 'native-folder';
  id: string;
  name: string;
}
export class NativeFolderProvider implements FileStorageProvider {
  readonly attachmentPolicy = { maxFileBytes: 20 * 1024 * 1024, maxImageBytes: 10 * 1024 * 1024 };
  constructor(
    readonly grant: FolderGrant,
    private invoke: FolderCall,
  ) {}
  private call<T>(action: string, path?: string, data?: string) {
    return this.invoke<T>({ action, grant: this.grant.id, path, data });
  }
  canRead() {
    return this.call<boolean>('access');
  }
  canWrite() {
    return this.canRead();
  }
  workspaceIds() {
    return this.call<string[]>('workspaces');
  }
  async list(prefix: string) {
    return (await this.call<string[]>('list', prefix)).map((path) => ({ path }));
  }
  async read(path: string) {
    const data = await this.call<string | null>('read', path);
    return data === null ? null : Uint8Array.from(atob(data), (c) => c.charCodeAt(0));
  }
  async write(path: string, data: Uint8Array) {
    const parts: string[] = [];
    for (let i = 0; i < data.length; i += 16384)
      parts.push(String.fromCharCode(...data.subarray(i, i + 16384)));
    await this.call('write', path, btoa(parts.join('')));
  }
  async delete(path: string) {
    await this.call('remove', path);
  }
  async deleteWorkspace(id: string) {
    if (!/^[A-Za-z0-9_-]+$/.test(id)) throw new HostError('invalid');
    await this.delete('workspaces/' + id);
  }
}

type Pending = { assets: Record<string, AssetData> };
function pendingBytes(key: string, value: unknown, reading: boolean): unknown {
  if (key !== 'pending' || !value) return value;
  const pending = value as Pending;
  return {
    ...pending,
    assets: Object.fromEntries(
      Object.entries(pending.assets).map(([id, asset]) => [
        id,
        { ...asset, bytes: reading ? Uint8Array.from(asset.bytes) : Array.from(asset.bytes) },
      ]),
    ),
  };
}

export class FolderState implements RepositoryStateStore {
  constructor(
    private grant: string,
    private workspace: string,
    private invoke: FolderCall,
    private owner: 'foreground' | 'shortcut',
  ) {}
  private call<T>(action: string, args: Record<string, unknown> = {}) {
    return this.invoke<T>({
      action,
      workspace: this.workspace,
      grant: this.grant,
      owner: this.owner,
      ...args,
    });
  }
  async lock<T>(work: () => Promise<T>): Promise<T> {
    let token: string | null;
    const deadline = Date.now() + 15000;
    while (!(token = await this.call<string | null>('lock'))) {
      if (Date.now() >= deadline) throw new HostError('timeout');
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    try {
      return await work();
    } finally {
      await this.call('unlock', { token });
    }
  }
  async read<T>(key: string) {
    return (await this.readMany<T>([key]))[0];
  }
  async readMany<T>(keys: string[]) {
    const values = await this.call<unknown[]>('stateRead', { keys });
    return values.map((v, i) => (v === null ? undefined : (pendingBytes(keys[i], v, true) as T)));
  }
  entries<T>(prefix: string, after?: string, limit?: number) {
    return this.call<{ key: string; value: T }[]>('stateEntries', { prefix, after, limit });
  }
  async write(puts: { key: string; value: unknown }[], deletes: string[] = []) {
    await this.call('stateWrite', {
      puts: puts.map(({ key, value }) => ({ key, value: pendingBytes(key, value, false) })),
      deletes,
    });
  }
  async delete() {
    await this.call('stateDelete');
  }
}
