import {
  type Tool,
  type ToolContext,
  type History,
  type ChangeProposal,
  type ReferenceResolver,
} from '@glink25/chaty';
import { z } from '@glink25/chaty';
import { DiscoverTools } from '@glink25/chaty/host';
import { createPlaygroundTool, PlaygroundSkill } from '@glink25/chaty/playground';
import { HostError, readableObject, type AssetData } from '@tio/core';
import { t } from '@tio/i18n';
import {
  WorkspaceOperations,
  definitions,
  errorResult,
  operationChange,
  type OperationChange,
} from '@tio/operations';
import { exportZip, exportMarkdownZip } from '@tio/serialization';

import { appSlicePermissions } from '../../services/app-slice-permissions';
import type { WorkspaceController } from '../workspace/use-workspace';
import { assistantScope, type AssistantReference } from './references';

const allFiles = (history: History) =>
  history.flatMap((m) => (m.role === 'user' ? (m.assets ?? []) : []));
export function createAssistantTools(
  current: () => WorkspaceController,
  runtime: NonNullable<WorkspaceController['runtime']>,
  sessionId: string,
) {
  const initial = current();
  const workspaceId = initial.session!.workspaceId;
  const connectionId = initial.connection!.id;
  let closed = false;
  const active = () =>
    !closed &&
    current().runtime === runtime &&
    current().session?.id === sessionId &&
    current().connection?.id === connectionId &&
    !current().openingWorkspace;
  const check = (ctx?: ToolContext) => {
    if (!active()) throw new HostError('closed');
    ctx?.signal?.throwIfAborted();
  };
  const service = new WorkspaceOperations({
    runtime,
    workspaceId,
    isActive: active,
    context: () => ({ selectedId: current().selected, connectionKind: current().connection?.kind }),
    describeContent: async () => (await import('@tio/editor-blocknote')).operationContentSchema(),
    validateBlocks: async (before, after) =>
      (await import('@tio/editor-blocknote')).validateOperationBlocks(before, after),
  });
  async function approve(change: OperationChange, ctx: ToolContext) {
    check(ctx);
    if (!ctx.approveChange) return false;
    const proposal: ChangeProposal = {
      id: crypto.randomUUID(),
      title: t('assistant.confirmChange'),
      canRemember: false,
      diffs: change.after.map((after) => ({
        target: after.id,
        before: change.before.find((o) => o.id === after.id),
        after,
      })),
    };
    const decision = await ctx.approveChange(proposal, ctx.signal);
    check(ctx);
    return decision.approved;
  }
  const tools: Tool[] = [];
  const register = (
    name: string,
    describe: string,
    schema: z.ZodType,
    effect: 'read' | 'write' | 'ui',
    handler: (args: any, ctx: ToolContext) => Promise<unknown>,
  ) => {
    const tool: Tool = {
      name,
      describe,
      argSchema: schema,
      returnSchema: z.unknown(),
      effect,
      exposure: { native: true, code: true },
      handler: async (args, ctx) => {
        try {
          check(ctx);
          if (ctx.surface && !tool.exposure?.[ctx.surface]) throw new HostError('permission');
          const result = await handler(schema.parse(args), ctx);
          check(ctx);
          return result;
        } catch (error) {
          return { status: 'failed', error: errorResult(error) };
        }
      },
    };
    tools.push(tool);
  };
  register(
    'tio_operations',
    'Discover workspace operations and full input/output schemas. Describe a block operation before constructing rich content.',
    z.object({ name: z.string().optional() }),
    'read',
    async (p) => service.describe(p.name),
  );
  for (const write of [false, true])
    register(
      write ? 'tio_write' : 'tio_read',
      write
        ? 'Execute a discovered workspace write. Supply a stable requestId and object version where required.'
        : 'Execute a discovered workspace read.',
      z.object({
        operation: z.enum(definitions.filter((d) => d.write === write).map((d) => d.name)),
        input: z.record(z.string(), z.json()),
        ...(write ? { requestId: z.string().min(1) } : {}),
      }),
      write ? 'write' : 'read',
      async (p, ctx) =>
        service.invoke(
          p.operation,
          p.input,
          p.requestId,
          () => check(ctx),
          (change) => approve(change, ctx),
          async (index) => {
            const file = allFiles(ctx.history)[index - 1];
            if (!file) throw new HostError('unavailable');
            return {
              name: file.name,
              mime: file.type,
              bytes: new Uint8Array(await file.arrayBuffer()),
            } satisfies AssetData;
          },
        ),
    );
  register(
    'tio_attachment',
    'Read a workspace attachment as text or native image input. Use this native tool for images; upload conversation files with assets.upload.',
    z.object({ id: z.string() }),
    'read',
    async (p, ctx) => {
      const result = await service.invoke('assets.read', p, undefined, () => check(ctx));
      if (result.status !== 'completed') return result;
      const data = result.value as { mimeType: string; bytes: number[] };
      if (['image/png', 'image/jpeg', 'image/webp', 'image/gif'].includes(data.mimeType))
        return {
          kind: 'toolImage',
          mimeType: data.mimeType,
          data: btoa(data.bytes.map((b) => String.fromCharCode(b)).join('')),
        };
      if (data.mimeType.startsWith('text/') || data.mimeType === 'application/json')
        return {
          text: new TextDecoder().decode(new Uint8Array(data.bytes)).slice(0, 100000),
          truncated: data.bytes.length > 100000,
        };
      return { status: 'failed', error: { code: 'unsupported' } };
    },
  );
  tools.at(-1)!.exposure = { native: true, code: false };
  register(
    'tio_result',
    'Query a pending write using its original stable requestId. Do not repeat uncertain writes with a new ID.',
    z.object({ requestId: z.string() }),
    'read',
    async (p, ctx) => service.result(p.requestId, () => check(ctx)),
  );
  register(
    'tio_host',
    'Workspace host actions: context, open, preview, favorite, graph, sync, export, undo, redo. No connection or workspace administration.',
    z.object({
      action: z.enum([
        'context',
        'open',
        'preview',
        'favorite',
        'graph',
        'sync',
        'export',
        'undo',
        'redo',
      ]),
      id: z.string().optional(),
      format: z.enum(['tio', 'markdown']).optional(),
    }),
    'ui',
    async (p, ctx) => {
      const m = current();
      if (p.action === 'context')
        return {
          selectedId: m.selected,
          favorites: m.session?.favorites ?? [],
          sync: m.syncStatus,
          hasReplicaSync: m.hasReplicaSync,
          writable: runtime.state.getState().writable,
          canUndo: runtime.state.getState().canUndo,
          canRedo: runtime.state.getState().canRedo,
        };
      if (['open', 'preview', 'favorite', 'graph'].includes(p.action)) {
        const result = await service.invoke('objects.get', { id: p.id }, undefined, () =>
          check(ctx),
        );
        if (result.status !== 'completed') return result;
        const object = (result.value as { object: import('@tio/core').TioObject }).object;
        if (!['page', 'database', 'record'].includes(object.type) || object.deleted)
          throw new HostError('invalid');
        if (p.action === 'open') await m.navigateTarget({ id: object.id });
        if (p.action === 'preview') m.setPreviewId(object.id);
        if (p.action === 'favorite') m.favorite(object);
        if (p.action === 'graph') await m.openGraph(object.id);
      } else if (p.action === 'sync') await m.syncWorkspace();
      else if (p.action === 'export') {
        const all = await runtime.exportObjects();
        const objects = all
          .filter((o) => o.workspaceId === workspaceId)
          .flatMap((o) => {
            const readable = readableObject(runtime.access, o);
            return readable ? [readable] : [];
          });
        check(ctx);
        const bytes = await (p.format === 'markdown' ? exportMarkdownZip : exportZip)(
          objects,
          async (id) => (await runtime.readAsset(id))?.bytes,
        );
        check(ctx);
        const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: 'application/zip' }));
        const a = document.createElement('a');
        a.href = url;
        a.download = `workspace.${p.format ?? 'tio'}.zip`;
        a.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
      } else {
        const preview = await runtime.previewHistory(p.action);
        check(ctx);
        if (
          preview.after.some(
            (next) =>
              next.type === 'workspace' &&
              JSON.stringify(next.assistant) !==
                JSON.stringify(preview.before.find((o) => o.id === next.id)?.assistant),
          )
        )
          throw new HostError('permission');
        const change = operationChange(preview.before, preview.after);
        if (change.reasons.length && !(await approve(change, ctx)))
          throw new HostError('permission');
        await preview.apply(() => check(ctx));
      }
      return { status: 'completed' };
    },
  );
  register(
    'tio_app_permission',
    'Read or change local App Slice permissions. Grants never exceed the host access policy.',
    z.object({
      id: z.string(),
      blockId: z.string(),
      permission: z
        .object({ data: z.enum(['read', 'readWrite']), allowExternalResources: z.boolean() })
        .optional(),
    }),
    'write',
    async (p, ctx) => {
      await runtime.ensure([p.id]);
      check(ctx);
      const page = runtime
        .snapshot()
        .find((o) => o.id === p.id && o.workspaceId === workspaceId && !o.deleted);
      const blocks = (items: import('@tio/core').Block[]): import('@tio/core').Block[] =>
        items.flatMap((b) => [b, ...blocks(b.children)]);
      if (
        !page ||
        !runtime.access.allows({ workspaceId, id: page.id, type: page.type }, 'read') ||
        !blocks(page.blocks ?? []).some((b) => b.id === p.blockId && b.type === 'appSlice')
      )
        throw new HostError('permission');
      const key = JSON.stringify(['browser-profile', workspaceId, page.id, p.blockId]);
      const previous = appSlicePermissions.get(key) ?? {
        data: 'read',
        allowExternalResources: false,
      };
      if (!p.permission) return previous;
      if (
        !runtime.state.getState().writable ||
        !runtime.access.allows({ workspaceId, id: page.id, type: page.type }, 'update')
      )
        throw new HostError('permission');
      if (
        (previous.data !== 'readWrite' && p.permission.data === 'readWrite') ||
        (!previous.allowExternalResources && p.permission.allowExternalResources)
      ) {
        const snapshot = JSON.stringify(page);
        if (
          !ctx.approveChange ||
          !(
            await ctx.approveChange(
              {
                id: crypto.randomUUID(),
                title: t('assistant.confirmPermission'),
                canRemember: false,
                diffs: [{ target: p.blockId, before: previous, after: p.permission }],
              },
              ctx.signal,
            )
          ).approved
        )
          throw new HostError('permission');
        check(ctx);
        if (
          JSON.stringify(runtime.snapshot().find((o) => o.id === page.id)) !== snapshot ||
          JSON.stringify(
            appSlicePermissions.get(key) ?? { data: 'read', allowExternalResources: false },
          ) !== JSON.stringify(previous)
        )
          throw new HostError('conflict');
      }
      check(ctx);
      if (
        !runtime.state.getState().writable ||
        !runtime.access.allows({ workspaceId, id: page.id, type: page.type }, 'update')
      )
        throw new HostError('permission');
      appSlicePermissions.set(key, p.permission);
      return p.permission;
    },
  );
  const resolveReferences: ReferenceResolver = async (references, signal) =>
    Promise.all(
      references.map(async (ref) => {
        check();
        signal?.throwIfAborted();
        const { hostScope } = ref;
        const displayRef = { type: ref.type, id: ref.id };
        const selection = (ref as Partial<AssistantReference>).selection;
        if (
          hostScope !== assistantScope(connectionId, workspaceId) ||
          ref.type !== 'tio.selection' ||
          !selection ||
          selection.workspaceId !== workspaceId ||
          typeof selection.objectId !== 'string' ||
          typeof selection.text !== 'string' ||
          !Array.isArray(selection.blockIds) ||
          !selection.blockIds.every((id) => typeof id === 'string')
        )
          return { ref: displayRef, status: 'forbidden' };
        const result = await service.invoke(
          'objects.get',
          { id: selection.objectId },
          undefined,
          () => {
            check();
            signal?.throwIfAborted();
          },
        );
        if (result.status !== 'completed')
          return {
            ref: displayRef,
            status:
              result.status === 'failed' && result.error.code === 'permission'
                ? 'forbidden'
                : 'unavailable',
          };
        const value = result.value as { object: import('@tio/core').TioObject; version: string };
        if (value.object.deleted) return { ref: displayRef, status: 'deleted' };
        return {
          ref: { ...displayRef, label: ref.label },
          status: 'ok',
          selection,
          source: {
            id: value.object.id,
            title: value.object.title ?? value.object.name,
            version: value.version,
          },
        };
      }),
    );
  const playground = createPlaygroundTool(() => ({
    finish: async () => ({ status: 'completed', transaction: false }),
    dispose() {},
  }));
  return {
    tools: [...tools, DiscoverTools as Tool, playground],
    skills: [PlaygroundSkill],
    resolveReferences,
    dispose: () => {
      closed = true;
      service.dispose();
    },
  };
}
