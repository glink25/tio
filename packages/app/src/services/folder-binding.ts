import { AutomationRunner } from '@tio/automation';
import type { Connection, TioObject, WorkspaceRepository, ConnectionAdapter } from '@tio/core';
import { FileWorkspaceContent } from '@tio/file-storage';
import { t } from '@tio/i18n';
import type { FileStorageProvider } from '@tio/storage';

import type { ConnectionBinding } from './connection-adapters';
export function folderBinding(
  connection: Connection,
  host: {
    adapter: ConnectionAdapter;
    provider?: FileStorageProvider & { workspaceIds(): Promise<string[]> };
    repository(workspace: string, instance: string): WorkspaceRepository & { close(): void };
    remove(workspace: string): Promise<void>;
  },
): ConnectionBinding {
  return {
    identity: {
      provider: 'local',
      name: connection.name,
      icon: 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="gray" stroke-width="2"%3E%3Cpath d="M3 7V5h6l2 2h10v13H3z"/%3E%3C/svg%3E',
      get details() {
        return [{ label: t('workspace.folderMode'), value: connection.name }];
      },
    },
    adapter: host.adapter,
    workspaceActions: (workspace) => ({
      delete: {
        kind: 'direct',
        title: t('workspace.delete'),
        description: t('workspace.deleteFolder', { path: `workspaces/${workspace}/` }),
        confirmLabel: t('workspace.deletePermanently'),
        execute: () => host.remove(workspace),
      },
    }),
    automation: (runtime, workspace) => new AutomationRunner(runtime, workspace),
    repository: (workspace, instance) => host.repository(workspace, instance),
    async discover() {
      const workspaces: TioObject[] = [];
      for (const workspace of (await host.provider?.workspaceIds()) ?? []) {
        const object = await new FileWorkspaceContent(host.provider!, workspace).read(workspace);
        if (object?.type === 'workspace') workspaces.push(object);
      }
      return workspaces;
    },
    content: (workspace) =>
      host.provider ? new FileWorkspaceContent(host.provider, workspace) : undefined,
  };
}
