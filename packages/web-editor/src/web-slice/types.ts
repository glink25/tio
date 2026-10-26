export interface WebSlicePermission {
  data: 'read' | 'readWrite';
  allowExternalResources: boolean;
}
export const defaultPermission: WebSlicePermission = {
  data: 'read',
  allowExternalResources: false,
};
export interface WebSlicePermissionStore {
  get(key: string): WebSlicePermission | undefined;
  set(key: string, permission: WebSlicePermission): void;
  subscribe?(key: string, listener: () => void): () => void;
}
export interface WebSliceOptions {
  permissionStore?: WebSlicePermissionStore;
  /** Optional trusted endpoint serving the same trusted bootstrap on an isolated origin. */
  runtimeUrl?: string;
  namespace?: string;
}
export function memoryPermissions(): WebSlicePermissionStore {
  const values = new Map<string, WebSlicePermission>();
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
export class SliceError extends Error {
  constructor(
    readonly code: string,
    message = code,
  ) {
    super(message);
  }
}
export const MAX_MESSAGE = 2_000_000;
