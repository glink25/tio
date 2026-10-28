import { visibility, valueText, type Block, type TioObject } from './index';

export type MentionReference = {
  workspaceId: string;
  id: string;
} & ({ kind: 'page' | 'database' | 'record' } | { kind: 'github-user'; login: string });
export interface MentionCandidate {
  reference: MentionReference;
  title: string;
  description?: string;
}
export interface MentionPage {
  items: MentionCandidate[];
  next?: string;
  sourceErrors?: ('github' | 'content')[];
}
export interface MentionQuery {
  text: string;
  after?: string;
  limit: number;
}
export function githubMentionUrl(ref: MentionReference): string | undefined {
  return ref.kind === 'github-user'
    ? `https://github.com/${encodeURIComponent(ref.login)}`
    : undefined;
}
export function recordTitle(record: TioObject, objects: TioObject[]): string {
  const database = objects.find(
    (o) =>
      o.id === record.databaseId && o.workspaceId === record.workspaceId && o.type === 'database',
  );
  const field = database?.fields?.find((f) => f.type === 'title');
  return record.title || (field && valueText(record.properties?.[field.id])) || 'Untitled';
}

export function isMentionReference(value: unknown): value is MentionReference {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const v = value as MentionReference;
  return (
    ['page', 'database', 'record', 'github-user'].includes(v.kind) &&
    typeof v.workspaceId === 'string' &&
    /^[a-zA-Z0-9_-]+$/.test(v.workspaceId) &&
    typeof v.id === 'string' &&
    /^[a-zA-Z0-9_-]+$/.test(v.id) &&
    (v.kind !== 'github-user' ||
      (/^[0-9]+$/.test(v.id) &&
        typeof v.login === 'string' &&
        /^[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,38})$/.test(v.login))) &&
    Object.keys(v).every((k) =>
      ['workspaceId', 'kind', 'id', ...(v.kind === 'github-user' ? ['login'] : [])].includes(k),
    )
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
  if (ref.kind === 'github-user') return `@${ref.login}`;
  const target = objects.find(
    (o) =>
      o.id === ref.id && o.workspaceId === ref.workspaceId && o.type === ref.kind && !o.deleted,
  );
  return target && visibility(objects)(target)
    ? target.type === 'record'
      ? recordTitle(target, objects)
      : target.title || target.name || 'Untitled'
    : undefined;
}
export type MentionResolution =
  | { reference: MentionReference; status: 'ready'; title: string }
  | { reference: MentionReference; status: 'deleted' | 'missing' | 'denied' | 'error' };
export interface MentionService {
  query(text: string, after?: string): Promise<MentionPage>;
  resolve(references: MentionReference[]): Promise<MentionResolution[]>;
  subscribe(listener: () => void): () => void;
  navigate(reference: MentionReference): void;
}
