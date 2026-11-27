const treeKey = (sessionId: string) => `tio.tree.${sessionId}`;

function readCollapsed(key: string) {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(key) ?? 'null');
    if (Array.isArray(value))
      return new Set(value.filter((id): id is string => typeof id === 'string'));
  } catch {
    // Treat unavailable or damaged device preferences as defaults.
  }
}

export function collapsedTreeNodes(sessionId: string) {
  return readCollapsed(treeKey(sessionId)) ?? new Set<string>();
}

export function updateCollapsedTreeNode(
  sessionId: string,
  current: Set<string>,
  objectId: string,
  collapsed: boolean,
) {
  const key = treeKey(sessionId);
  const next = readCollapsed(key) ?? new Set(current);
  if (collapsed) next.add(objectId);
  else next.delete(objectId);
  try {
    localStorage.setItem(key, JSON.stringify([...next]));
  } catch {
    // The current view can still use the updated state.
  }
  return next;
}

export function subscribeTreePreferences(sessionId: string, listener: () => void) {
  const key = treeKey(sessionId);
  const change = (event: StorageEvent) => {
    if (event.key === key || event.key === null) listener();
  };
  window.addEventListener('storage', change);
  return () => window.removeEventListener('storage', change);
}

export function clearTreePreferences(sessionId: string) {
  try {
    localStorage.removeItem(treeKey(sessionId));
  } catch {
    // Device preferences are optional.
  }
}
