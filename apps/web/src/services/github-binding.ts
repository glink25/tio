import { GitHubAdapter } from '@tio/adapter-github';
import type { Connection, TioObject, SearchQuery, PageQuery } from '@tio/core';
import { WorkerSearch } from '@tio/database/search-browser';
import { FileWorkspaceContent } from '@tio/file-storage';
import { LocalStore } from '@tio/local-store';
import {
  GitHubClient,
  GitHubProvider,
  GitHubError,
  type GitHubEndpoint,
} from '@tio/provider-github';

import type { ConnectionBinding } from './connection-adapters';
import { accessToken, credentials, loginGitHub } from './github-auth';

export function githubBinding(connection: Connection): ConnectionBinding {
  const storageKey = `tio.github.endpoints.${connection.id}`;
  const endpoints = new Map<string, GitHubEndpoint>(
    JSON.parse(localStorage.getItem(storageKey) ?? '[]'),
  );
  const persist = () => localStorage.setItem(storageKey, JSON.stringify([...endpoints]));
  const userId = Number(connection.id.replace('github-', ''));
  const client = new GitHubClient(() => {
    if (credentials()?.userId !== userId)
      throw new GitHubError(401, 'GitHub account does not match this workspace');
    return accessToken();
  });
  const adapter = new GitHubAdapter(
    connection.id,
    userId,
    client,
    () => credentials()?.mode ?? 'app',
    endpoints,
    async () => {
      await loginGitHub(userId);
      return 'cancelled';
    },
  );
  const contents = new Map<string, FileWorkspaceContent>();
  const content = (workspaceId: string) => {
    let value = contents.get(workspaceId);
    if (!value) {
      const endpoint = endpoints.get(workspaceId);
      if (!endpoint) throw new Error('GitHub workspace is not bound');
      value = new FileWorkspaceContent(new GitHubProvider(client, endpoint), workspaceId);
      contents.set(workspaceId, value);
    }
    return value;
  };
  class Replica extends LocalStore {
    private completeKey: string;
    constructor(
      instanceId: string,
      readonly workspaceId: string,
    ) {
      const endpoint = endpoints.get(workspaceId);
      if (!endpoint) throw new Error('GitHub workspace is not bound');
      super(`${instanceId}/${endpoint.repositoryId}/${endpoint.branch}`);
      this.remoteAssets = true;
      this.storageCapabilities.prefetch = 'all';
      this.completeKey = `tio.github.complete.${this.instanceId}`;
    }
    markComplete() {
      localStorage.setItem(this.completeKey, 'true');
    }
    private requireComplete() {
      if (!localStorage.getItem(this.completeKey))
        throw new Error('工作空间仍在下载，请同步完成后重试');
    }
    private workerSearch: WorkerSearch = new WorkerSearch(this);
    search(query: SearchQuery): Promise<import('@tio/core').SearchPage> {
      this.requireComplete();
      return this.workerSearch.search(query);
    }
    override close() {
      this.workerSearch.close();
      super.close();
    }
    cachedAsset(id: string) {
      return super.readAsset(id);
    }
    override scan(query: PageQuery) {
      this.requireComplete();
      return super.scan(query);
    }
    override async readAsset(id: string) {
      const cached = await super.readAsset(id);
      if (cached) return cached;
      const entry = await this.get(id);
      if (!entry || entry.object.deleted) return undefined;
      const bytes = await content(this.workspaceId).readAsset(entry.object);
      if (!bytes) throw new Error('Remote attachment is missing');
      const asset = {
        name: entry.object.filename ?? '',
        mime: entry.object.mime ?? 'application/octet-stream',
        bytes,
      };
      await this.cacheAsset(id, asset);
      return asset;
    }
  }
  const replicas = new Map<string, Replica>();
  return {
    adapter,
    repository: (workspaceId, instanceId) => {
      const store = new Replica(instanceId, workspaceId);
      replicas.set(workspaceId, store);
      return store;
    },
    sync: (workspaceId, repository) => ({
      store: new Proxy(repository as Replica, {
        get(target, key) {
          if (key === 'readAsset') return target.cachedAsset.bind(target);
          const value = Reflect.get(target, key);
          return typeof value === 'function' ? value.bind(target) : value;
        },
      }),
      content: content(workspaceId),
      endpoint: `${userId}/${endpoints.get(workspaceId)!.repositoryId}/${endpoints.get(workspaceId)!.branch}/${workspaceId}`,
      pollMs: 60000,
      onComplete: () => replicas.get(workspaceId)?.markComplete(),
    }),
    async create(workspaceId) {
      await adapter.create(workspaceId);
      persist();
    },
    async discover() {
      const found = await adapter.discover();
      persist();
      const objects: TioObject[] = [];
      for (const item of found) {
        if (item.problem) continue;
        if (!item.workspaceId) continue;
        const workspace = await content(item.workspaceId).read(item.workspaceId);
        if (workspace?.type === 'workspace') objects.push(workspace);
      }
      return objects;
    },
    content,
  };
}
