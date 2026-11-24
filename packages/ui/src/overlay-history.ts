interface OverlayEntry {
  key: string;
  close: () => void;
  canClose: () => boolean;
  registered: boolean;
  href?: string;
}

const traversals = new WeakSet<Event>();

export function isOverlayHistoryTraversal(event: Event) {
  return traversals.has(event);
}

/** A document has one history, including when it contains multiple editor roots. */
export function createOverlayHistory(view: Window, modalHash = false) {
  const { history } = view;
  const overlays: OverlayEntry[] = [];
  let returning = false;
  let backRequested = false;
  let pendingNavigation: (() => void) | undefined;
  let available = false;
  let baseState: unknown;
  const baseUrl = () => view.location.pathname + view.location.search;
  if (modalHash && (history.state?.tioOverlay || view.location.hash.startsWith('#/modal/')))
    history.replaceState(null, '', baseUrl());

  function publish() {
    const next = Boolean(
      history.state?.tioOverlay && (returning || overlays.some((entry) => entry.registered)),
    );
    if (next === available) return;
    available = next;
    view.dispatchEvent(new CustomEvent('tio:overlay-back', { detail: next }));
  }

  function push(entry: OverlayEntry, restore = false) {
    if (!restore) {
      entry.href = modalHash ? `#/modal/${entry.key}` : view.location.href;
      if (!history.state?.tioOverlay) baseState = history.state;
    }
    history.pushState(
      {
        ...history.state,
        tioOverlay: entry.key,
        tioOverlayDepth: (history.state?.tioOverlayDepth ?? 0) + 1,
      },
      '',
      entry.href,
    );
    entry.registered = true;
  }

  function registerPending() {
    for (const entry of overlays) if (!entry.registered) push(entry);
  }

  function onWindowClose(event: Event) {
    for (const entry of [...overlays].reverse()) {
      if (!entry.canClose()) {
        event.preventDefault();
        return;
      }
    }
  }

  function navigate(write: () => void) {
    if (returning) {
      pendingNavigation = write;
    } else if (history.state?.tioOverlay) {
      pendingNavigation = write;
      returning = true;
      for (const entry of overlays) entry.registered = false;
      history.go(-(history.state.tioOverlayDepth ?? 1));
    } else {
      write();
    }
  }

  function onPop(event: PopStateEvent) {
    backRequested = false;
    const key = history.state?.tioOverlay;
    const index = overlays.findIndex((entry) => entry.key === key && entry.registered);
    if (key && index < 0) {
      // History can still contain a closed parent or a closed entry reached with Forward.
      traversals.add(event);
      history.back();
      return;
    }
    if (returning) {
      traversals.add(event);
      returning = false;
      const navigation = pendingNavigation;
      pendingNavigation = undefined;
      if (navigation) navigate(navigation);
      if (!returning) registerPending();
    } else {
      const closing = overlays
        .slice(index + 1)
        .filter((entry) => entry.registered)
        .reverse();
      if (closing.length && (modalHash || closing[0].href === view.location.href))
        traversals.add(event);
      for (const entry of closing) {
        if (!entry.canClose()) {
          traversals.add(event);
          if (!modalHash && entry.href && entry.href !== view.location.href)
            history.pushState(baseState, '', entry.href);
          // Restore every surviving entry before the guard's confirmation mounts.
          for (const live of overlays.slice(index + 1)) if (live.registered) push(live, true);
          break;
        }
        entry.registered = false;
        entry.close();
      }
    }
    publish();
  }

  view.addEventListener('popstate', onPop, true);
  view.addEventListener('tio:before-window-close', onWindowClose);
  if (modalHash)
    view.addEventListener('tio:request-overlay-back', () => {
      if (!available || returning || backRequested) return;
      backRequested = true;
      history.back();
    });

  return {
    navigate,
    register(close: () => void, canClose: () => boolean) {
      const entry: OverlayEntry = { key: crypto.randomUUID(), close, canClose, registered: false };
      overlays.push(entry);
      if (!returning) registerPending();
      publish();
      return () => {
        const index = overlays.indexOf(entry);
        if (index >= 0) overlays.splice(index, 1);
        if (
          entry.registered &&
          !returning &&
          !backRequested &&
          history.state?.tioOverlay === entry.key
        ) {
          returning = true;
          history.back();
        }
        publish();
      };
    },
  };
}
