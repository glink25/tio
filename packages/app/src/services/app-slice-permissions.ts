import type { AppSlicePermissionStore } from '@tio/web-editor';
export const appSlicePermissions: AppSlicePermissionStore = {
  subscribe(key, listener) {
    const local = (event: Event) => {
      if ((event as CustomEvent).detail === key) listener();
    };
    const remote = (event: StorageEvent) => {
      if (event.key === 'tio.app-slice.' + key || event.key === null) listener();
    };
    window.addEventListener('tio-app-slice-permission', local);
    window.addEventListener('storage', remote);
    return () => {
      window.removeEventListener('tio-app-slice-permission', local);
      window.removeEventListener('storage', remote);
    };
  },
  get(key) {
    try {
      const value = JSON.parse(localStorage.getItem('tio.app-slice.' + key) ?? 'null');
      if (
        value &&
        ['read', 'readWrite'].includes(value.data) &&
        typeof value.allowExternalResources === 'boolean'
      )
        return value;
    } catch {
      /* Missing or damaged preferences use read-only defaults. */
    }
    return undefined;
  },
  set(key, value) {
    localStorage.setItem('tio.app-slice.' + key, JSON.stringify(value));
    window.dispatchEvent(new CustomEvent('tio-app-slice-permission', { detail: key }));
  },
};
export const appSlice = { permissionStore: appSlicePermissions, namespace: 'browser-profile' };
