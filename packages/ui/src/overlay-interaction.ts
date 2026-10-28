import { useCallback, useEffect, useRef, useState } from 'react';

import { claimInteraction, interactionOwner, registerInteraction } from './interaction';

const layers = new Set<HTMLElement>();

/** Touch dismissal consumes one gesture; it must never activate the editor below. */
export function useOverlayInteraction(open: boolean, close: () => void, restoreFocus?: () => void) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [node, setNode] = useState<HTMLDivElement | null>(null);
  const ownership = useRef<ReturnType<typeof registerInteraction> | null>(null);
  const attach = useCallback((element: HTMLDivElement | null) => {
    ownership.current?.dispose();
    if (element)
      ownership.current = registerInteraction(element, 'overlay', {
        parent: interactionOwner(element.ownerDocument),
      });
    if (ownership.current && element)
      claimInteraction(element.ownerDocument, ownership.current.scope);
    ref.current = element;
    setNode(element);
  }, []);
  const closeRef = useRef(close);
  closeRef.current = close;
  const outsideTouch = useRef(false);
  useEffect(() => {
    if (!open || !node) return;
    outsideTouch.current = false;
    layers.add(node);
    let releaseGesture: (() => void) | undefined;
    const pointerDown = (event: PointerEvent) => {
      releaseGesture?.();
      if (event.pointerType !== 'touch') return;
      const top = [...layers]
        .filter((layer) => layer.isConnected)
        .sort((a, b) => (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1))
        .at(-1);
      if (top !== node || event.composedPath().includes(node)) return;
      // Cancel native focus before Radix's delayed touch-outside notification.
      event.preventDefault();
      event.stopImmediatePropagation();
      let moved = false;
      const swallow = (next: Event) => {
        next.preventDefault();
        next.stopImmediatePropagation();
      };
      const move = (next: PointerEvent) => {
        if (
          next.pointerId === event.pointerId &&
          Math.hypot(next.clientX - event.clientX, next.clientY - event.clientY) > 10
        )
          moved = true;
      };
      const finish = (next: PointerEvent) => {
        if (next.pointerId !== event.pointerId) return;
        if (moved) {
          cleanup();
          return;
        }
        swallow(next);
        outsideTouch.current = true;
        closeRef.current();
        // Keep swallowing the compatibility click after this layer unmounts.
      };
      const click = (next: MouseEvent) => {
        if (next.detail > 0) swallow(next);
        cleanup();
      };
      const touchEnd = (next: TouchEvent) => {
        if (!moved) swallow(next);
      };
      const cleanup = () => {
        document.removeEventListener('pointermove', move, true);
        document.removeEventListener('pointerup', finish, true);
        document.removeEventListener('pointercancel', cleanup, true);
        document.removeEventListener('mousedown', swallow, true);
        document.removeEventListener('touchend', touchEnd, true);
        document.removeEventListener('click', click, true);
        document.removeEventListener('pointerdown', cleanup, true);
        releaseGesture = undefined;
      };
      releaseGesture = cleanup;
      document.addEventListener('pointermove', move, true);
      document.addEventListener('pointerup', finish, true);
      document.addEventListener('pointercancel', cleanup, true);
      document.addEventListener('mousedown', swallow, true);
      document.addEventListener('touchend', touchEnd, { capture: true, passive: false });
      document.addEventListener('click', click, true);
      document.addEventListener('pointerdown', cleanup, true);
    };
    document.addEventListener('pointerdown', pointerDown, { capture: true, passive: false });
    return () => {
      layers.delete(node);
      document.removeEventListener('pointerdown', pointerDown, true);
    };
  }, [open, node]);
  return {
    ref: attach,
    onCloseAutoFocus(event: Event) {
      const focused = document.activeElement?.closest(
        '.tio-dialog[data-state="open"], .tio-drawer[data-state="open"], .tio-popover[data-state="open"], .tio-menu[data-state="open"]',
      );
      if (
        outsideTouch.current ||
        (ownership.current && !ownership.current.canRestore()) ||
        (focused && !ref.current?.contains(focused))
      ) {
        event.preventDefault();
      } else if (restoreFocus) {
        event.preventDefault();
        restoreFocus();
      }
    },
  };
}
