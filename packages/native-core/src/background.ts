import { githubAccessError } from '@tio/adapter-github';
import { HostError, type WorkspaceSession } from '@tio/core';
import {
  githubConnectionUserId,
  githubEndpointsKey,
  type GitHubEndpoint,
} from '@tio/provider-github';
import { githubToken } from '@tio/provider-github/credentials';

import { withProcessLock } from './process-lock';
import { syncGitHub } from './sync';

declare function tioNative(request: string): string;
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
    if (githubConnectionUserId(session.connectionId) === undefined) continue;
    if (await read('workspace-lifecycle/' + session.id)) continue;
    const endpoints = await read<[string, GitHubEndpoint][]>(
      githubEndpointsKey(session.connectionId),
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
      const result = await syncGitHub(
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
              'tio-github-refresh',
              () =>
                githubToken(user, {
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
      const state = githubAccessError(session.connectionId, error);
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
