import { isContentAnchor, type ContentAnchor, type ContentTarget } from '@tio/core';
export function readRoute(hash = location.hash) {
  try {
    const match = hash.match(/^#\/w\/([A-Za-z0-9_-]+)\/(p\/([A-Za-z0-9_-]*)|graph)(?:\?([^#]*))?$/);
    if (!match) return null;
    const params = new URLSearchParams(match[4]);
    const candidate = params.has('block')
      ? { type: 'block', blockId: params.get('block') }
      : params.has('field')
        ? { type: 'field', fieldId: params.get('field') }
        : undefined;
    return {
      workspaceId: match[1],
      id: match[3] ?? params.get('focus') ?? '',
      graph: match[2] === 'graph',
      anchor: isContentAnchor(candidate) ? candidate : undefined,
    };
  } catch {
    return null;
  }
}
export function contentHash(workspaceId: string, id: string, anchor?: ContentAnchor) {
  const query = anchor
    ? `?${anchor.type === 'block' ? 'block' : 'field'}=${encodeURIComponent(anchor.type === 'block' ? anchor.blockId : anchor.fieldId)}`
    : '';
  return `#/w/${encodeURIComponent(workspaceId)}/p/${encodeURIComponent(id)}${query}`;
}
export function contentUrl(target: ContentTarget) {
  return `${location.origin}${location.pathname}${location.search}${contentHash(target.workspaceId, target.id, target.anchor)}`;
}
export function writeRoute(
  workspaceId: string,
  id: string,
  replace = false,
  anchor?: ContentAnchor,
  graph = false,
) {
  const hash = graph
    ? `#/w/${encodeURIComponent(workspaceId)}/graph?focus=${encodeURIComponent(id)}`
    : contentHash(workspaceId, id, anchor);
  if (location.hash !== hash || history.state?.tioOverlay)
    history[replace || history.state?.tioOverlay ? 'replaceState' : 'pushState']({}, '', hash);
}
