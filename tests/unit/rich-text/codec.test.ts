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
it('pasted opaque descendants receive stable independent IDs', () => {
  const original = { ...textBlock('opaque'), type: 'future', children: [textBlock('nested')] };
  const encoded = toEditor([original], schema);
  encoded[0].id = 'pasted';
  const pasted = fromEditor(encoded, [original]);
  expect(pasted[0].children[0].id).not.toBe(original.children[0].id);
  expect(fromEditor(encoded, pasted)).toEqual(pasted);
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

it('roundtrips code source, display mode and unknown props', () => {
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
    { language: 'html', displayMode: 'split', future: { retained: true } },
  ]) {
    const source =
      props.language === 'html'
        ? '<!doctype html>\n<style>body { color: red }</style>\n<script>document.body.append("Hello")</script>\n'
        : 'flowchart TD\n A --> B\n';
    const block: Block = { ...textBlock(source), type: 'codeBlock', props };
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

it('accepts explicitly typed optional props such as numbered list start without losing unknown props', () => {
  const configured: ContentSchema = {
    ...schema,
    blockSchema: {
      ...schema.blockSchema,
      numberedListItem: {
        content: 'inline',
        propSchema: { start: { default: undefined, type: 'number' } },
      },
    },
  };
  for (const props of [{ start: 3, extension: 'kept' }, {}, { start: undefined }]) {
    const original = { ...textBlock('Numbered item'), type: 'numberedListItem', props };
    expect(toEditor([original], configured)[0].type).toBe('numberedListItem');
    expect(fromEditor(toEditor([original], configured), [original])).toEqual([original]);
  }
  expect(
    toEditor(
      [{ ...textBlock('Invalid'), type: 'numberedListItem', props: { start: '3' } }],
      configured,
    )[0].type,
  ).toBe('unsupported');
});

it('roundtrips record and user mentions and removes editor-only default usernames on content references', () => {
  const configured = { ...schema, inlineContentSchema: { mention: {} } };
  const content = [
    { type: 'mention', props: { workspaceId: 'w', kind: 'record', id: 'row' } },
    {
      type: 'mention',
      props: { workspaceId: 'w', kind: 'github-user', id: '42', login: 'octocat' },
    },
  ];
  const blocks = [{ ...textBlock(''), content }, table(content)];
  expect(fromEditor(toEditor(blocks, configured), blocks)).toEqual(blocks);
  const editor = [
    {
      ...textBlock(''),
      content: [{ ...content[0], props: { ...content[0].props, login: '' }, content: undefined }],
    },
  ];
  expect((fromEditor(editor, [])[0].content as object[])[0]).toEqual(content[0]);
});

// Agent writes use the same schema without mounting an editor; existing codec round trips did not validate this entry.
it('validates changed known blocks while retaining untouched opaque content', async () => {
  const { validateOperationBlocks } = await import('../../../packages/editor-blocknote/src/codec');
  const opaque: Block = {
    id: 'opaque',
    type: 'future',
    props: { future: true },
    content: { future: ['raw'] },
    children: [],
  };
  const paragraph = textBlock('before');
  const after = [
    opaque,
    { ...paragraph, content: [{ type: 'text', text: 'after', styles: { bold: true } }] },
  ];
  expect(() => validateOperationBlocks([opaque, paragraph], after, schema)).not.toThrow();
  expect(after[0]).toEqual(opaque);
  expect(() =>
    validateOperationBlocks(
      [paragraph],
      [{ ...paragraph, content: [{ type: 'text', text: 'bad', styles: { bold: 'invalid' } }] }],
      schema,
    ),
  ).toThrow();
  expect(() => validateOperationBlocks([], [opaque], schema)).toThrow();
});
