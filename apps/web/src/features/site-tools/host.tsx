import { WorkspaceOperations } from '@tio/operations';
import { useEffect, useRef } from 'react';

import type { WorkspaceController } from '../workspace/use-workspace';
import { AgentPermissionDialog } from './permission-ui';
import { PermissionSession } from './permissions';
import { createSiteTools, registerSiteTools, type SiteContext } from './tools';
export function SiteToolsHost({ model: m }: { model: WorkspaceController }) {
  const current = useRef(m);
  current.current = m;
  const runtime = m.runtime,
    connection = m.connection,
    session = m.session;
  useEffect(() => {
    const connection = current.current.connection;
    const session = current.current.session;
    const context = (document as Document & { modelContext?: SiteContext }).modelContext;
    if (!context?.registerTool || !runtime || !connection || !session || m.openingWorkspace) return;
    const permissions = new PermissionSession({
      key: JSON.stringify([connection.id, session.workspaceId]),
      workspace: session.name,
      connection: connection.name,
    });
    const service = new WorkspaceOperations({
      runtime,
      isActive: () =>
        current.current.runtime === runtime &&
        current.current.session?.id === session.id &&
        !current.current.openingWorkspace,
      workspaceId: session.workspaceId,
      context: () => ({ selectedId: current.current.selected, connectionKind: connection.kind }),
      describeContent: async () => {
        const { operationContentSchema } = await import('@tio/editor-blocknote');
        return operationContentSchema();
      },
      validateBlocks: async (before, after) => {
        const { validateOperationBlocks } = await import('@tio/editor-blocknote');
        validateOperationBlocks(before, after);
      },
    });
    const registration = registerSiteTools(context, createSiteTools(service, permissions));
    void registration.ready.catch(() => {
      service.dispose();
      permissions.dispose();
      registration.dispose();
    });
    return () => {
      service.dispose();
      permissions.dispose();
      registration.dispose();
    };
  }, [runtime, connection?.id, session?.id, m.openingWorkspace]);
  return <AgentPermissionDialog />;
}
