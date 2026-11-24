import { githubAccessError } from '@tio/adapter-github';
import { HostError } from '@tio/core';
import { FileWorkspaceContent } from '@tio/file-storage';
import {
  GitHubClient,
  GitHubProvider,
  githubConnectionUserId,
  type GitHubEndpoint,
  type GitHubSnapshotState,
} from '@tio/provider-github';
import { SyncCore, executeSyncBatch } from '@tio/sync';

import { withProcessLock } from './process-lock';
import { ReplicaRepository } from './replica';

export interface HeadlessSyncHost {
  execute<T>(space: string, action: string, args?: Record<string, unknown>): Promise<T>;
  read<T>(key: string): Promise<T | undefined>;
  write(key: string, value: unknown): Promise<void>;
  token(userId: number): Promise<string>;
  transport: typeof fetch;
  lock(name: string, token?: string): Promise<string | null>;
  signal: AbortSignal;
}

/** System hosts inject I/O and cancellation. All merge and publication semantics remain shared. */
export async function syncGitHub(
  input: { connection: string; instance: string; endpoint: GitHubEndpoint },
  host: HeadlessSyncHost,
) {
  const user = githubConnectionUserId(input.connection);
  if (user === undefined) throw new HostError('invalid');
  const { endpoint } = input;
  const instance = input.instance + '/' + endpoint.repositoryId + '/' + endpoint.branch;
  const store = new ReplicaRepository(instance, endpoint.workspaceId, (space, action, args) =>
    host.execute(space, action, args),
  );
  const prefix =
    'remote-cache/' +
    JSON.stringify([
      input.connection,
      String(endpoint.repositoryId),
      endpoint.branch,
      endpoint.workspaceId,
    ]) +
    '/';
  const client = new GitHubClient(() => host.token(user), host.transport);
  const provider = new GitHubProvider(client, endpoint, {
    getSnapshot: () => host.read<GitHubSnapshotState>(prefix + 'snapshot'),
    setSnapshot: (value) => host.write(prefix + 'snapshot', value),
    async getBlob(sha) {
      const bytes = await host.read<number[]>(prefix + 'blob/' + sha);
      return bytes ? Uint8Array.from(bytes) : undefined;
    },
    putBlob: (sha, value) => host.write(prefix + 'blob/' + sha, Array.from(value)),
  });
  const key =
    user + '/' + endpoint.repositoryId + '/' + endpoint.branch + '/' + endpoint.workspaceId;
  const completeKey = 'replica-complete/' + instance;
  const core = new SyncCore(
    store,
    new FileWorkspaceContent(provider, endpoint.workspaceId),
    key,
    endpoint.workspaceId,
  );
  const automaticEnabled = async () => {
    const root = (await store.get(endpoint.workspaceId))?.object;
    return !!root && root.manualSync !== true && !root.deleted;
  };
  try {
    return await withProcessLock(
      'tio-sync-' + key,
      async () => {
        const initializing = (await host.read<boolean>(completeKey)) !== true;
        let automatic = await automaticEnabled();
        if (!initializing && !automatic) return { status: 'manual' as const };
        await executeSyncBatch(core, {
          initializing,
          automatic: true,
          automaticEnabled: () => automatic,
          initialization: {
            isComplete: async () => !initializing,
            complete: () => host.write(completeKey, true),
          },
          initialized: async () => {
            automatic = await automaticEnabled();
          },
          signal: host.signal,
        });
        host.signal.throwIfAborted();
        const access = core.issues.map((issue) => githubAccessError(input.connection, issue.error));
        const permission = access.some((state) =>
          ['reauthorization-required', 'forbidden', 'unrecoverable'].includes(state.code),
        );
        const retryAt = Math.max(0, ...access.map((state) => state.retryAt ?? 0));
        return {
          status: permission
            ? ('permission' as const)
            : core.issues.length
              ? ('issues' as const)
              : ('synced' as const),
          retryAt,
          issues: core.issues.map((issue) => ({
            id: issue.id,
            path: issue.path,
            code: issue.code,
          })),
        };
      },
      (name, token) => host.lock(name, token),
      host.signal,
    );
  } finally {
    store.close();
  }
}
