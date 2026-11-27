import { HostError } from '@tio/core';
import { StorageError, type FileStorageProvider } from '@tio/storage';
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

export function folderFailure(code: unknown) {
  if (code === 'permission') return new StorageError('permission', 'Folder permission required');
  if (
    code === 'closed' ||
    code === 'pending' ||
    code === 'conflict' ||
    code === 'invalid' ||
    code === 'timeout'
  )
    return new HostError(code);
  return new HostError('unavailable');
}

export function nativeFolderGrant(connectionId: string) {
  return /^folder-([a-f0-9]{64})$/.exec(connectionId)?.[1];
}
