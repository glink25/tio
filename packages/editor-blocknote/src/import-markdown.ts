import { BlockNoteEditor } from '@blocknote/core';
import type { Block } from '@tio/core';

import { defaultEditorSchema, fromEditor, type EditorSchema } from './index';

/** File import shares the editor's schema and codec, without mounting another editor view. */
export function parseMarkdown(source: string, extensions?: EditorSchema): Block[] {
  const editor = BlockNoteEditor.create({ schema: extensions?.schema ?? defaultEditorSchema });
  try {
    const parsed = editor.tryParseMarkdownToBlocks(source);
    const blocks = fromEditor(parsed, [], extensions?.codecs);
    const prepare = (items: Block[]) =>
      items.forEach((block) => {
        if (block.type === 'codeBlock') block.props.displayMode = 'code';
        prepare(block.children);
      });
    prepare(blocks);
    return blocks;
  } finally {
    editor._tiptapEditor.destroy();
  }
}
