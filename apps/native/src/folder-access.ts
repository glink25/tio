import { invoke } from '@tauri-apps/api/core';
import {
  connectionError,
  HostError,
  type ConnectionAccessState,
  type ConnectionAdapter,
} from '@tio/core';
import { NativeFolderProvider, type FolderGrant } from '@tio/native-core/folder';
import { StorageError } from '@tio/storage';
export async function nativeFolderCall<T>(request: Record<string, unknown>): Promise<T> {
  try {
    return await invoke<T>(
      import.meta.env.VITE_TIO_PLATFORM === 'ios' ? 'apple_folder' : 'native_folder',
      { request },
    );
  } catch (code) {
    if (code === 'cancelled') throw new DOMException('Cancelled', 'AbortError');
    if (code === 'permission') throw new StorageError('permission', 'Folder permission required');
    if (code === 'pending' || code === 'conflict' || code === 'invalid') throw new HostError(code);
    throw new HostError('unavailable');
  }
}
export const pickFolder = () => nativeFolderCall<FolderGrant>({ action: 'pick' });
const isGrant = (value?: unknown): value is FolderGrant =>
  !!value && typeof value === 'object' && 'kind' in value && value.kind === 'native-folder';
export class NativeFolderAdapter implements ConnectionAdapter {
  readonly supportsSync = true;
  private listeners = new Set<(state: ConnectionAccessState) => void>();
  constructor(
    private id: string,
    private provider: NativeFolderProvider,
  ) {}
  subscribe(fn: (state: ConnectionAccessState) => void) {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  }
  classifyError(error: unknown): ConnectionAccessState {
    if (error instanceof StorageError && error.code === 'permission')
      return { code: 'reauthorization-required', scope: { connectionId: this.id } };
    return connectionError(error, this.id);
  }
  async getAccessState(): Promise<ConnectionAccessState> {
    try {
      await this.provider.canRead();
      return { code: 'available', scope: { connectionId: this.id } };
    } catch (error) {
      return this.classifyError(error);
    }
  }
  async reauthorize(): Promise<'success' | 'cancelled' | 'failed'> {
    try {
      const selected = await pickFolder();
      if (!isGrant(selected) || selected.id !== this.provider.grant.id) return 'failed';
      const state = await this.getAccessState();
      for (const fn of this.listeners) fn(state);
      return state.code === 'available' ? 'success' : 'failed';
    } catch (error) {
      return error instanceof DOMException && error.name === 'AbortError' ? 'cancelled' : 'failed';
    }
  }
  deleteWorkspace(id: string) {
    return this.provider.deleteWorkspace(id);
  }
}
