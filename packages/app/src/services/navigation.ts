import { isContentAnchor, type ContentAnchor, type ContentTarget } from '@tio/core';
import { isOverlayHistoryTraversal, navigateFromOverlay } from '@tio/ui';

interface ContentRoute {
  workspaceId: string;
  id: string;
  graph: boolean;
  anchor?: ContentAnchor;
}

export function readRoute(hash: string): ContentRoute | null {
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
export function createContentRouter(memory: boolean) {
  let memoryRoute = memory ? readRoute(location.hash) : null;
  const launchHash = memoryRoute ? location.hash : '';
  const baseUrl = () => location.pathname + location.search;
  let observed = location.hash;
  function writeHash(hash: string, replace: boolean) {
    if (location.hash !== hash) {
      navigateFromOverlay(() => {
        if (location.hash !== hash)
          history[replace ? 'replaceState' : 'pushState']({}, '', hash || baseUrl());
        observed = location.hash;
      });
    }
  }
  return {
    current: () => (memory ? memoryRoute : location.hash),
    read: () => (memory ? memoryRoute : readRoute(location.hash)),
    start() {
      if (launchHash && location.hash === launchHash)
        history.replaceState(history.state, '', baseUrl());
    },
    clear() {
      if (memory) memoryRoute = null;
      else writeHash('', true);
    },
    write(workspaceId: string, id: string, replace = false, anchor?: ContentAnchor, graph = false) {
      if (memory) {
        memoryRoute = { workspaceId, id, anchor, graph };
        return;
      }
      writeHash(
        graph
          ? `#/w/${encodeURIComponent(workspaceId)}/graph?focus=${encodeURIComponent(id)}`
          : contentHash(workspaceId, id, anchor),
        replace,
      );
    },
    subscribe(listener: (route: ContentRoute) => void) {
      if (memory) return;
      const pop = (event: Event) => {
        if (isOverlayHistoryTraversal(event) || history.state?.tioOverlay) return;
        const hash = location.hash;
        if (hash === observed) return;
        observed = hash;
        const route = readRoute(hash);
        if (route) listener(route);
      };
      window.addEventListener('popstate', pop);
      window.addEventListener('hashchange', pop);
      return () => {
        window.removeEventListener('popstate', pop);
        window.removeEventListener('hashchange', pop);
      };
    },
  };
}
