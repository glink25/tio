import { FolderConnectionAdapter } from '@tio/adapter-local-folder';
import {
  connectionError,
  type Connection,
  type ConnectionAdapter,
  type TioObject,
} from '@tio/core';
import type { WorkspaceContentPort } from '@tio/core';
import type { WorkspaceRepository } from '@tio/core';
import { WorkerSearch } from '@tio/database/search-browser';
import { FileWorkspaceContent, FileRepository, type FileJournalState } from '@tio/file-storage';
import { LocalStore, RecoveryJournal } from '@tio/local-store';
import { LocalFolderProvider } from '@tio/provider-local-folder';

import { githubBinding } from './github-binding';
export interface ConnectionBinding {
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
