import { HostError, id, object, type Block, type Field, type TioObject } from '@tio/core';

export const flatten = (blocks: Block[]): Block[] =>
  blocks.flatMap((b) => [b, ...flatten(b.children)]);
export function updateBlock(blocks: Block[], blockId: string, changes?: Partial<Block>): Block[] {
  if (!flatten(blocks).some((b) => b.id === blockId)) throw new HostError('unavailable');
  return blocks.flatMap((b) =>
    b.id === blockId
      ? changes
        ? [{ ...b, ...changes, id: b.id, props: { ...b.props, ...changes.props } }]
        : []
      : [{ ...b, children: updateChildren(b.children) }],
  );
  function updateChildren(children: Block[]): Block[] {
    return children.flatMap((b) =>
      b.id === blockId
        ? changes
          ? [{ ...b, ...changes, id: b.id, props: { ...b.props, ...changes.props } }]
          : []
        : [{ ...b, children: updateChildren(b.children) }],
    );
  }
}
export function changeFields(
  database: TioObject,
  method: string,
  input: { field?: Field; id?: string; changes?: Partial<Field> },
): Field[] {
  const fields = database.fields ?? [];
  if (method === 'fields.create')
    return [...fields, { ...input.field!, id: input.field?.id ?? id('field') }];
  const old = fields.find((f) => f.id === input.id);
  if (!old) throw new HostError('unavailable');
  if (method === 'fields.delete') return fields.filter((f) => f.id !== old.id);
  if (method !== 'fields.update') throw new HostError('invalid');
  if (
    (input.changes?.type && input.changes.type !== old.type) ||
    (['relation', 'mention'].includes(old.type) &&
      input.changes?.multiple !== undefined &&
      (input.changes.multiple !== false) !== (old.multiple !== false))
  )
    throw new HostError('unsupported');
  return fields.map((f) => (f.id === old.id ? { ...f, ...input.changes, id: f.id } : f));
}
export function createDatabase(
  workspaceId: string,
  name: string,
  fields?: Field[],
  parentId: string | null = null,
) {
  const database = object('database', workspaceId, {
    name,
    parentId,
    fields: fields ?? [{ id: id('field'), name: 'Name', type: 'title' }],
  });
  const view = object('databaseView', workspaceId, {
    databaseId: database.id,
    name: 'All',
    layout: 'table',
    visibleFieldIds: database.fields!.map((f) => f.id),
    filters: [],
    sorts: [],
  });
  return { database, view };
}
export function changeRecord(
  workspaceId: string,
  databaseId: string,
  properties: Record<string, unknown>,
  previous?: TioObject,
  deleted = false,
): TioObject {
  return previous
    ? {
        ...previous,
        ...(deleted
          ? { deleted: true }
          : { properties: { ...previous.properties, ...properties } }),
      }
    : object('record', workspaceId, { databaseId, properties, blocks: [] });
}
export const viewKeys = [
  'name',
  'layout',
  'filters',
  'sorts',
  'visibleFieldIds',
  'fieldOrder',
  'columnWidths',
  'groupBy',
] as const;
export function changeView(
  database: TioObject,
  changes: Partial<TioObject>,
  previous?: TioObject,
  deleted = false,
) {
  if (Object.keys(changes).some((key) => !(viewKeys as readonly string[]).includes(key)))
    throw new HostError('invalid');
  const next = previous
    ? { ...previous, ...changes, ...(deleted ? { deleted: true } : {}) }
    : object('databaseView', database.workspaceId, {
        name: 'View',
        layout: 'table',
        visibleFieldIds: database.fields?.map((f) => f.id) ?? [],
        filters: [],
        sorts: [],
        ...changes,
        databaseId: database.id,
      });
  if (next.groupBy === null) delete next.groupBy;
  return next;
}

/** Removing a field also removes its display/query references; record values remain intact. */
export function removeViewField(view: TioObject, fieldId: string): TioObject {
  const next = structuredClone(view);
  for (const key of ['visibleFieldIds', 'fieldOrder'] as const)
    if (next[key]) next[key] = next[key]!.filter((id) => id !== fieldId);
  if (next.filters) next.filters = next.filters.filter((f) => f.fieldId !== fieldId);
  if (next.sorts) next.sorts = next.sorts.filter((s) => s.fieldId !== fieldId);
  if (next.columnWidths) delete next.columnWidths[fieldId];
  if (next.groupBy === fieldId) delete next.groupBy;
  return next;
}
