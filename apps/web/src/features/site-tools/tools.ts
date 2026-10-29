import {
  WorkspaceOperations,
  definition,
  definitions,
  errorResult,
  toolArguments,
  OperationError,
} from '@tio/operations';

import type { Grant, PermissionSession } from './permissions';
export interface SiteTool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  annotations: { readOnlyHint: boolean };
  execute: (input: Record<string, any>) => Promise<unknown>;
}
export interface SiteContext {
  registerTool: (tool: SiteTool) => Promise<void> | void;
  unregisterTool: (name: string) => Promise<void> | void;
}
const schema = (properties: Record<string, unknown>, required: string[] = []) => ({
  type: 'object',
  properties,
  required,
  additionalProperties: false,
});
export function createSiteTools(service: WorkspaceOperations, permissions: PermissionSession) {
  const invoke = async (level: Grant, work: (check: () => void) => Promise<unknown>) => {
    try {
      return await work(await permissions.authorize(level));
    } catch (error) {
      return { status: 'failed', error: errorResult(error) };
    }
  };
  const session = {
    sessionId: {
      type: 'string',
      description:
        'Current sessionId returned by tio_context; invalid after switching workspace or reloading.',
    },
  };
  const ensure = (input: Record<string, any>) => {
    if (input.sessionId !== service.sessionId) throw new OperationError('closed');
  };
  const tools: SiteTool[] = [
    {
      name: 'tio_context',
      description:
        'Get the current Tio workspace, sessionId and capabilities after permission. Use the same live page; do not access storage directly.',
      inputSchema: schema({}),
      annotations: { readOnlyHint: true },
      execute: () => invoke('read', (check) => service.invoke('context.get', {}, undefined, check)),
    },
    {
      name: 'tio_operations',
      description:
        'Discover Tio operations; supply operation to inspect its input/output schema. Native objects use stable IDs. Before writing read the object and its version; preserve unknown content. Writes require a stable requestId. If pending or timed out, query tio_result; never retry an uncertain create with a new ID.',
      inputSchema: schema({ operation: { type: 'string' } }),
      annotations: { readOnlyHint: true },
      execute: async (input) => ({
        operations: await service.describe(input.operation),
        session: 'Use tio_context for current sessionId',
        blockExample: {
          id: 'block_unique',
          type: 'paragraph',
          props: {},
          content: [{ type: 'text', text: 'Hello', styles: {} }],
          children: [],
        },
        automationSchema: {
          trigger: 'page.created/page.deleted with parentId; or record.* with databaseId',
          action: {
            id: 'step_unique',
            kind: 'record.create',
            databaseId: 'database_id',
            properties: { field_id: { kind: 'literal', value: 'Text' } },
          },
        },
        writeOperations: definitions.filter((d) => d.write).map((d) => d.name),
      }),
    },
    {
      name: 'tio_read',
      description:
        'Read/search/query Tio content through a discovered read operation. Requires current sessionId. Returned objects have opaque versions for edits. No cross-workspace access.',
      inputSchema: schema({ ...session, ...toolArguments }, ['sessionId', 'operation', 'input']),
      annotations: { readOnlyHint: true },
      execute: (input) =>
        invoke('read', (check) => {
          ensure(input);
          if (!definition(input.operation) || definition(input.operation)!.write)
            throw new OperationError('unsupported');
          return service.invoke(input.operation, input.input, undefined, check);
        }),
    },
    {
      name: 'tio_write',
      description:
        'Perform a discovered Tio business mutation, including soft deletion, automation configuration, or App Slice code edits. Saves through the live runtime and undo history. Requires edit permission, current sessionId, requestId and read version for updates. Each call is separate; automatic rules may run after confirmation.',
      inputSchema: schema({ ...session, ...toolArguments, requestId: { type: 'string' } }, [
        'sessionId',
        'operation',
        'input',
        'requestId',
      ]),
      annotations: { readOnlyHint: false },
      execute: (input) =>
        invoke('edit', (check) => {
          ensure(input);
          if (!definition(input.operation)?.write) throw new OperationError('unsupported');
          return service.invoke(input.operation, input.input, input.requestId, check);
        }),
    },
    {
      name: 'tio_result',
      description:
        'Query a previous write request in the current session. A completed write confirms local provider persistence; remote sync and automation runs are separate. Refresh invalidates the session; re-read content after refresh.',
      inputSchema: schema({ ...session, requestId: { type: 'string' } }, [
        'sessionId',
        'requestId',
      ]),
      annotations: { readOnlyHint: true },
      execute: (input) =>
        invoke('read', (check) => {
          ensure(input);
          return service.result(input.requestId, check);
        }),
    },
  ];
  return tools;
}
let registrationTail: Promise<unknown> = Promise.resolve();
export function registerSiteTools(context: SiteContext, tools: SiteTool[]) {
  let closed = false;
  const registered: string[] = [];
  const ready = registrationTail.then(async () => {
    for (const tool of tools) {
      if (closed) break;
      await context.registerTool(tool);
      registered.push(tool.name);
    }
  });
  registrationTail = ready.catch(() => undefined);
  return {
    ready,
    dispose() {
      closed = true;
      registrationTail = registrationTail
        .then(async () => {
          for (const name of registered) await context.unregisterTool(name);
        })
        .catch(() => undefined);
    },
  };
}
