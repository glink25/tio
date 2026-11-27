import { getBlockInfoFromSelection } from '@blocknote/core';
import { useBlockNoteEditor, useComponentsContext, useEditorState } from '@blocknote/react';
import { useT } from '@tio/i18n';
import { Selection } from '@tiptap/pm/state';
import { Sparkles } from 'lucide-react';
import { useContext } from 'react';

import { ContentLinksContext } from './content-links';
import { clearEditorRange } from './interaction';

/** An empty quote requests the assistant without creating a conversation reference. */
export interface SelectedText {
  text: string;
  blockIds: string[];
}
export function AskAssistantButton() {
  const editor = useBlockNoteEditor();
  const components = useComponentsContext()!;
  const { askAssistant } = useContext(ContentLinksContext);
  const t = useT();
  const hasSelectionText = useEditorState({
    editor,
    selector: ({ editor }) => {
      const { doc, selection } = editor.prosemirrorState;
      return !selection.empty && !!doc.textBetween(selection.from, selection.to, '\n').trim();
    },
  });
  if (!askAssistant) return null;
  const label = t(hasSelectionText ? 'assistant.quoteSelection' : 'assistant.title');
  return (
    <components.FormattingToolbar.Button
      label={label}
      mainTooltip={label}
      icon={<Sparkles size={18} />}
      onClick={() => {
        const view = editor.prosemirrorView;
        if (view.composing) return;
        const { doc, selection } = view.state;
        const text = selection.empty ? '' : doc.textBetween(selection.from, selection.to, '\n');
        let quote: SelectedText = { text: '', blockIds: [] };
        if (text.trim()) {
          quote = {
            text,
            blockIds: (editor.getSelection()?.blocks ?? [editor.getTextCursorPosition().block]).map(
              (block) => block.id,
            ),
          };
        } else {
          const block = getBlockInfoFromSelection(view.state);
          if (
            block.hasContent &&
            (block.contentKind === 'inline' || block.contentKind === 'plain')
          ) {
            const currentText = doc.textBetween(block.contentStart, block.contentEnd, '\n');
            if (currentText.trim()) {
              quote = { text: currentText, blockIds: [editor.getTextCursorPosition().block.id] };
            }
          }
        }
        if (!selection.empty) {
          editor.transact((tr) =>
            tr
              .setSelection(Selection.near(tr.doc.resolve(tr.selection.to), -1))
              .setMeta('addToHistory', false),
          );
        }
        if (view.dom.ownerDocument.activeElement === view.dom) view.dom.blur();
        clearEditorRange(view);
        askAssistant(quote);
      }}
    />
  );
}
