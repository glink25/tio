import { createExtension } from '@blocknote/core';
import {
  claimInteraction,
  interactionOwner,
  interactionScopeAt,
  interactionHasKind,
  registerInteraction,
  withinInteraction,
} from '@tio/ui';
import { Plugin, TextSelection } from '@tiptap/pm/state';
import type { NodeView } from '@tiptap/pm/view';

/** Transfer selection ownership before native focus can restore an obsolete range. */
export const EditorInteraction = createExtension(() => ({
  key: 'tioEditorInteraction',
  prosemirrorPlugins: [
    new Plugin({
      view(view) {
        const document = view.dom.ownerDocument;
        const content = registerInteraction(view.dom, 'document', { parent: null });
        const container = view.dom.closest<HTMLElement>('.bn-container');
        const chrome =
          container && container !== view.dom
            ? registerInteraction(container, 'editor-ui', { parent: content.scope })
            : null;
        const widgetOwnsSelection = () => {
          const owner = interactionOwner(document);
          return withinInteraction(owner, content.scope) && interactionHasKind(owner, 'widget');
        };
        const clearDocumentRange = () => {
          if (view.composing) return;
          const selection = document.getSelection();
          if (
            selection?.anchorNode &&
            selection.focusNode &&
            view.dom.contains(selection.anchorNode) &&
            view.dom.contains(selection.focusNode)
          )
            selection.removeAllRanges();
        };
        const pointer = (event: PointerEvent) => {
          if (event.defaultPrevented || !(event.target instanceof HTMLElement)) return;
          const next = interactionScopeAt(event.target);
          if (!next || !withinInteraction(next, content.scope)) return;
          if (interactionHasKind(next, 'widget')) {
            // Keep ProseMirror's mapped bookmark, but don't leave a native range
            // for Safari/Chromium to reuse while the canvas owns interaction.
            clearDocumentRange();
          } else if (
            next === content.scope &&
            widgetOwnsSelection() &&
            view.editable &&
            event.button === 0 &&
            !event.shiftKey &&
            !event.metaKey &&
            !event.ctrlKey &&
            event.target.isContentEditable &&
            !view.composing
          ) {
            const hit = view.posAtCoords({ left: event.clientX, top: event.clientY });
            if (hit)
              view.dispatch(
                view.state.tr
                  .setSelection(TextSelection.near(view.state.doc.resolve(hit.pos)))
                  .setMeta('addToHistory', false)
                  .setMeta('pointer', true),
              );
          }
          claimInteraction(document, next);
        };
        const focus = () => {
          if (widgetOwnsSelection()) clearDocumentRange();
        };
        view.dom.addEventListener('pointerdown', pointer, true);
        document.addEventListener('focusin', focus, true);
        return {
          destroy() {
            view.dom.removeEventListener('pointerdown', pointer, true);
            document.removeEventListener('focusin', focus, true);
            chrome?.dispose();
            content.dispose();
          },
        };
      },
    }),
  ],
}));

/** Preserve node selection/dragging while a marked application owns its events. */
export function isolateInteractionNodeView(nodeView: NodeView) {
  const stopEvent = nodeView.stopEvent?.bind(nodeView);
  nodeView.stopEvent = (event) =>
    (event.target instanceof Element &&
      !!event.target.closest('[data-tio-interaction="widget"]')) ||
    (stopEvent?.(event) ?? false);
}
