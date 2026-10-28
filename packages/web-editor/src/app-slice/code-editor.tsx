import { html } from '@codemirror/lang-html';
import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { basicSetup } from 'codemirror';
import { useEffect, useRef } from 'react';

export function HtmlEditor({
  value,
  onChange,
  readOnly = false,
}: {
  value: string;
  readOnly?: boolean;
  onChange: (value: string) => void;
}) {
  const initial = useRef(value);
  const root = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView>();
  const callback = useRef(onChange);
  callback.current = onChange;
  useEffect(() => {
    const editor = new EditorView({
      parent: root.current!,
      doc: initial.current,
      extensions: [
        basicSetup,
        EditorState.readOnly.of(readOnly),
        EditorView.editable.of(!readOnly),
        html(),
        EditorView.lineWrapping,
        EditorView.contentAttributes.of({ 'aria-label': 'HTML', 'data-testid': 'app-slice-html' }),
        EditorView.theme({
          '&': {
            height: 'min(420px, 44dvh)',
            backgroundColor: 'var(--color-panel)',
            color: 'var(--color-ink)',
          },
          '.cm-scroller': { overflow: 'auto' },
        }),
        EditorView.updateListener.of((update) => {
          if (update.docChanged) callback.current(update.state.doc.toString());
        }),
      ],
    });
    view.current = editor;
    return () => {
      editor.destroy();
      view.current = undefined;
    };
    // The following effect reconciles external draft changes without recreating the editor.
  }, [readOnly]);
  useEffect(() => {
    const editor = view.current;
    if (editor && editor.state.doc.toString() !== value)
      editor.dispatch({ changes: { from: 0, to: editor.state.doc.length, insert: value } });
  }, [value]);
  return <div ref={root} className="overflow-hidden rounded border border-line" />;
}
