import { textBlock, type Block } from '@tio/core';
import { expect, it } from 'vitest';

import { fromEditor, toEditor, type ContentSchema } from '../packages/editor-blocknote/src/codec';
const schema: ContentSchema = {
  blockSchema: {
    paragraph: { content: 'inline', propSchema: {} },
    table: { content: 'table', propSchema: {} },
  },
  styleSchema: { bold: { propSchema: 'boolean' } },
  inlineContentSchema: {},
};
const table = (content: unknown): Block => ({
  id: 'table',
  type: 'table',
  props: {},
  children: [],
  content: {
    type: 'tableContent',
    columnWidths: [null],
    rows: [{ cells: [{ type: 'tableCell', props: {}, content }] }],
  },
});
it('opaque table content preserves unknown nested inline and style data while adjacent text changes', () => {
  for (const content of [
    [{ type: 'mention', id: 'person' }],
    [{ type: 'text', text: 'future', styles: { future: true } }],
  ]) {
    const original = table(content);
    const editor = toEditor([original, textBlock('before')], schema);
    expect(editor[0].type).toBe('unsupported');
    editor[1].content = [{ type: 'text', text: 'after', styles: {} }];
    expect(fromEditor(editor, [original])[0]).toEqual(original);
  }
});
it('known tables remain editable and encode optional widths as JSON null', () => {
  const original = table([{ type: 'text', text: 'cell', styles: { bold: true } }]);
  const editor = toEditor([original], schema);
  expect(editor[0].type).toBe('table');
  expect(editor[0].content.columnWidths).toEqual([undefined]);
  expect(fromEditor(editor, [original])).toEqual([original]);
});
it('a registered block codec controls its own mapping without modifying the built-in codec', () => {
  const customSchema = {
    ...schema,
    blockSchema: { ...schema.blockSchema, callout: { content: 'inline', propSchema: {} } },
  };
  const block = { ...textBlock('Custom'), type: 'callout', extra: { retained: true } };
  const codecs = {
    callout: {
      accepts: () => true,
      toEditor: (block: Block) => block.content,
      fromEditor: (content: unknown) => content,
    },
  };
  expect(fromEditor(toEditor([block], customSchema, codecs), [block], codecs)).toEqual([block]);
  expect(toEditor([block], schema)[0].type).toBe('unsupported');
});
