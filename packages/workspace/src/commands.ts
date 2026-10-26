import {
  createDomain,
  type Domain,
  HostError,
  type Block,
  type Field,
  type TioObject,
  type WorkspaceMutation,
} from '@tio/core';
import { merge, type MergeResult } from '@tio/merge';
const defaults = (): Domain => createDomain();
const editable = (o: TioObject, domain: Domain) => domain.objects.supports(o) && !o.deleted;
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
function update(
  objects: TioObject[],
  id: string,
  change: (current: TioObject) => TioObject,
  domain: Domain,
) {
  const current = objects.find((o) => o.id === id);
  if (!current) throw new Error(`Object unavailable: ${id}`);
  // External deletion/newer formats cannot be resurrected by a delayed local command.
  if (!editable(current, domain)) throw new Error('Object is not editable');
  const next = domain.objects.decode(change(current));
  if (
    next.id !== current.id ||
    next.workspaceId !== current.workspaceId ||
    next.type !== current.type ||
    next.schemaVersion !== current.schemaVersion
  )
    throw new Error('Commands cannot change object identity or schema version');
  return objects.map((o) => (o.id === id ? next : o));
}
export const patchObject =
  (id: string, changes: Partial<TioObject>, domain = defaults()): WorkspaceMutation =>
  (objects) =>
    update(objects, id, (o) => ({ ...o, ...changes }), domain);
export const createObjects =
  (items: TioObject[], domain = defaults()): WorkspaceMutation =>
  (objects) => {
    const ids = new Set(objects.map((o) => o.id));
    for (const item of items) {
      const existing = objects.find((o) => o.id === item.id);
      if (existing && !same(existing, item))
        throw new HostError('conflict', 'Object identity already exists');
    }
    return [
      ...objects,
      ...items.filter((o) => !ids.has(o.id)).map((item) => domain.objects.decode(item)),
    ];
  };
export const appendBlock =
  (id: string, block: Block, domain = defaults()): WorkspaceMutation =>
  (objects) =>
    update(
      objects,
      id,
      (o) => ({
        ...o,
        blocks: (o.blocks ?? []).some((b) => b.id === block.id)
          ? o.blocks
          : [...(o.blocks ?? []), block],
      }),
      domain,
    );
export const editBlocks =
  (
    id: string,
    next: Block[],
    previous: Block[],
    onMerge?: (result: MergeResult) => void,
    domain = defaults(),
  ): WorkspaceMutation =>
  (objects) =>
    update(
      objects,
      id,
      (o) => {
        const result = merge({ ...o, blocks: previous }, { ...o, blocks: next }, o, domain.objects);
        onMerge?.(result);
        return result.merged;
      },
      domain,
    );
export const editCell =
  (id: string, fieldId: string, value: unknown, domain = defaults()): WorkspaceMutation =>
  (objects) =>
    update(
      objects,
      id,
      (record) => {
        const db = objects.find((o) => o.id === record.databaseId);
        const field = db?.fields?.find((f) => f.id === fieldId);
        if (!db || !editable(db, domain) || !field) throw new Error('Field unavailable');
        domain.fields.validate(field, value);
        return { ...record, properties: { ...record.properties, [fieldId]: value } };
      },
      domain,
    );
export type FieldOperation =
  | { type: 'add'; field: Field }
  | { type: 'patch'; id: string; changes: Partial<Field> }
  | { type: 'remove'; id: string }
  | { type: 'reorder'; ids: string[] };
export const changeFields =
  (id: string, operations: FieldOperation[], domain = defaults()): WorkspaceMutation =>
  (objects) => {
    const added: string[] = [];
    return update(
      objects,
      id,
      (o) => {
        let fields = [...(o.fields ?? [])];
        for (const op of operations) {
          if (op.type === 'add') {
            if (!fields.some((f) => f.id === op.field.id)) {
              fields.push(op.field);
              added.push(op.field.id);
            }
          } else if (op.type === 'remove') fields = fields.filter((f) => f.id !== op.id);
          else if (op.type === 'patch') {
            if (!fields.some((f) => f.id === op.id)) throw new Error('Field unavailable');
            fields = fields.map((f) => (f.id === op.id ? { ...f, ...op.changes, id: f.id } : f));
          } else {
            const known = new Map(fields.map((f) => [f.id, f]));
            fields = [
              ...op.ids.flatMap((id) => (known.has(id) ? [known.get(id)!] : [])),
              ...fields.filter((f) => !op.ids.includes(f.id)),
            ];
          }
        }
        return { ...o, fields };
      },
      domain,
    ).map((o) =>
      o.type === 'databaseView' &&
      o.databaseId === id &&
      editable(o, domain) &&
      added.length &&
      o.visibleFieldIds?.length
        ? { ...o, visibleFieldIds: [...new Set([...o.visibleFieldIds!, ...added])] }
        : o,
    );
  };
export function fieldOperations(previous: Field[], next: Field[]): FieldOperation[] {
  const ops: FieldOperation[] = [];
  for (const field of next) {
    const old = previous.find((f) => f.id === field.id);
    if (!old) ops.push({ type: 'add', field });
    else {
      const changes = Object.fromEntries(
        Object.entries(field).filter(([k, v]) => k !== 'id' && !same(v, old[k])),
      );
      if (Object.keys(changes).length) ops.push({ type: 'patch', id: field.id, changes });
    }
  }
  for (const field of previous)
    if (!next.some((f) => f.id === field.id)) ops.push({ type: 'remove', id: field.id });
  if (
    !same(
      previous.map((f) => f.id),
      next.map((f) => f.id),
    )
  )
    ops.push({ type: 'reorder', ids: next.map((f) => f.id) });
  return ops;
}
export const editFields = (
  id: string,
  fields: Field[],
  previous: Field[] = [],
): WorkspaceMutation => changeFields(id, fieldOperations(previous, fields));
export const moveObject =
  (id: string, parentId: string | null, order: number, domain = defaults()): WorkspaceMutation =>
  (objects) => {
    let parent = parentId;
    const visited = new Set([id]);
    while (parent) {
      if (visited.has(parent)) throw new Error('不能移动到自身或子页面');
      visited.add(parent);
      const target = objects.find((o) => o.id === parent);
      if (!target || !editable(target, domain) || !['page', 'database'].includes(target.type))
        throw new Error('Parent unavailable');
      parent = target.parentId ?? null;
    }
    return patchObject(id, { parentId, order }, domain)(objects);
  };
export const compose =
  (...mutations: WorkspaceMutation[]): WorkspaceMutation =>
  (objects) =>
    mutations.reduce((state, apply) => apply(state), objects);
/** Undo only the command's changes; retain independently updated fields and unknown payloads. */
export function inverse(
  before: TioObject[],
  after: TioObject[],
  domain = defaults(),
): WorkspaceMutation {
  const originals = new Map(before.map((o) => [o.id, o]));
  const changed = after.filter((o) => !same(originals.get(o.id), o));
  return (objects) =>
    objects.map((current) => {
      const written = changed.find((o) => o.id === current.id);
      if (!written) return current;
      const original = originals.get(current.id);
      if (!original) return same(current, written) ? { ...current, deleted: true } : current;
      if (written.deleted && !original.deleted && current.deleted && same(current, written))
        return original;
      return merge(written, original, current, domain.objects).merged;
    });
}

/** Serializable editing intents; closures are implementation details of the executor only. */
export type WorkspaceCommand =
  | { type: 'checked'; expected: TioObject[]; changes: TioObject[] }
  | { type: 'undelete'; id: string }
  | { type: 'patch'; id: string; changes: Partial<TioObject> }
  | { type: 'create'; objects: TioObject[]; embed?: { pageId: string; block: Block } }
  | { type: 'append'; id: string; block: Block }
  | { type: 'blocks'; id: string; next: Block[]; previous: Block[] }
  | { type: 'cell'; id: string; fieldId: string; value: unknown }
  | { type: 'fields'; id: string; operations: FieldOperation[] }
  | { type: 'move'; id: string; parentId: string | null; order: number }
  | { type: 'restore'; before: TioObject[]; after: TioObject[] };
export function executeCommand(
  command: WorkspaceCommand,
  objects: TioObject[],
  onMerge?: (result: MergeResult) => void,
  domain = defaults(),
): TioObject[] {
  switch (command.type) {
    case 'checked': {
      for (const expected of command.expected)
        if (
          !same(
            objects.find((o) => o.id === expected.id),
            expected,
          )
        )
          throw new HostError('conflict');
      const expectedIds = new Set(command.expected.map((o) => o.id));
      for (const change of command.changes) {
        const old = objects.find((o) => o.id === change.id);
        if (old && !expectedIds.has(old.id)) throw new HostError('conflict');
        if (
          old &&
          (old.type !== change.type ||
            old.workspaceId !== change.workspaceId ||
            old.schemaVersion !== change.schemaVersion)
        )
          throw new HostError('invalid');
        domain.objects.decode(change);
      }
      const replacements = new Map(command.changes.map((o) => [o.id, o]));
      return [
        ...objects.map((o) => replacements.get(o.id) ?? o),
        ...command.changes.filter((o) => !objects.some((old) => old.id === o.id)),
      ];
    }
    case 'undelete': {
      const current = objects.find((o) => o.id === command.id);
      if (!current || !domain.objects.supports(current)) throw new Error('Object is not editable');
      return objects.map((o) =>
        o.id === command.id ? domain.objects.decode({ ...o, deleted: false }) : o,
      );
    }
    case 'patch':
      return patchObject(command.id, command.changes, domain)(objects);
    case 'create': {
      const next = createObjects(command.objects, domain)(objects);
      for (const item of command.objects) {
        if (item.type === 'record') {
          const db = next.find(
            (o) =>
              o.id === item.databaseId && o.workspaceId === item.workspaceId && editable(o, domain),
          );
          if (!db) throw new Error('Database unavailable');
          for (const [id, value] of Object.entries(item.properties ?? {})) {
            const field = db.fields?.find((f) => f.id === id);
            if (!field) throw new Error('Field unavailable');
            domain.fields.validate(field, value);
          }
        }
        if (
          item.parentId &&
          !next.some(
            (o) =>
              o.id === item.parentId && o.workspaceId === item.workspaceId && editable(o, domain),
          )
        )
          throw new Error('Parent unavailable');
      }
      return command.embed
        ? appendBlock(command.embed.pageId, command.embed.block, domain)(next)
        : next;
    }
    case 'append':
      return appendBlock(command.id, command.block, domain)(objects);
    case 'blocks':
      return editBlocks(command.id, command.next, command.previous, onMerge, domain)(objects);
    case 'cell':
      return editCell(command.id, command.fieldId, command.value, domain)(objects);
    case 'fields':
      return changeFields(command.id, command.operations, domain)(objects);
    case 'move':
      return moveObject(command.id, command.parentId, command.order, domain)(objects);
    case 'restore':
      return inverse(command.before, command.after, domain)(objects);
  }
}
