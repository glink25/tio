import { HostError, visibility, type TioObject } from '@tio/core';

export const navigationOrder = (a: TioObject, b: TioObject) =>
  (a.order ?? 0) - (b.order ?? 0) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

/** Stable depth-first navigation, independent of repository traversal order. */
export function navigationTree(objects: TioObject[]): TioObject[] {
  const visible = visibility(objects);
  const nodes = objects.filter((o) => ['page', 'database'].includes(o.type) && visible(o));
  const result: TioObject[] = [];
  const visit = (parent: string | null) => {
    for (const node of nodes.filter((o) => (o.parentId ?? null) === parent).sort(navigationOrder)) {
      result.push(node);
      visit(node.id);
    }
  };
  visit(null);
  return result;
}

export type NavigationMove = { id: string; parentId: string | null } & (
  | { type: 'place'; beforeId: string | null }
  | { type: 'move'; order: number }
);
/** The same structural projection works on navigation summaries and complete objects. */
export function projectNavigationMove(objects: TioObject[], intent: NavigationMove): TioObject[] {
  const source = objects.find((o) => o.id === intent.id && !o.deleted);
  if (!source || !['page', 'database'].includes(source.type)) throw new HostError('invalid');
  let parent = intent.parentId;
  const seen = new Set([source.id]);
  while (parent) {
    if (seen.has(parent)) throw new HostError('invalid', 'Cannot move into a descendant');
    seen.add(parent);
    const target = objects.find((o) => o.id === parent && !o.deleted);
    if (
      !target ||
      target.workspaceId !== source.workspaceId ||
      !['page', 'database'].includes(target.type)
    )
      throw new HostError('invalid');
    parent = target.parentId ?? null;
  }
  if (intent.type === 'move')
    return objects.map((o) =>
      o.id === source.id ? { ...o, parentId: intent.parentId, order: intent.order } : o,
    );
  if (intent.beforeId === source.id) return objects;
  const siblings = objects
    .filter(
      (o) =>
        o.id !== source.id &&
        !o.deleted &&
        o.workspaceId === source.workspaceId &&
        ['page', 'database'].includes(o.type) &&
        (o.parentId ?? null) === intent.parentId,
    )
    .sort(navigationOrder);
  const index =
    intent.beforeId === null
      ? siblings.length
      : siblings.findIndex((o) => o.id === intent.beforeId);
  if (index < 0) throw new HostError('conflict');
  siblings.splice(index, 0, source);
  const orders = new Map(siblings.map((o, order) => [o.id, order]));
  return objects.map((o) =>
    orders.has(o.id)
      ? {
          ...o,
          order: orders.get(o.id)!,
          ...(o.id === source.id ? { parentId: intent.parentId } : {}),
        }
      : o,
  );
}
