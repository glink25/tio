import { useBlockNoteEditor, useComponentsContext, useEditorState } from '@blocknote/react';
import { useT } from '@tio/i18n';
import { Selection } from '@tiptap/pm/state';
import { Sparkles } from 'lucide-react';
import { useContext } from 'react';

import { ContentLinksContext } from './content-links';
import { clearEditorRange } from './interaction';

export interface SelectedText {
  text: string;
  blockIds: string[];
}
export function AskAssistantButton() {
  const editor = useBlockNoteEditor();
  const components = useComponentsContext()!;
  const { askAssistant } = useContext(ContentLinksContext);
  const t = useT();
  const selected = useEditorState({
    editor,
    selector: ({ editor }) => {
      const { from, to, empty } = editor.prosemirrorState.selection;
      if (empty) return undefined;
      const text = editor.prosemirrorState.doc.textBetween(from, to, '\n');
      return text.trim()
        ? {
            text,
            blockIds: (editor.getSelection()?.blocks ?? [editor.getTextCursorPosition().block]).map(
              (block) => block.id,
            ),
          }
        : undefined;
    },
  });
  if (!askAssistant || !selected) return null;
  return (
    <components.FormattingToolbar.Button
      label={t('assistant.quoteSelection')}
      mainTooltip={t('assistant.quoteSelection')}
      icon={<Sparkles size={18} />}
      onClick={() => {
        const view = editor.prosemirrorView;
        if (view.composing) return;
        editor.transact((tr) =>
          tr
            .setSelection(Selection.near(tr.doc.resolve(tr.selection.to), -1))
            .setMeta('addToHistory', false),
        );
        if (view.dom.ownerDocument.activeElement === view.dom) view.dom.blur();
        clearEditorRange(view);
        askAssistant(selected);
      }}
    />
  );
}
