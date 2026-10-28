import type { Block, TioObject } from './index';

export interface MentionReference {
  workspaceId: string;
  kind: 'page' | 'database';
  id: string;
}
export function isMentionReference(value: unknown): value is MentionReference {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const v = value as MentionReference;
  return (
    ['page', 'database'].includes(v.kind) &&
    typeof v.workspaceId === 'string' &&
    /^[a-zA-Z0-9_-]+$/.test(v.workspaceId) &&
    typeof v.id === 'string' &&
    /^[a-zA-Z0-9_-]+$/.test(v.id) &&
    Object.keys(v).every((k) => ['workspaceId', 'kind', 'id'].includes(k))
  );
}
export const mentionKey = (ref: MentionReference) =>
  JSON.stringify([ref.workspaceId, ref.kind, ref.id]);
/** Read references from a scalar or array value; validation remains the field registry's job. */
export function mentionReferences(value: unknown): MentionReference[] {
  return (Array.isArray(value) ? value : [value]).filter(isMentionReference);
}
/** Traverse only content containers, never opaque properties or arbitrary extension payloads. */
export function contentMentions(content: unknown): MentionReference[] {
  if (Array.isArray(content)) return content.flatMap(contentMentions);
  if (!content || typeof content !== 'object') return [];
  const node = content as Record<string, unknown>;
  if (node.type === 'mention') {
    if (!isMentionReference(node.props)) throw new Error('Invalid mention');
    return [node.props];
  }
  return ['content', 'rows', 'cells'].flatMap((key) => contentMentions(node[key]));
}
export function blockMentions(blocks: Block[]): MentionReference[] {
  return blocks.flatMap((b) => [...contentMentions(b.content), ...blockMentions(b.children)]);
}
export function mentionTitle(ref: MentionReference, objects: TioObject[]): string | undefined {
  const target = objects.find(
    (o) =>
      o.id === ref.id && o.workspaceId === ref.workspaceId && o.type === ref.kind && !o.deleted,
  );
  return target ? target.title || target.name || 'Untitled' : undefined;
}
export type MentionResolution =
  | { reference: MentionReference; status: 'ready'; title: string }
  | { reference: MentionReference; status: 'deleted' | 'missing' | 'denied' | 'error' };
export interface MentionService {
  query(
    text: string,
    after?: string,
  ): Promise<{ items: { reference: MentionReference; title: string }[]; next?: string }>;
  resolve(references: MentionReference[]): Promise<MentionResolution[]>;
  subscribe(listener: () => void): () => void;
  navigate(reference: MentionReference): void;
}
