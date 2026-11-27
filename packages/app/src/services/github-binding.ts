import { GiteeAdapter } from '@tio/adapter-gitee';
import { GitHubAdapter } from '@tio/adapter-github';
import { AutomationRunner } from '@tio/automation';
import type { Connection, TioObject } from '@tio/core';
import { FileWorkspaceContent } from '@tio/file-storage';
import { t } from '@tio/i18n';
import { GiteeClient, GiteeError, GiteeProvider, giteeEndpointsKey } from '@tio/provider-gitee';
import {
  GitHubClient,
  githubEndpointsKey,
  GitHubProvider,
  GitHubError,
  type GitHubEndpoint,
} from '@tio/provider-github';
import { StorageError } from '@tio/storage';

import { giteeIconUrl } from '../components/gitee-icon';
import { platform } from '../platform';
import type { ConnectionBinding } from './connection-adapters';
import { accessToken, credentials, loginGit } from './github-auth';
import { createReplica, replicaSyncStore } from './replica';

export function gitBinding(connection: Connection): ConnectionBinding {
  const kind = connection.kind === 'gitee' ? 'gitee' : 'github';
  const storageKey = (kind === 'gitee' ? giteeEndpointsKey : githubEndpointsKey)(connection.id);
  const endpoints = new Map<string, GitHubEndpoint>(
    JSON.parse(localStorage.getItem(storageKey) ?? '[]'),
  );
  let disposed = false;
  const persist = async () => {
    if (disposed) return;
    await platform().git.persistEndpoints(storageKey, [...endpoints]);
    localStorage.setItem(storageKey, JSON.stringify([...endpoints]));
  };
  const userId = Number(connection.id.slice(kind.length + 1));
  const matches = () => credentials()?.provider === kind && credentials()?.userId === userId;
  const githubClient = new GitHubClient(() => accessToken('github', userId));
  const giteeClient = new GiteeClient(async () => {
    try {
      return await accessToken('gitee', userId);
    } catch (error) {
      if (error instanceof GitHubError) throw new GiteeError(error.status, error.retryAt);
      throw error;
    }
  });
  const reauthorize = async () => {
    return (await loginGit(kind, userId)) === 'success' ? 'success' : 'cancelled';
  };
  const adapter =
    kind === 'gitee'
      ? new GiteeAdapter(connection.id, userId, giteeClient, endpoints, reauthorize)
      : new GitHubAdapter(
          connection.id,
          userId,
          githubClient,
          () => credentials()?.mode ?? 'app',
          endpoints,
          reauthorize,
        );
  const contents = new Map<string, FileWorkspaceContent>();
  const caches = new Map<string, import('@tio/provider-github').GitHubCache>();
  const provider = (endpoint: GitHubEndpoint) => {
    const namespace = [
      connection.id,
      String(endpoint.repositoryId),
      endpoint.branch,
      endpoint.workspaceId,
    ];
    const key = JSON.stringify(namespace);
    let cache = caches.get(key);
    if (!cache) {
      cache = platform().git.cache(namespace);
      caches.set(key, cache);
    }
    return kind === 'gitee'
      ? new GiteeProvider(giteeClient, endpoint, cache)
      : new GitHubProvider(githubClient, endpoint, cache);
  };
  const content = (workspaceId: string) => {
    let value = contents.get(workspaceId);
    if (!value) {
      const endpoint = endpoints.get(workspaceId);
      if (!endpoint) throw new Error('GitHub workspace is not bound');
      value = new FileWorkspaceContent(provider(endpoint), workspaceId);
      contents.set(workspaceId, value);
    }
    return value;
  };
  const Replica = createReplica(platform().Replica, content, () => !disposed);
  const collaborators = new Map<
    string,
    { token: string; value: Promise<import('@tio/core').MentionCandidate[]> }
  >();
  const replicas = new Map<string, InstanceType<typeof Replica>>();
  return {
    repositoryPollMs: 60000,
    dispose: () => {
      collaborators.clear();
      caches.clear();
      disposed = true;
    },
    identity: {
      provider: kind,
      name: connection.name,
      get avatarUrl() {
        return matches() ? credentials()?.avatarUrl : undefined;
      },
      icon:
        kind === 'gitee'
          ? giteeIconUrl
          : 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="gray" stroke-width="2"%3E%3Ccircle cx="12" cy="12" r="9"/%3E%3Cpath d="M8 20v-4c-4-1-4-7-1-8V5l4 2h2l4-2v3c3 1 3 7-1 8v4"/%3E%3C/svg%3E',
      details: [],
    },
    adapter,
    isContentReady: (workspaceId) => replicas.get(workspaceId)?.complete ?? false,
    workspaceActions(workspaceId) {
      const links = adapter.workspaceLinks(workspaceId);
      return {
        delete: {
          kind: 'external',
          url: links.delete,
          title: t('workspace.delete'),
          description: t(kind === 'gitee' ? 'workspace.deleteGitee' : 'workspace.deleteGitHub', {
            repository: links.repository,
          }),
          confirmLabel: t(kind === 'gitee' ? 'workspace.openGitee' : 'workspace.openGitHub'),
        },
        share: {
          kind: 'external',
          url: links.share,
          title: t('workspace.share'),
          description: t(kind === 'gitee' ? 'workspace.shareGitee' : 'workspace.shareGitHub', {
            repository: links.repository,
          }),
          confirmLabel: t(kind === 'gitee' ? 'workspace.openGitee' : 'workspace.openGitHub'),
        },
      };
    },
    mentionPeople(workspaceId) {
      const auth = credentials();
      if (disposed || !auth || !matches())
        return Promise.reject(new GitHubError(401, 'GitHub account does not match this workspace'));
      const key = `${workspaceId}/${endpoints.get(workspaceId)?.repositoryId}`;
      const existing = collaborators.get(key);
      if (existing?.token === auth.accessToken) return existing.value;
      const value = adapter.collaborators(workspaceId).catch((error) => {
        if (collaborators.get(key)?.value === value) collaborators.delete(key);
        throw error;
      });
      collaborators.set(key, { token: auth.accessToken, value });
      return value;
    },
    automation: (runtime, workspaceId) => new AutomationRunner(runtime, workspaceId),
    repository: (workspaceId, instanceId) => {
      const endpoint = endpoints.get(workspaceId);
      if (!endpoint) throw new Error('GitHub workspace is not bound');
      const store = new Replica(
        `${instanceId}/${endpoint.repositoryId}/${endpoint.branch}`,
        workspaceId,
      );
      replicas.set(workspaceId, store);
      return store;
    },
    sync: (workspaceId, repository) => ({
      store: replicaSyncStore(repository as InstanceType<typeof Replica>),
      content: content(workspaceId),
      endpoint: `${kind === 'gitee' ? connection.id : userId}/${endpoints.get(workspaceId)!.repositoryId}/${endpoints.get(workspaceId)!.branch}/${workspaceId}`,
      pollMs: 60000,
      initialization: {
        isComplete: () => replicas.get(workspaceId)?.isComplete() ?? false,
        complete: () => replicas.get(workspaceId)!.markComplete(),
      },
    }),
    async create(workspaceId) {
      await adapter.create(workspaceId);
      await persist();
    },
    async discover() {
      const found = await adapter.discover();
      const candidates: { workspace: TioObject; endpoint: GitHubEndpoint }[] = [];
      for (const item of found) {
        if (item.problem) continue;
        if (!item.workspaceId || !item.endpoint) continue;
        const bound = endpoints.get(item.workspaceId);
        if (bound && bound.repositoryId !== item.repo.id) continue;
        try {
          const candidate = new FileWorkspaceContent(provider(item.endpoint), item.workspaceId);
          const workspace = await candidate.read(item.workspaceId);
          if (workspace?.type === 'workspace') {
            candidates.push({ workspace, endpoint: item.endpoint });
          }
        } catch (error) {
          if (!(error instanceof StorageError && ['invalid', 'missing'].includes(error.code)))
            throw error;
        }
      }
      const counts = new Map<string, number>();
      for (const { workspace } of candidates)
        counts.set(workspace.id, (counts.get(workspace.id) ?? 0) + 1);
      const accepted = candidates.filter(({ workspace }) => counts.get(workspace.id) === 1);
      for (const { workspace, endpoint } of accepted) {
        const bound = endpoints.get(workspace.id);
        if (bound) bound.fullName = endpoint.fullName;
        else endpoints.set(workspace.id, endpoint);
      }
      await persist();
      return accepted.map(({ workspace }) => workspace);
    },
    content,
  };
}
