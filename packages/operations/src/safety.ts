import type { TioObject, Block } from '@tio/core';
export interface OperationChange {
  before: TioObject[];
  after: TioObject[];
  reasons: string[];
}
export type ApproveOperation = (change: OperationChange) => Promise<boolean>;
export function publicObject(object: TioObject): TioObject {
  const result = structuredClone(object);
  // Workspace AI settings are host-only, including custom headers/parameters and prompts.
  delete result.assistant;
  return result;
}
const flatten = (blocks: Block[]): Block[] => blocks.flatMap((b) => [b, ...flatten(b.children)]);
function assets(value: unknown): string[] {
  if (typeof value === 'string') return value.startsWith('asset:') ? [value] : [];
  if (Array.isArray(value)) return value.flatMap(assets);
  if (value && typeof value === 'object') return Object.values(value).flatMap(assets);
  return [];
}
/** Classify actual changes, including deletes hidden inside replacement payloads. */
export function operationChange(before: TioObject[], after: TioObject[]): OperationChange {
  const reasons = new Set<string>();
  for (const next of after) {
    const old = before.find((o) => o.id === next.id);
    if (next.type === 'automation' && next.enabled && !old?.enabled)
      reasons.add('automation.enable');
    if (!old) continue;
    if (next.deleted && !old.deleted) reasons.add('content.delete');
    const blocks = new Set(flatten(next.blocks ?? []).map((b) => b.id));
    if (flatten(old.blocks ?? []).some((b) => !blocks.has(b.id))) reasons.add('blocks.delete');
    if (old.fields?.some((f) => !next.fields?.some((n) => n.id === f.id)))
      reasons.add('fields.delete');
    const refs = new Set(assets(next));
    if (assets(old).some((ref) => !refs.has(ref))) reasons.add('assets.remove');
  }
  return {
    before: before.map(publicObject),
    after: after.map(publicObject),
    reasons: [...reasons],
  };
}
