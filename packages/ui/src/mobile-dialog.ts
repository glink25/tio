import { useLayoutEffect } from 'react';

import { isTopPanel } from './panel-swipe';

const editableInputTypes = new Set(['text', 'search', 'url', 'tel', 'email', 'password', 'number']);

function isEditable(element: Element | null): element is HTMLElement {
  if (element instanceof HTMLInputElement)
    return (
      !element.matches(':disabled') && !element.readOnly && editableInputTypes.has(element.type)
    );
  if (element instanceof HTMLTextAreaElement)
    return !element.matches(':disabled') && !element.readOnly;
  return element instanceof HTMLElement && element.isContentEditable;
}

function revealField(field: HTMLElement, panel: HTMLElement) {
  let scroller = field.parentElement;
  while (scroller && scroller !== panel) {
    if (
      scroller.scrollHeight > scroller.clientHeight &&
      /^(auto|scroll)$/.test(getComputedStyle(scroller).overflowY)
    ) {
      const fieldRect = field.getBoundingClientRect();
      const scrollRect = scroller.getBoundingClientRect();
      const top = scrollRect.top + scroller.clientTop;
      const bottom = top + scroller.clientHeight;
      // Leave room for the focus outline and keep tall editors aligned at the top.
      if (fieldRect.top < top + 4) scroller.scrollTop += fieldRect.top - top - 4;
      else if (fieldRect.bottom > bottom - 4)
        scroller.scrollTop += Math.min(fieldRect.bottom - bottom + 4, fieldRect.top - top - 4);
      return;
    }
    scroller = scroller.parentElement;
  }
}

export function useMobileDialogPosition(layer: HTMLDivElement | null, active: boolean) {
  useLayoutEffect(() => {
    const viewport = window.visualViewport;
    const panel = layer?.querySelector<HTMLElement>(':scope > [data-tio-swipe-panel]');
    if (!active || !layer || !panel || !viewport) return;

    let frame = 0;
    const clear = () => {
      panel.removeAttribute('data-keyboard');
      panel.style.removeProperty('--tio-visible-top');
      panel.style.removeProperty('--tio-visible-bottom');
      panel.style.removeProperty('--tio-visible-height');
    };
    const update = () => {
      frame = 0;
      const field = document.activeElement;
      if (
        !isEditable(field) ||
        !panel.contains(field) ||
        !isTopPanel(panel) ||
        Math.abs(viewport.scale - 1) > 0.01
      ) {
        clear();
        return;
      }

      // On narrow screens the portal defines the containing block. On wide
      // screens its display: contents leaves fixed panels in the layout viewport.
      const shell = layer.getBoundingClientRect();
      const layoutTop = shell.height ? shell.top : 0;
      const layoutBottom = shell.height ? shell.bottom : document.documentElement.clientHeight;
      const visibleTop = Math.max(layoutTop, viewport.offsetTop);
      const visibleBottom = Math.min(layoutBottom, viewport.offsetTop + viewport.height);
      const top = visibleTop - layoutTop;
      const bottom = layoutBottom - visibleBottom;
      if (visibleBottom <= visibleTop || Math.max(top, bottom) <= 1) {
        clear();
        return;
      }

      panel.style.setProperty('--tio-visible-top', `${top}px`);
      panel.style.setProperty('--tio-visible-bottom', `${bottom}px`);
      panel.style.setProperty('--tio-visible-height', `${visibleBottom - visibleTop}px`);
      panel.setAttribute('data-keyboard', '');
      revealField(field, panel);
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(update);
    };
    schedule();
    window.addEventListener('resize', schedule);
    document.addEventListener('focusin', schedule);
    document.addEventListener('focusout', schedule);
    viewport.addEventListener('resize', schedule);
    viewport.addEventListener('scroll', schedule);
    return () => {
      cancelAnimationFrame(frame);
      clear();
      window.removeEventListener('resize', schedule);
      document.removeEventListener('focusin', schedule);
      document.removeEventListener('focusout', schedule);
      viewport.removeEventListener('resize', schedule);
      viewport.removeEventListener('scroll', schedule);
    };
  }, [active, layer]);
}
