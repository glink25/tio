import { invoke } from '@tauri-apps/api/core';
import { HostError } from '@tio/core';
export async function execute<T>(
  space: string,
  action: string,
  args: Record<string, unknown> = {},
) {
  try {
    return await invoke<T>('workspace', { space, request: { action, ...args } });
  } catch (error) {
    if (error === 'closed' || error === 'invalid' || error === 'unavailable')
      throw new HostError(error);
    throw error;
  }
}

export const deleteNativeWorkspace = (space: string) => execute<void>(space, 'delete');
