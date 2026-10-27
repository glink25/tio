import { textBlock, type Block } from '@tio/core';
import { expect, it } from 'vitest';

import {
  fromEditor,
  toEditor,
  type ContentSchema,
} from '../../../packages/editor-blocknote/src/codec';
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
it('roundtrips atomic mentions in paragraphs, nested lists and table cells', () => {
  const mention = { type: 'mention', props: { workspaceId: 'w', kind: 'database', id: 'db' } };
  const configured = { ...schema, inlineContentSchema: { mention: {} } };
  const blocks = [
    { ...textBlock(''), content: [mention], children: [{ ...textBlock(''), content: [mention] }] },
    table([mention]),
  ];
  expect(fromEditor(toEditor(blocks, configured), blocks)).toEqual(blocks);
});

it('roundtrips code source, display modes and unknown props without converting legacy blocks', () => {
  const configured: ContentSchema = {
    ...schema,
    blockSchema: {
      ...schema.blockSchema,
      codeBlock: {
        content: 'plain',
        propSchema: {
          language: { default: 'text' },
          displayMode: { default: 'preview', values: ['code', 'preview', 'split'] },
        },
      },
    },
  };
  for (const props of [
    { language: 'js' },
    { language: 'mermaid', displayMode: 'split', future: true },
  ]) {
    const block: Block = { ...textBlock('flowchart TD\n A --> B\n'), type: 'codeBlock', props };
    expect(fromEditor(toEditor([block], configured), [block])).toEqual([block]);
  }
});

it('does not persist BlockNote undefined content on atomic mentions', () => {
  const configured = { ...schema, inlineContentSchema: { mention: {} } };
  const mention = {
    type: 'mention',
    props: { workspaceId: 'w', kind: 'page', id: 'p' },
    content: undefined,
  };
  const source = [{ ...textBlock(''), content: [mention] }, table([mention])];
  const saved = fromEditor(source, []);
  expect(Object.keys((saved[0].content as object[])[0])).toEqual(['type', 'props']);
  expect(toEditor(saved, configured).map((block) => block.type)).toEqual(['paragraph', 'table']);
});
