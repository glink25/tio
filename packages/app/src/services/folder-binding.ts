import { AutomationRunner } from '@tio/automation';
import { HostError, type Connection, type TioObject, type ConnectionAdapter } from '@tio/core';
import { FileWorkspaceContent } from '@tio/file-storage';
import { t } from '@tio/i18n';
import type { FileStorageProvider } from '@tio/storage';

import type { ReplicaStorage } from '../platform';
import type { ConnectionBinding } from './connection-adapters';
import { createReplica, replicaSyncStore } from './replica';
export function folderBinding(
  connection: Connection,
  host: {
    adapter: ConnectionAdapter;
    provider?: FileStorageProvider & { workspaceIds(): Promise<string[]> };
    Replica: new (instance: string, workspace: string) => ReplicaStorage;
    remove(workspace: string, instance: string): Promise<void>;
  },
): ConnectionBinding {
  let disposed = false;
  const contents = new Map<string, FileWorkspaceContent>();
  const content = (workspace: string) => {
    if (!host.provider) return undefined;
    let remote = contents.get(workspace);
    if (!remote) {
      remote = new FileWorkspaceContent(host.provider, workspace);
      contents.set(workspace, remote);
    }
    return remote;
  };
  const Replica = createReplica(host.Replica, content, () => !disposed);
  const replicas = new Map<string, InstanceType<typeof Replica>>();
  return {
    dispose() {
      disposed = true;
      contents.clear();
      replicas.clear();
    },
    isContentReady: (workspace) => replicas.get(workspace)?.complete ?? false,
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
        execute: () => host.remove(workspace, connection.id + '_' + workspace),
      },
    }),
    automation: (runtime, workspace) => new AutomationRunner(runtime, workspace),
    repository(workspace, instance) {
      const replica = new Replica(instance, workspace);
      replicas.set(workspace, replica);
      return replica;
    },
    sync(workspace, repository) {
      const remote = content(workspace);
      if (!remote) return undefined;
      const replica = replicas.get(workspace);
      if (!replica) throw new HostError('unavailable');
      return {
        store: replicaSyncStore(repository as InstanceType<typeof Replica>),
        content: remote,
        endpoint: replica.instanceId,
        pollMs: 60000,
        initialization: {
          isComplete: () => replica.isComplete(),
          complete: () => replica.markComplete(),
        },
      };
    },
    async discover() {
      const workspaces: TioObject[] = [];
      let deferred: HostError | undefined;
      for (const workspace of (await host.provider?.workspaceIds()) ?? []) {
        let object: TioObject | undefined;
        try {
          object = await content(workspace)?.read(workspace);
        } catch (error) {
          if (!(error instanceof HostError) || !['pending', 'conflict'].includes(error.code))
            throw error;
          deferred ??= error;
        }
        if (object?.type === 'workspace') workspaces.push(object);
      }
      if (!workspaces.length && deferred) throw deferred;
      return workspaces;
    },
    content,
  };
}
