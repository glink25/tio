import { AutomationRunner } from '@tio/automation';
import type { AutomationProvider } from '@tio/core';
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
import { t } from '@tio/i18n';
import type { WorkspaceRuntime } from '@tio/workspace';

import { platform, type FolderHandle } from '../platform';
import { githubBinding } from './github-binding';
export interface ConnectionBinding {
  isContentReady?(workspaceId: string): boolean;
  workspaceActions?(workspaceId: string): import('@tio/core').WorkspaceActions;
  mentionPeople?(workspaceId: string): Promise<import('@tio/core').MentionCandidate[]>;
  dispose?(): void;
  automation?(runtime: WorkspaceRuntime, workspaceId: string): AutomationProvider;
  identity: ConnectionIdentity;
  repositoryPollMs?: number;
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
    initialization: import('@tio/sync').ReplicaInitialization;
  };
  content(workspaceId: string): WorkspaceContentPort | undefined;
}
export type ConnectionFactory = (
  connection: Connection,
  handle?: FolderHandle,
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
  switch (connection.kind) {
    case 'github':
      return githubBinding(connection);
    case 'device':
      return {
        identity: {
          provider: 'local',
          get name() {
            return t(platform().deviceLabel);
          },
          icon: 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="gray" stroke-width="2"%3E%3Crect x="3" y="5" width="18" height="14" rx="2"/%3E%3Cpath d="M3 14h18m-5 3h2"/%3E%3C/svg%3E',
          details: [],
          localOnly: true,
        },
        adapter: {
          supportsSync: false,
          getAccessState: async () => ({
            code: 'available',
            scope: { connectionId: connection.id },
          }),
          subscribe: () => () => {},
          classifyError: (error) => connectionError(error, connection.id),
        },
        workspaceActions: (workspaceId) => ({
          delete: directDelete(t('workspace.deleteDevice'), () =>
            platform().deleteDevice(connection.id, workspaceId),
          ),
        }),
        automation: (runtime, workspaceId) => new AutomationRunner(runtime, workspaceId),
        repository: (workspaceId, instanceId) =>
          searchable(platform().deviceRepository(workspaceId, instanceId)),
        discover: async () => [],
        content: () => {
          throw new Error('Device connection has no remote endpoint');
        },
      };
    case 'folder': {
      const binding = platform().folder.binding(connection, handle);
      const repository = binding.repository.bind(binding);
      binding.repository = (workspace, instance) => searchable(repository(workspace, instance));
      return binding;
    }
  }
};

function directDelete(
  description: string,
  execute: () => Promise<void>,
): import('@tio/core').WorkspaceAction {
  return {
    kind: 'direct',
    title: t('workspace.delete'),
    description,
    confirmLabel: t('workspace.deletePermanently'),
    execute,
  };
}
