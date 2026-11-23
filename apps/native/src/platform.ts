import { invoke } from '@tauri-apps/api/core';
import { getCurrent, onOpenUrl } from '@tauri-apps/plugin-deep-link';
import type { AppPlatform } from '@tio/app/platform';
import { folderBinding } from '@tio/app/services/folder-binding';
import { FileWorkspaceContent, FileRepository } from '@tio/file-storage';
import { NativeFolderProvider, FolderState } from '@tio/native-core/folder';
import { NativeRepository } from '@tio/native-core/native-repository';
import { withProcessLock } from '@tio/native-core/process-lock';
import type { Credentials } from '@tio/provider-github/credentials';

import { createHostCatalog, restoreNativeBindings } from './catalog';
import { nativeFolderCall, NativeFolderAdapter, pickFolder } from './folder-access';
import { confirmFrontendUpdate, type UpdateDiagnostics } from './frontend-update';
import { execute, deleteNativeWorkspace } from './native-ipc';
import { NativeRemoteCache } from './native-remote-cache';
import { NativeReplica } from './native-replica';
import { startResourceUpdate } from './updates';
const lock = <T>(name: string, work: () => Promise<T>) =>
  withProcessLock(name, work, (name, token) =>
    invoke<string | null>('process_lock', { name, token }),
  );
const vault = (action: string, value?: string) =>
  invoke<string | null>('github_credentials', { action, value });
export async function createNativePlatform(): Promise<AppPlatform> {
  await restoreNativeBindings();
  let saved: Credentials | undefined;
  const fresh = async () => {
    const value = await vault('read');
    return value ? (JSON.parse(value) as Credentials) : undefined;
  };
  try {
    saved = await fresh();
  } catch {
    console.warn('Credential store unavailable');
  }
  const ready = await startResourceUpdate().catch((error) => {
    console.warn('Resource pack unavailable', error);
    return undefined;
  });
  const scheme = import.meta.env.VITE_TIO_CHANNEL === 'android-apk' ? 'tio-apk:' : 'tio:';
  return {
    deviceLabel: 'welcome.device',
    catalog: createHostCatalog,
    deviceRepository: (workspace) => new NativeRepository(workspace, execute),
    deleteDevice: (_connection, workspace) => deleteNativeWorkspace(workspace),
    folder: {
      supported: () => true,
      pick: pickFolder,
      same: (a, b) => a.kind === 'native-folder' && b.kind === 'native-folder' && a.id === b.id,
      binding(connection, handle) {
        const grant = handle?.kind === 'native-folder' ? handle : undefined;
        const provider = grant ? new NativeFolderProvider(grant, nativeFolderCall) : undefined;
        const adapter = new NativeFolderAdapter(connection.id, provider!);
        return folderBinding(connection, {
          adapter,
          provider,
          async remove(workspace) {
            if (!grant) throw new Error('Folder unavailable');
            const state = new FolderState(grant.id, workspace, nativeFolderCall, 'foreground');
            await state.lock(async () => {
              await adapter.deleteWorkspace(workspace);
              await state.delete();
            });
          },
          repository(workspace) {
            if (!provider || !grant) throw new Error('Folder unavailable');
            const state = new FolderState(grant.id, workspace, nativeFolderCall, 'foreground');
            return new FileRepository(
              new FileWorkspaceContent(provider, workspace),
              workspace,
              state,
              (work) => state.lock(work),
            );
          },
        });
      },
    },
    github: {
      Replica: NativeReplica,
      cache: (namespace) => new NativeRemoteCache(namespace),
      persistEndpoints: (key, entries) => createHostCatalog().write(key, entries),
    },
    auth: {
      origin: import.meta.env.VITE_GITHUB_AUTH_URL ?? 'https://tio-api.linkai.work',
      attempts: () => localStorage,
      read: () => saved,
      readFresh: fresh,
      persist: async (value) => {
        await vault(value ? 'write' : 'clear', value ? JSON.stringify(value) : undefined);
      },
      remember: (value) => {
        saved = value;
      },
      lock: (work) => lock('tio-github-refresh', work),
      redirectURI: () => scheme + '//auth/github',
      acceptsCallback(input) {
        try {
          const url = new URL(input);
          return (
            url.protocol === scheme &&
            url.host === 'auth' &&
            url.pathname === '/github' &&
            !url.username &&
            !url.password
          );
        } catch {
          return false;
        }
      },
      open: (url) => invoke('open_github_login', { url }),
      callbacks: {
        current: async () => (await getCurrent()) ?? [],
        subscribe: (listener) => onOpenUrl(listener),
      },
    },
    sync: {
      active: () => true,
      subscribe(listener) {
        document.addEventListener('visibilitychange', listener);
        window.addEventListener('online', listener);
        return () => {
          document.removeEventListener('visibilitychange', listener);
          window.removeEventListener('online', listener);
        };
      },
      lock: (name, _session, work) => lock(name, work),
    },
    async update(action, version) {
      const diagnostics = await invoke<UpdateDiagnostics>('update_status', {
        check: action === 'check',
      });
      let staged = false;
      if (action === 'check' && diagnostics.enabled) {
        const runtime = await invoke<{ status: string } | null>('frontend_update', {
          action: 'download',
        });
        staged = runtime?.status === 'staged';
        const content = await invoke<{ status: string } | null>('download_resources', {
          channel: diagnostics.channel,
        });
        staged ||= content?.status === 'staged';
      }
      const host = await invoke<{ status: string; version?: string; pendingVersion?: string }>(
        'host_update',
        { action, version },
      );
      return {
        ...host,
        status:
          action === 'capabilities' && diagnostics.enabled
            ? 'enabled'
            : staged && ['store', 'current', 'disabled'].includes(host.status)
              ? 'runtime-staged'
              : host.status,
        diagnostics,
      };
    },
    async clearStorage() {
      await invoke('clear_host_storage');
      for (const storage of [localStorage, sessionStorage])
        for (const key of Object.keys(storage))
          if (key.startsWith('tio.') || key.startsWith('tio-')) storage.removeItem(key);
    },
    async afterReady() {
      await confirmFrontendUpdate();
      if (ready) await ready().catch((error) => console.warn('Resource update unavailable', error));
      await invoke('frontend_update', { action: 'download' });
    },
  };
}
