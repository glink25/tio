import {
  contentMentions,
  mentionReferences,
  recordTitle,
  visibility,
  type Block,
  type TioObject,
  type ContentTarget,
  type ReferenceOccurrence,
  type SearchHit,
} from '@tio/core';

const textBlocks = new Set([
  'paragraph',
  'heading',
  'bulletListItem',
  'numberedListItem',
  'checkListItem',
  'toggleListItem',
  'quote',
  'codeBlock',
  'table',
]);

/** Only known text containers are traversed. Opaque props and extension payloads are not indexed. */
export function contentText(value: unknown): string {
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) return value.map(contentText).join(' ');
  if (!value || typeof value !== 'object') return '';
  const v = value as Record<string, unknown>;
  if (v.type === 'text' && typeof v.text === 'string') return v.text;
  if (
    v.type &&
    (typeof v.type !== 'string' || !['link', 'tableContent', 'tableCell'].includes(v.type))
  )
    return '';
  return ['content', 'rows', 'cells']
    .map((k) => contentText(v[k]))
    .filter(Boolean)
    .join(' ');
}
export function targetOf(o: TioObject): ContentTarget {
  return { workspaceId: o.workspaceId, id: o.id, kind: o.type as ContentTarget['kind'] };
}
export function titleOfContent(o: TioObject, objects: TioObject[]) {
  return o.type === 'record' ? recordTitle(o, objects) : o.title || o.name || 'Untitled';
}
export function extractReferences(o: TioObject, database?: TioObject): ReferenceOccurrence[] {
  const results: ReferenceOccurrence[] = [];
  const add = (
    refs: ReturnType<typeof contentMentions>,
    source: ContentTarget,
    excerpt: string,
    fieldName?: string,
  ) => {
    for (const ref of refs)
      if (ref.kind !== 'github-user' && ref.workspaceId === o.workspaceId)
        results.push({
          source,
          target: ref,
          excerpt: excerpt.slice(0, 320),
          ...(fieldName ? { fieldName } : {}),
        });
  };
  const walk = (blocks: Block[]) => {
    for (const b of blocks) {
      if (textBlocks.has(b.type))
        add(
          contentMentions(b.content),
          { ...targetOf(o), anchor: { type: 'block', blockId: b.id } },
          contentText(b.content),
        );
      walk(b.children);
    }
  };
  if (o.type === 'page' || o.type === 'record') walk(o.blocks ?? []);
  if (o.type === 'record')
    for (const f of database?.fields ?? [])
      if (f.type === 'mention')
        add(
          mentionReferences(o.properties?.[f.id]),
          { ...targetOf(o), anchor: { type: 'field', fieldId: f.id } },
          f.name,
          f.name,
        );
  return results;
}
export function searchHits(
  objects: TioObject[],
  navigation: TioObject[],
  text: string,
  type?: string,
): SearchHit[] {
  const all = [...navigation, ...objects];
  const visible = visibility(all);
  const byId = new Map(all.map((o) => [o.id, o]));
  const query = text.toLocaleLowerCase();
  const results: SearchHit[] = [];
  for (const o of objects) {
    if (
      !visible(o) ||
      !['page', 'record', 'database'].includes(o.type) ||
      (type && type !== 'all' && type !== o.type)
    )
      continue;
    const title = titleOfContent(o, all);
    const names: string[] = [];
    const seen = new Set<string>();
    let parent = byId.get(o.databaseId ?? o.parentId ?? '');
    while (parent && !seen.has(parent.id)) {
      seen.add(parent.id);
      names.unshift(titleOfContent(parent, all));
      parent = byId.get(parent.parentId ?? '');
    }
    const path = names.join(' / ');
    const add = (target: ContentTarget, value: string) => {
      const offset = value.toLocaleLowerCase().indexOf(query);
      if (offset < 0) return;
      const anchor = target.anchor;
      results.push({
        id: `${o.id}:${anchor ? (anchor.type === 'block' ? anchor.blockId : anchor.fieldId) : 'title'}`,
        target,
        title,
        path,
        excerpt: value.slice(Math.max(0, offset - 80), offset + 240),
      });
    };
    add(targetOf(o), title);
    const walk = (blocks: Block[]) => {
      for (const b of blocks) {
        if (textBlocks.has(b.type))
          add({ ...targetOf(o), anchor: { type: 'block', blockId: b.id } }, contentText(b.content));
        walk(b.children);
      }
    };
    walk(o.blocks ?? []);
    if (o.type === 'record')
      for (const f of byId.get(o.databaseId!)?.fields ?? []) {
        const value = o.properties?.[f.id];
        if (['string', 'number', 'boolean'].includes(typeof value))
          add({ ...targetOf(o), anchor: { type: 'field', fieldId: f.id } }, String(value));
      }
  }
  return results;
}
