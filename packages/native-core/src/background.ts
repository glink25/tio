import { giteeAccessError } from '@tio/adapter-gitee';
import { githubAccessError } from '@tio/adapter-github';
import { HostError, type WorkspaceSession } from '@tio/core';
import { FileWorkspaceContent } from '@tio/file-storage';
import { GiteeError, giteeEndpointsKey } from '@tio/provider-gitee';
import { GitHubError } from '@tio/provider-github';
import { githubEndpointsKey, type GitHubEndpoint } from '@tio/provider-github';
import { gitConnection, gitToken } from '@tio/provider-github/credentials';
import { StorageError } from '@tio/storage';
import { executeSyncBatch, SyncCore } from '@tio/sync';

import { folderFailure, nativeFolderGrant, NativeFolderProvider } from './folder';
import { withProcessLock } from './process-lock';
import { ReplicaRepository } from './replica';
import { syncGit } from './sync';

declare function tioNative(request: string): string;
declare function tioFolder(request: string): string;
declare function tioCredential(action: string, value: string): string;
declare function tioFetch(url: string, request: string): string;
declare function tioLock(name: string, token: string): string | null;
declare function tioCancelled(): boolean;
declare function tioKernelInfo(): string;

const shouldRetry = {
  synced: false,
  manual: false,
  permission: false,
  issues: true,
  failed: true,
  deferred: true,
} as const;
type BackgroundStatus = keyof typeof shouldRetry;

export async function runBackground() {
  const call = async <T>(request: Record<string, unknown>): Promise<T> => {
    if (tioCancelled()) throw new HostError('timeout');
    const reply = JSON.parse(tioNative(JSON.stringify(request)));
    if (reply.error) throw new HostError(reply.error);
    return reply.value;
  };
  const read = <T>(key: string) => call<T | undefined>({ action: 'read', key });
  const write = (key: string, value: unknown) => call<void>({ action: 'write', key, value });
  const authOrigin = await call<string>({ action: 'authOrigin' });
  const transport = (async (url, options) => {
    const reply = JSON.parse(
      tioFetch(
        typeof url === 'string' ? url : 'url' in url ? url.url : url.href,
        JSON.stringify(options ?? {}),
      ),
    );
    if (reply.error) throw new HostError(reply.error);
    return {
      ok: reply.status >= 200 && reply.status < 300,
      status: reply.status,
      headers: { get: (name: string) => reply.headers[name.toLowerCase()] ?? null },
      json: async () => JSON.parse(reply.body),
      text: async () => reply.body,
    } as Response;
  }) as typeof fetch;
  const signal = {
    get aborted() {
      return tioCancelled();
    },
    throwIfAborted() {
      if (tioCancelled()) throw new HostError('timeout');
    },
    addEventListener() {},
    removeEventListener() {},
  } as unknown as AbortSignal;
  const sessions = await call<WorkspaceSession[]>({ action: 'sessions' });
  const results: { session: string; status: BackgroundStatus }[] = [];
  for (const session of sessions) {
    if (await read('workspace-lifecycle/' + session.id)) continue;
    const grant = nativeFolderGrant(session.connectionId);
    if (grant) {
      if (typeof tioFolder !== 'function') continue;
      const instance = session.id;
      const local = new ReplicaRepository(instance, session.workspaceId, (space, action, args) =>
        call({ action: 'replica', replica: instance, space, request: { action, ...args } }),
      );
      const provider = new NativeFolderProvider(
        { kind: 'native-folder', id: grant, name: '' },
        async (request) => {
          signal.throwIfAborted();
          const reply = JSON.parse(tioFolder(JSON.stringify(request)));
          if (reply.error) throw folderFailure(reply.error);
          return reply.value;
        },
      );
      const content = new FileWorkspaceContent(provider, session.workspaceId);
      const core = new SyncCore(local, content, instance, session.workspaceId);
      const completeKey = 'replica-complete/' + instance;
      const lifecycleKey = 'workspace-lifecycle/' + session.id;
      const complete = async () => (await read<boolean>(completeKey)) === true;
      const automaticEnabled = async () => {
        const workspace = (await local.get(session.workspaceId))?.object;
        return !!workspace && workspace.manualSync !== true && !workspace.deleted;
      };
      try {
        const status = await withProcessLock(
          'tio-sync-' + instance,
          async (): Promise<BackgroundStatus> => {
            if (await read(lifecycleKey)) return 'manual';
            const initializing = !(await complete());
            let automatic = await automaticEnabled();
            if (!initializing && !automatic) return 'manual';
            await executeSyncBatch(core, {
              initializing,
              automatic: true,
              automaticEnabled: () => automatic,
              initialization: {
                isComplete: complete,
                complete: () => write(completeKey, true),
                targetId: () => session.selectedId,
              },
              initialized: async () => {
                automatic = await automaticEnabled();
              },
              signal,
            });
            signal.throwIfAborted();
            return core.issues.length ? 'issues' : 'synced';
          },
          async (name, token) => tioLock(name, token ?? ''),
          signal,
        );
        results.push({ session: session.id, status });
      } catch (error) {
        signal.throwIfAborted();
        const status =
          error instanceof StorageError && error.code === 'permission' ? 'permission' : 'failed';
        results.push({ session: session.id, status });
      } finally {
        local.close();
      }
      continue;
    }
    const account = gitConnection(session.connectionId);
    if (!account) continue;
    const gitee = account.provider === 'gitee';
    const endpoints = await read<[string, GitHubEndpoint][]>(
      (gitee ? giteeEndpointsKey : githubEndpointsKey)(session.connectionId),
    );
    const endpoint = endpoints?.find(([id]) => id === session.workspaceId)?.[1];
    if (!endpoint) continue;
    const retryKey = 'background-sync-retry/' + session.id;
    if (((await read<number>(retryKey)) ?? 0) > Date.now()) {
      results.push({ session: session.id, status: 'deferred' });
      continue;
    }
    const instance = session.id + '/' + endpoint.repositoryId + '/' + endpoint.branch;
    try {
      const result = await syncGit(
        {
          connection: session.connectionId,
          instance: session.id,
          endpoint,
        },
        {
          execute: (space, action, args) =>
            call({ action: 'replica', replica: instance, space, request: { action, ...args } }),
          read,
          write,
          token: (user) =>
            withProcessLock(
              'tio-git-refresh',
              () =>
                gitToken(account.provider, user, {
                  read: async () => {
                    const reply = JSON.parse(tioCredential('read', ''));
                    if (reply.error) throw new HostError(reply.error);
                    return reply.value ? JSON.parse(reply.value) : undefined;
                  },
                  write: async (value) => {
                    const reply = JSON.parse(tioCredential('write', JSON.stringify(value)));
                    if (reply.error) throw new HostError(reply.error);
                  },
                  transport,
                  authOrigin,
                }),
              async (name, token) => tioLock(name, token ?? ''),
              signal,
            ),
          transport,
          lock: async (name, token) => tioLock(name, token ?? ''),
          signal,
        },
      );
      await write(retryKey, 'retryAt' in result ? result.retryAt : 0);
      results.push({ session: session.id, status: result.status });
    } catch (error) {
      if (tioCancelled()) throw error;
      const failure =
        gitee && error instanceof GitHubError ? new GiteeError(error.status, error.retryAt) : error;
      const state = (gitee ? giteeAccessError : githubAccessError)(session.connectionId, failure);
      await write(retryKey, state.retryAt ?? 0);
      const permission = ['reauthorization-required', 'forbidden', 'unrecoverable'].includes(
        state.code,
      );
      results.push({ session: session.id, status: permission ? 'permission' : 'failed' });
    }
  }
  await write('background-sync-result', {
    at: Date.now(),
    results,
    kernel: JSON.parse(tioKernelInfo()),
  });
  return { retry: results.some(({ status }) => shouldRetry[status]) };
}
