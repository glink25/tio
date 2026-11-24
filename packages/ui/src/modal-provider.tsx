import { createContext, useContext, useEffect, useRef, type ReactNode } from 'react';

import { useOverlayOpen } from './motion';
import { createOverlayHistory } from './overlay-history';

const documents = new WeakMap<Window, ReturnType<typeof createOverlayHistory>>();
type MobileHost = 'ios' | 'android';

function historyFor(view: Window, mobile?: MobileHost) {
  let history = documents.get(view);
  if (!history) {
    history = createOverlayHistory(view, !!mobile);
    documents.set(view, history);
  }
  return history;
}

const ModalContext = createContext<'document' | MobileHost | null>(null);
export function useModalHost() {
  return useContext(ModalContext);
}

/** Embedded editors inherit their host's provider. Standalone editors share document history. */
export function ModalProvider({ children, mobile }: { children: ReactNode; mobile?: MobileHost }) {
  const parent = useContext(ModalContext);
  useEffect(() => {
    if (!parent) historyFor(window, mobile);
  }, [parent, mobile]);
  return (
    <ModalContext.Provider value={parent ?? mobile ?? 'document'}>{children}</ModalContext.Provider>
  );
}

/** Remove transient entries before writing a new content route. */
export function navigateFromOverlay(write: () => void) {
  historyFor(window).navigate(write);
}

export function useOverlayBack(
  close: () => void,
  enabled = true,
  canClose?: () => boolean,
  kind: 'modal' | 'floating' = 'modal',
) {
  const open = useOverlayOpen();
  const host = useModalHost();
  const mobile = host === 'ios' || host === 'android' ? host : undefined;
  const active = enabled && open && (!mobile || kind === 'modal');
  const callbacks = useRef({ close, canClose });
  callbacks.current = { close, canClose };
  useEffect(() => {
    if (!active || !host) return;
    return historyFor(window, mobile).register(
      () => callbacks.current.close(),
      () => callbacks.current.canClose?.() ?? true,
    );
  }, [active, host, mobile]);
}
