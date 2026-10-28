import { connectionError, type ConnectionAdapter, type ConnectionAccessState } from '@tio/core';
import { LocalFolderProvider } from '@tio/provider-local-folder';
import { StorageError } from '@tio/storage';
export const supported = () =>
  typeof window !== 'undefined' &&
  typeof window.showDirectoryPicker === 'function' &&
  window.isSecureContext;
export async function chooseFolder() {
  const handle = await window.showDirectoryPicker({ mode: 'readwrite' });
  return { handle, provider: new LocalFolderProvider(handle) };
}
export async function permission(handle: FileSystemDirectoryHandle, request = false) {
  const p = await handle.queryPermission({ mode: 'readwrite' });
  return (
    p === 'granted' ||
    (request && (await handle.requestPermission({ mode: 'readwrite' })) === 'granted')
  );
}

export class FolderConnectionAdapter implements ConnectionAdapter {
  readonly supportsSync = true;
  private listeners = new Set<(state: ConnectionAccessState) => void>();
  constructor(
    private connectionId: string,
    private handle?: FileSystemDirectoryHandle,
  ) {}
  subscribe(listener: (state: ConnectionAccessState) => void) {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }
  private publish(code: ConnectionAccessState['code']) {
    const state = { code, scope: { connectionId: this.connectionId } };
    for (const listener of this.listeners) listener(state);
    return state;
  }
  classifyError(error: unknown) {
    if (error instanceof StorageError && error.code === 'permission')
      return {
        code: 'reauthorization-required' as const,
        scope: { connectionId: this.connectionId },
      };
    return connectionError(error, this.connectionId);
  }
  async deleteWorkspace(workspaceId: string) {
    if (!this.handle) throw new StorageError('missing', 'Folder unavailable');
    await new LocalFolderProvider(this.handle).deleteWorkspace(workspaceId);
  }
  async getAccessState() {
    if (!this.handle) return this.publish('unrecoverable');
    try {
      return this.publish(
        (await this.handle.queryPermission({ mode: 'readwrite' })) === 'granted'
          ? 'available'
          : 'reauthorization-required',
      );
    } catch (error) {
      return this.publish(this.classifyError(error).code);
    }
  }
  async reauthorize(): Promise<'success' | 'cancelled' | 'failed'> {
    if (!this.handle) {
      this.publish('unrecoverable');
      return 'failed';
    }
    try {
      // Invoke immediately within the user's click stack, before any asynchronous work.
      const result = await this.handle.requestPermission({ mode: 'readwrite' });
      this.publish(result === 'granted' ? 'available' : 'reauthorization-required');
      return result === 'granted' ? 'success' : 'cancelled';
    } catch (error) {
      this.publish(
        (error as Error).name === 'AbortError'
          ? 'reauthorization-required'
          : this.classifyError(error).code,
      );
      return (error as Error).name === 'AbortError' ? 'cancelled' : 'failed';
    }
  }
}
