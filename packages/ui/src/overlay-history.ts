interface OverlayEntry {
  key: string;
  close: () => void;
  registered: boolean;
}
const overlays: OverlayEntry[] = [];
const retired = new Set<string>();
let returning = false;
let listening = false;

function listen() {
  const needed = overlays.length > 0 || returning;
  if (needed === listening) return;
  listening = needed;
  if (needed) window.addEventListener('popstate', onPop);
  else window.removeEventListener('popstate', onPop);
}
function registerPending() {
  for (const entry of overlays) {
    if (entry.registered) continue;
    history.pushState({ ...history.state, tioOverlay: entry.key }, '');
    entry.registered = true;
  }
}
function onPop() {
  const key = history.state?.tioOverlay;
  // A parent can close while a child is still open. Skip its retired entry.
  if (retired.delete(key)) {
    returning = true;
    history.back();
    return;
  }
  if (returning) {
    returning = false;
    registerPending();
  } else {
    const index = overlays.findIndex((entry) => entry.key === key);
    for (const entry of overlays.slice(index + 1).reverse()) {
      entry.registered = false;
      entry.close();
    }
  }
  listen();
}

/** Serialize internal Back traversal with registration of replacement dialogs. */
export function registerOverlay(close: () => void) {
  const entry = { key: crypto.randomUUID(), close, registered: false };
  overlays.push(entry);
  if (!returning) registerPending();
  listen();
  return () => {
    const index = overlays.indexOf(entry);
    if (index >= 0) overlays.splice(index, 1);
    if (entry.registered) {
      if (!returning && history.state?.tioOverlay === entry.key) {
        returning = true;
        history.back();
      } else {
        retired.add(entry.key);
      }
    }
    listen();
  };
}
