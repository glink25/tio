import { chooseFolder, supported, FolderConnectionAdapter } from '@tio/adapter-local-folder';
import type { AppPlatform } from '@tio/app/platform';
import { folderBinding } from '@tio/app/services/folder-binding';
import { DomainError } from '@tio/core';
import { FileRepository, FileWorkspaceContent } from '@tio/file-storage';
import {
  LocalCatalog,
  LocalStore,
  IndexedRepositoryState,
  deleteLocalWorkspace,
  RemoteFileCache,
} from '@tio/local-store';
import type { Credentials } from '@tio/provider-github/credentials';
import { LocalFolderProvider } from '@tio/provider-local-folder';

const credentialsKey = 'tio.github.credentials';
const read = (): Credentials | undefined => {
  const value = localStorage.getItem(credentialsKey);
  return value ? JSON.parse(value) : undefined;
};
class BrowserReplica extends LocalStore {
  constructor(instance: string, _workspace: string) {
    super(instance);
  }
  get storageComplete() {
    return localStorage.getItem('tio.github.complete.' + this.instanceId) === 'true';
  }
  async setComplete() {
    localStorage.setItem('tio.github.complete.' + this.instanceId, 'true');
  }
}
const lock = <T>(name: string, work: () => Promise<T>) =>
  globalThis.navigator?.locks ? navigator.locks.request(name, work) : work();
async function clearStorage() {
  await Promise.all(
    ['tio-workspaces', 'tio-provider-recovery'].map(
      (name) =>
        new Promise<void>((resolve, reject) => {
          const request = indexedDB.deleteDatabase(name);
          const timeout = setTimeout(
            () => reject(new DomainError('close-tabs', 'Close other Tio tabs and retry.')),
            10000,
          );
          request.onsuccess = () => {
            clearTimeout(timeout);
            resolve();
          };
          request.onerror = () => {
            clearTimeout(timeout);
            reject(request.error);
          };
        }),
    ),
  );
  for (const storage of [localStorage, sessionStorage])
    for (const key of Object.keys(storage))
      if (key.startsWith('tio.') || key.startsWith('tio-')) storage.removeItem(key);
}
export function createWebPlatform(origin?: string): AppPlatform {
  return {
    deviceLabel: 'welcome.offline',
    catalog: () => new LocalCatalog(),
    deviceRepository: (_workspace, instance) => new LocalStore(instance),
    deleteDevice: (connection, workspace) => deleteLocalWorkspace(connection + '_' + workspace),
    folder: {
      supported,
      pick: async () => (await chooseFolder()).handle,
      same: (a, b) => (a.kind === 'directory' && b.kind === 'directory' ? a.isSameEntry(b) : false),
      binding(connection, handle) {
        const directory = handle?.kind === 'directory' ? handle : undefined;
        const adapter = new FolderConnectionAdapter(connection.id, directory);
        const provider = directory ? new LocalFolderProvider(directory) : undefined;
        return folderBinding(connection, {
          adapter,
          provider,
          async remove(workspace) {
            await adapter.deleteWorkspace(workspace);
            const journal = new IndexedRepositoryState(connection.id + '_' + workspace);
            try {
              await journal.delete();
            } finally {
              journal.close();
            }
          },
          repository(workspace, instance) {
            if (!provider) throw new Error('Folder unavailable');
            const journal = new IndexedRepositoryState(instance);
            const repository = new FileRepository(
              new FileWorkspaceContent(provider, workspace),
              workspace,
              journal,
              (work) => lock('tio-' + instance, work),
            );
            const stop = journal.subscribe(() => {
              void repository.notifyChanges();
            });
            const close = repository.close.bind(repository);
            repository.close = () => {
              stop();
              close();
              journal.close();
            };
            return repository;
          },
        });
      },
    },
    github: {
      Replica: BrowserReplica,
      cache: (namespace) => new RemoteFileCache(namespace),
      persistEndpoints: async () => {},
    },
    auth: {
      origin,
      attempts: () => sessionStorage,
      read,
      readFresh: async () => read(),
      persist: async (value) => {
        if (value) localStorage.setItem(credentialsKey, JSON.stringify(value));
        else localStorage.removeItem(credentialsKey);
      },
      remember: () => {},
      lock: (work) => lock('tio-github-refresh', work),
      redirectURI: () => location.origin + location.pathname,
      acceptsCallback: () => false,
      open: async (url) => {
        location.assign(url);
      },
    },
    sync: {
      active: () => document.visibilityState === 'visible',
      subscribe(listener) {
        document.addEventListener('visibilitychange', listener);
        globalThis.window?.addEventListener('online', listener);
        return () => {
          document.removeEventListener('visibilitychange', listener);
          globalThis.window?.removeEventListener('online', listener);
        };
      },
      lock: (_name, session, work) => lock('tio-' + session, work),
    },
    clearStorage,
  };
}
