import { FolderConnectionAdapter } from '@tio/adapter-local-folder';
import {
  connectionError,
  type Connection,
  type ConnectionAdapter,
  type TioObject,
} from '@tio/core';
import { LocalFolderProvider } from '@tio/provider-local-folder';
import { decode } from '@tio/serialization';
import { FileWorkspaceContent, type WorkspaceContentPort } from '@tio/sync';
export interface ConnectionBinding {
  adapter: ConnectionAdapter;
  discover(): Promise<TioObject[]>;
  content(workspaceId: string): WorkspaceContentPort | undefined;
}
export type ConnectionFactory = (
  connection: Connection,
  handle?: FileSystemDirectoryHandle,
) => ConnectionBinding;
export const createConnectionBinding: ConnectionFactory = (connection, handle) => {
  if (connection.kind === 'device')
    return {
      adapter: {
        supportsSync: false,
        getAccessState: async () => ({ code: 'available', scope: { connectionId: connection.id } }),
        subscribe: () => () => {},
        classifyError: (error) => connectionError(error, connection.id),
      },
      discover: async () => [],
      content: () => {
        throw new Error('Device connection has no remote endpoint');
      },
    };
  const adapter = new FolderConnectionAdapter(connection.id, handle);
  const provider = handle && new LocalFolderProvider(handle);
  return {
    adapter,
    async discover() {
      if (!provider) return [];
      const workspaces: TioObject[] = [];
      for (const file of await provider.list('workspaces/')) {
        if (!/^workspaces\/[a-zA-Z0-9_-]+\/workspace\.json$/.test(file.path)) continue;
        const bytes = await provider.read(file.path);
        if (!bytes) continue;
        const workspace = decode(bytes);
        if (
          workspace.type === 'workspace' &&
          file.path === `workspaces/${workspace.id}/workspace.json`
        )
          workspaces.push(workspace);
      }
      return workspaces;
    },
    content: (workspaceId) => {
      if (!provider) return undefined;
      return new FileWorkspaceContent(provider, workspaceId);
    },
  };
};
