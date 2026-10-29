/** Stable, platform-independent content destination. URLs belong to the host. */
export type ContentAnchor = { type: 'block'; blockId: string } | { type: 'field'; fieldId: string };
export interface ContentTarget {
  workspaceId: string;
  kind: 'page' | 'database' | 'record';
  id: string;
  anchor?: ContentAnchor;
}
export function isContentAnchor(value: unknown): value is ContentAnchor {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const v = value as Record<string, unknown>;
  const key = v.type === 'block' ? 'blockId' : v.type === 'field' ? 'fieldId' : '';
  return (
    !!key &&
    typeof v[key] === 'string' &&
    /^[A-Za-z0-9_-]+$/.test(v[key]) &&
    Object.keys(v).every((k) => k === 'type' || k === key)
  );
}
export function isContentTarget(value: unknown): value is ContentTarget {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const v = value as ContentTarget;
  return (
    ['page', 'database', 'record'].includes(v.kind) &&
    [v.workspaceId, v.id].every((id) => typeof id === 'string' && /^[A-Za-z0-9_-]+$/.test(id)) &&
    (v.anchor === undefined ||
      (isContentAnchor(v.anchor) &&
        (v.anchor.type === 'field' ? v.kind === 'record' : v.kind !== 'database')))
  );
}
