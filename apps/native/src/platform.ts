import { invoke } from '@tauri-apps/api/core';
import { getCurrent, onOpenUrl } from '@tauri-apps/plugin-deep-link';
import type { AppPlatform } from '@tio/app/platform';
import { folderBinding } from '@tio/app/services/folder-binding';
import { NativeFolderProvider, type FolderGrant } from '@tio/native-core/folder';
import { NativeRepository } from '@tio/native-core/native-repository';
import { withProcessLock } from '@tio/native-core/process-lock';
import type { Credentials } from '@tio/provider-github/credentials';

import { createAssistantFetch } from './assistant-fetch';
import { createHostCatalog, restoreNativeBindings } from './catalog';
import { createDesktopChrome } from './desktop-chrome';
import { createNativeFolderCall, NativeFolderAdapter } from './folder-access';
import { confirmFrontendUpdate, type UpdateDiagnostics } from './frontend-update';
import { execute, deleteNativeWorkspace } from './native-ipc';
import { NativeRemoteCache } from './native-remote-cache';
import { NativeReplica } from './native-replica';
import { reportMobileStartup } from './splash';
import { startResourceUpdate } from './updates';
import { createWindowHost } from './window-host';
const vault = (action: string, value?: string) =>
  invoke<string | null>('git_credentials', { action, value });
export async function createNativePlatform(): Promise<AppPlatform> {
  const host = await createWindowHost();
  const target = import.meta.env.VITE_TIO_PLATFORM;
  const systemAuthentication = !!import.meta.env.VITE_TIO_SYSTEM_AUTH;
  const attemptStorage = systemAuthentication ? sessionStorage : localStorage;
  const nativeFolderCall = createNativeFolderCall(host.generation);
  const pickFolder = () => nativeFolderCall<FolderGrant>({ action: 'pick' });
  const lock = <T>(name: string, work: () => Promise<T>) =>
    withProcessLock(name, work, (name, token) =>
      invoke<string | null>('process_lock', { name, token, generation: host.generation }),
    );
  await restoreNativeBindings();
  const attempts = {
    getItem: (key: string) => attemptStorage.getItem(key),
    setItem: (key: string, value: string) =>
      attemptStorage.setItem(
        key,
        JSON.stringify({
          ...JSON.parse(value),
          origin: host.label,
        }),
      ),
    removeItem: (key: string) => attemptStorage.removeItem(key),
  };
  const callbacksForWindow = async (urls: string[]) => {
    const matching = await Promise.all(
      urls.map(async (input) => {
        try {
          const url = new URL(input);
          if (
            url.protocol !== 'tio:' ||
            url.host !== 'auth' ||
            !['/github', '/gitee'].includes(url.pathname)
          )
            return false;
          const attempt = attempts.getItem(`tio.${url.pathname.slice(1)}.login`);
          if (!attempt) return false;
          const pending = JSON.parse(attempt);
          return (
            url.searchParams.get('state') === pending.state &&
            (await host.canHandleCallback(pending.origin))
          );
        } catch {
          return false;
        }
      }),
    );
    return urls.filter((_url, index) => matching[index]);
  };
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
  const scheme = 'tio:';
  return {
    mobile: target === 'ios' || target === 'android' ? target : undefined,
    assistantFetch: createAssistantFetch(host.generation),
    deviceLabel: 'welcome.device',
    windows: host.windows,
    desktopChrome: host.desktop ? createDesktopChrome() : undefined,
    onStartupReady: () => reportMobileStartup('ready'),
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
        const adapter = new NativeFolderAdapter(connection.id, provider, pickFolder);
        return folderBinding(connection, {
          adapter,
          provider,
          async remove(workspace, instance) {
            await lock('tio-folder-local-' + instance, async () => {
              await adapter.deleteWorkspace(workspace);
              await invoke('workspace', {
                space: workspace,
                replica: instance,
                request: { action: 'delete' },
              });
              await createHostCatalog().write('replica-complete/' + instance, null);
            });
          },
          Replica: NativeReplica,
        });
      },
    },
    Replica: NativeReplica,
    git: {
      cache: (namespace) => new NativeRemoteCache(namespace),
      persistEndpoints: (key, entries) => createHostCatalog().write(key, entries),
    },
    auth: {
      origin: import.meta.env.VITE_GITHUB_AUTH_URL ?? 'https://tio-api.linkai.work',
      attempts: () => attempts,
      read: () => saved,
      readFresh: fresh,
      persist: async (value) => {
        await vault(value ? 'write' : 'clear', value ? JSON.stringify(value) : undefined);
      },
      remember: (value) => {
        saved = value;
      },
      lock: (work) => lock('tio-git-refresh', work),
      redirectURI: (provider) => scheme + '//auth/' + provider,
      acceptsCallback(input, provider) {
        try {
          const url = new URL(input);
          return (
            url.protocol === scheme &&
            url.host === 'auth' &&
            url.pathname === '/' + provider &&
            !url.username &&
            !url.password
          );
        } catch {
          return false;
        }
      },
      open: (url) => invoke('open_git_login', { url }),
      authenticate: systemAuthentication
        ? (url) => invoke<string | null>('authenticate_git', { url, generation: host.generation })
        : undefined,
      callbacks: systemAuthentication
        ? undefined
        : {
            current: async () => callbacksForWindow((await getCurrent()) ?? []),
            subscribe: (listener) =>
              onOpenUrl((urls) => {
                void callbacksForWindow(urls).then(listener);
              }),
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
      const install = () =>
        invoke<{ status: string; version?: string; pendingVersion?: string }>('host_update', {
          action,
          version,
        });
      const update =
        action === 'install' && host.desktop
          ? await host.windows.changeConnection(install)
          : await install();
      return {
        ...update,
        status:
          action === 'capabilities' && diagnostics.enabled
            ? 'enabled'
            : staged && ['store', 'current', 'disabled'].includes(update.status)
              ? 'runtime-staged'
              : update.status,
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
      if (!(await host.takeMaintenance())) return;
      await confirmFrontendUpdate();
      if (ready) await ready().catch((error) => console.warn('Resource update unavailable', error));
      await invoke('frontend_update', { action: 'download' });
    },
  };
}
