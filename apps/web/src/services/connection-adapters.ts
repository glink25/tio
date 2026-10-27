import { FolderConnectionAdapter } from '@tio/adapter-local-folder';
import {
  connectionError,
  type Connection,
  type ConnectionIdentity,
  type ConnectionAdapter,
  type TioObject,
} from '@tio/core';
import type { WorkspaceContentPort } from '@tio/core';
import type { WorkspaceRepository } from '@tio/core';
import { WorkerSearch } from '@tio/database/search-browser';
import { FileWorkspaceContent, FileRepository, type FileJournalState } from '@tio/file-storage';
import { t } from '@tio/i18n';
import { LocalStore, RecoveryJournal } from '@tio/local-store';
import { LocalFolderProvider } from '@tio/provider-local-folder';

import { githubBinding } from './github-binding';
export interface ConnectionBinding {
  dispose?(): void;
  identity: ConnectionIdentity;
  adapter: ConnectionAdapter;
  repository(workspaceId: string, instanceId: string): WorkspaceRepository & { close(): void };
  discover(): Promise<TioObject[]>;
  create?(workspaceId: string): Promise<void>;
  sync?(
    workspaceId: string,
    repository: WorkspaceRepository,
  ): {
    store: import('@tio/core').SyncRepository;
    content: WorkspaceContentPort;
    endpoint: string;
    pollMs?: number;
    onComplete?: () => void;
  };
  content(workspaceId: string): WorkspaceContentPort | undefined;
}
export type ConnectionFactory = (
  connection: Connection,
  handle?: FileSystemDirectoryHandle,
) => ConnectionBinding;
function searchable<T extends WorkspaceRepository & { close(): void }>(repository: T): T {
  const search = new WorkerSearch(repository);
  repository.search = (query) => search.search(query);
  const close = repository.close.bind(repository);
  repository.close = () => {
    search.close();
    close();
  };
  return repository;
}
export const createConnectionBinding: ConnectionFactory = (connection, handle) => {
  if (connection.kind === 'github') return githubBinding(connection);
  if (connection.kind === 'device')
    return {
      identity: {
        provider: 'local',
        get name() {
          return t('welcome.offline');
        },
        icon: 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="gray" stroke-width="2"%3E%3Crect x="3" y="5" width="18" height="14" rx="2"/%3E%3Cpath d="M3 14h18m-5 3h2"/%3E%3C/svg%3E',
        details: [],
        localOnly: true,
      },
      adapter: {
        supportsSync: false,
        getAccessState: async () => ({ code: 'available', scope: { connectionId: connection.id } }),
        subscribe: () => () => {},
        classifyError: (error) => connectionError(error, connection.id),
      },
      repository: (_workspaceId, instanceId) => searchable(new LocalStore(instanceId)),
      discover: async () => [],
      content: () => {
        throw new Error('Device connection has no remote endpoint');
      },
    };
  const adapter = new FolderConnectionAdapter(connection.id, handle);
  const provider = handle && new LocalFolderProvider(handle);
  return {
    identity: {
      provider: 'local',
      name: connection.name,
      icon: 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="gray" stroke-width="2"%3E%3Cpath d="M3 7V5h6l2 2h10v13H3z"/%3E%3C/svg%3E',
      get details() {
        return [{ label: t('workspace.folderMode'), value: connection.name }];
      },
    },
    adapter,
    repository(workspaceId, instanceId) {
      if (!provider) throw new Error('Folder unavailable');
      const journal = new RecoveryJournal<FileJournalState>(instanceId);
      const repository = new FileRepository(
        new FileWorkspaceContent(provider, workspaceId),
        workspaceId,
        journal,
        (work) => (navigator.locks ? navigator.locks.request('tio-' + instanceId, work) : work()),
      );
      const close = repository.close.bind(repository);
      repository.close = () => {
        close();
        journal.close();
      };
      return searchable(repository);
    },
    async discover() {
      if (!provider) return [];
      const workspaces: TioObject[] = [];
      for (const file of await provider.list('workspaces/')) {
        const match = /^workspaces\/([a-zA-Z0-9_-]+)\/objects\/([a-zA-Z0-9_-]+)\.json$/.exec(
          file.path,
        );
        if (!match || match[1] !== match[2]) continue;
        const workspace = await new FileWorkspaceContent(provider, match[1]).read(match[2]);
        if (workspace?.type === 'workspace') workspaces.push(workspace);
      }
      return workspaces;
    },
    content: (workspaceId) => {
      if (!provider) return undefined;
      return new FileWorkspaceContent(provider, workspaceId);
    },
  };
};
