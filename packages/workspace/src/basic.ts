import { editable, HostError, object, textBlock, type WorkspaceRepository } from '@tio/core';
import { validateValue } from '@tio/database';

import { WorkspaceRuntime } from './runtime';
export type BasicCommand = { version: 1; workspaceId: string } & (
  | { type: 'createPage'; id: string; title: string; parentId?: string | null }
  | { type: 'rename'; id: string; name: string }
  | { type: 'appendText'; id: string; blockId: string; text: string }
  | { type: 'createRecord'; id: string; databaseId: string; properties: Record<string, unknown> }
  | { type: 'setField'; id: string; fieldId: string; value: unknown }
);
/** Reference for small native writes. No editor, browser storage or rich-text engine required. */
export async function executeBasic(repository: WorkspaceRepository, command: BasicCommand) {
  if (command.version !== 1) throw new HostError('unsupported');
  const runtime = await WorkspaceRuntime.open(repository);
  try {
    await runtime.loadTarget(command.id);
    if (command.type === 'createRecord') await runtime.ensure([command.databaseId]);
    if (command.type === 'createPage' && command.parentId) await runtime.ensure([command.parentId]);
    const objects = runtime.snapshot();
    if (objects.some((o) => o.workspaceId !== command.workspaceId)) throw new HostError('invalid');
    const target = objects.find((o) => o.id === command.id);
    if (!['createPage', 'createRecord'].includes(command.type) && (!target || !editable(target)))
      throw new HostError('unsupported');
    switch (command.type) {
      case 'createPage': {
        if (
          command.parentId &&
          !objects.some((o) => o.id === command.parentId && o.type === 'page' && editable(o))
        )
          throw new HostError('invalid');
        runtime.create([
          object('page', command.workspaceId, {
            id: command.id,
            title: command.title,
            parentId: command.parentId ?? null,
            blocks: [],
          }),
        ]);
        break;
      }
      case 'rename':
        if (!['page', 'database', 'workspace'].includes(target!.type))
          throw new HostError('invalid');
        runtime.patch(
          command.id,
          target!.type === 'page' ? { title: command.name } : { name: command.name },
        );
        break;
      case 'appendText':
        if (!['page', 'record'].includes(target!.type)) throw new HostError('invalid');
        runtime.append(command.id, { ...textBlock(command.text), id: command.blockId });
        break;
      case 'createRecord': {
        const db = objects.find(
          (o) => o.id === command.databaseId && o.type === 'database' && editable(o),
        );
        if (!db) throw new HostError('invalid');
        for (const [id, value] of Object.entries(command.properties)) {
          const field = db.fields?.find((field) => field.id === id);
          if (!field) throw new HostError('invalid', 'Field unavailable');
          validateValue(field, value);
        }
        runtime.create([
          object('record', command.workspaceId, {
            id: command.id,
            databaseId: db.id,
            properties: command.properties,
            blocks: [],
          }),
        ]);
        break;
      }
      case 'setField':
        runtime.cell(command.id, command.fieldId, command.value);
        break;
    }
    await runtime.flush();
  } finally {
    runtime.dispose(true);
  }
}
