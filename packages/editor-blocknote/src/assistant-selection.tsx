import { useBlockNoteEditor, useComponentsContext, useEditorState } from '@blocknote/react';
import { useT } from '@tio/i18n';
import { Sparkles } from 'lucide-react';
import { useContext } from 'react';

import { ContentLinksContext } from './content-links';

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
      onClick={() => askAssistant(selected)}
    />
  );
}
