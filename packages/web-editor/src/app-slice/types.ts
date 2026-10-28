export interface AppSlicePermission {
  data: 'read' | 'readWrite';
  allowExternalResources: boolean;
}
export const defaultPermission: AppSlicePermission = {
  data: 'read',
  allowExternalResources: false,
};
export interface AppSlicePermissionStore {
  get(key: string): AppSlicePermission | undefined;
  set(key: string, permission: AppSlicePermission): void;
  subscribe?(key: string, listener: () => void): () => void;
}
export interface AppSliceOptions {
  permissionStore?: AppSlicePermissionStore;
  /** Optional trusted endpoint serving the same trusted bootstrap on an isolated origin. */
  runtimeUrl?: string;
  namespace?: string;
}
export function memoryPermissions(): AppSlicePermissionStore {
  const values = new Map<string, AppSlicePermission>();
  const listeners = new Map<string, Set<() => void>>();
  return {
    get: (key) => values.get(key),
    subscribe: (key, listener) => {
      const group = listeners.get(key) ?? new Set();
      group.add(listener);
      listeners.set(key, group);
      return () => {
        group.delete(listener);
        if (!group.size) listeners.delete(key);
      };
    },
    set: (key, value) => {
      values.set(key, { ...value });
      listeners.get(key)?.forEach((listener) => listener());
    },
  };
}
export class AppSliceError extends Error {
  constructor(
    readonly code: string,
    message = code,
  ) {
    super(message);
  }
}
export const MAX_MESSAGE = 2_000_000;
