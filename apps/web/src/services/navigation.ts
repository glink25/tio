export function readRoute() {
  try {
    const match = location.hash.match(/^#\/w\/([^/]+)(?:\/p\/([^/?]+))?/);
    return match
      ? {
          workspaceId: decodeURIComponent(match[1]),
          id: match[2] ? decodeURIComponent(match[2]) : '',
        }
      : null;
  } catch {
    return null;
  }
}
export function writeRoute(workspaceId: string, id: string, replace = false) {
  const hash = `#/w/${encodeURIComponent(workspaceId)}/p/${encodeURIComponent(id)}`;
  if (location.hash !== hash || history.state?.tioOverlay)
    history[replace || history.state?.tioOverlay ? 'replaceState' : 'pushState']({}, '', hash);
}
