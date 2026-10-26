import { FolderConnectionAdapter } from '@tio/adapter-local-folder';
import {
  connectionError,
  type Connection,
  type ConnectionAdapter,
  type TioObject,
} from '@tio/core';
import type { WorkspaceContentPort } from '@tio/core';
import { FileWorkspaceContent } from '@tio/file-storage';
import { LocalFolderProvider } from '@tio/provider-local-folder';
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
