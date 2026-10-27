import type { EditHistory } from '@tio/ui';
import { useEffect, useRef } from 'react';

/** Capture before the grid/ProseMirror handle shortcuts; include this surface's portals. */
export function useHistoryShortcuts(history: EditHistory) {
  const root = useRef<HTMLDivElement>(null);
  const current = useRef(history);
  current.current = history;
  useEffect(() => {
    const container = root.current?.closest<HTMLElement>('.tio-editor') ?? root.current;
    if (!container) return;
    const owns = (event: Event) =>
      event.target instanceof Element &&
      (event.target.closest('.tio-editor') ?? container) === container &&
      !event.target.closest('[data-history="native"], .cm-editor');
    const keydown = (event: KeyboardEvent) => {
      if (event.isComposing) return;
      if (
        owns(event) &&
        [
          'ArrowLeft',
          'ArrowRight',
          'ArrowUp',
          'ArrowDown',
          'Home',
          'End',
          'PageUp',
          'PageDown',
          'Enter',
          'Backspace',
          'Delete',
        ].includes(event.key)
      )
        current.current.breakGroup();
      if (!owns(event) || event.isComposing || event.altKey || !(event.metaKey || event.ctrlKey))
        return;
      const key = event.key.toLowerCase();
      const redo =
        (key === 'z' && event.shiftKey) ||
        (key === 'y' && event.ctrlKey && !event.metaKey && !event.shiftKey);
      if (key !== 'z' && !redo) {
        current.current.breakGroup();
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      if (redo) current.current.redo();
      else current.current.undo();
    };
    const beforeinput = (event: Event) => {
      const input = event as InputEvent;
      if (owns(event) && !input.isComposing && input.inputType?.startsWith('delete'))
        current.current.breakGroup();
      if (
        !owns(event) ||
        input.isComposing ||
        !['historyUndo', 'historyRedo'].includes(input.inputType)
      )
        return;
      event.preventDefault();
      event.stopPropagation();
      if (input.inputType === 'historyRedo') current.current.redo();
      else current.current.undo();
    };
    const boundary = (event: Event) => {
      if (owns(event)) current.current.breakGroup();
    };
    container.addEventListener('keydown', keydown, true);
    container.addEventListener('beforeinput', beforeinput, true);
    container.addEventListener('pointerdown', boundary, true);
    container.addEventListener('focusin', boundary, true);
    return () => {
      container.removeEventListener('keydown', keydown, true);
      container.removeEventListener('beforeinput', beforeinput, true);
      container.removeEventListener('pointerdown', boundary, true);
      container.removeEventListener('focusin', boundary, true);
    };
  }, []);
  return root;
}
