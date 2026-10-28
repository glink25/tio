import { object, textBlock, type Block } from '@tio/core';
import { pageAssetIds, pageMarkdown, type PageExportContext } from '@tio/serialization/page';
import { expect, it } from 'vitest';

import { pdfBlocks, pdfInline } from '../../../packages/web-editor/src/page-export/pdf-content';
import {
  filename,
  prepareReferences,
  type PageExportInput,
} from '../../../packages/web-editor/src/page-export/shared';

const context: PageExportContext = {
  objects: new Map([['target', object('page', 'w', { id: 'target', title: '目标页面' })]]),
  assetUrl: (id) => `assets/${id}.png`,
  unavailable: 'Unavailable',
  unsupported: 'Unsupported',
};
const block = (type: string, content: unknown, props = {}, children: Block[] = []): Block => ({
  ...textBlock(''),
  type,
  content,
  props,
  children,
});
const text = (value: string, styles = {}) => ({ type: 'text', text: value, styles });
const markdown = (blocks: Block[]) =>
  pageMarkdown(object('page', 'w', { title: '导出', blocks }), context);

it('exports rich inline content, references and safe links without exposing dynamic HTML', () => {
  const result = markdown([
    block('paragraph', [
      text('bold', { bold: true }),
      text('strike', { strike: true }),
      { type: 'link', href: 'https://example.com/a(b)', content: [text('Link')] },
      { type: 'mention', props: { workspaceId: 'w', kind: 'page', id: 'target' } },
      { type: 'mention', props: { workspaceId: 'elsewhere', kind: 'page', id: 'target' } },
    ]),
    block('appSlice', [], { title: 'Widget', html: '<script>secret()</script>' }),
    block('future', []),
  ]);
  expect(result).toContain(
    '**bold**~~strike~~[Link](https://example.com/a%28b%29)目标页面Unavailable',
  );
  expect(result).toContain('[App Slice: Widget]');
  expect(result).toContain('[Unsupported: future]');
  expect(result).not.toContain('secret');
});

it('preserves code fences, nested list indentation, table cells and media paths', () => {
  const result = markdown([
    block('bulletListItem', [text('parent')], {}, [block('numberedListItem', [text('child')])]),
    block('codeBlock', [text('```\nhello\n```')], { language: 'js' }),
    block('table', {
      type: 'tableContent',
      rows: [{ cells: [{ type: 'tableCell', content: [text('a|b\nc')] }] }],
    }),
    block('image', [], { url: 'asset:pic', caption: 'Picture' }),
  ]);
  expect(result).toContain('- parent\n\n  1. child');
  expect(result).toContain('````js\n```\nhello\n```\n````');
  expect(result).toContain('| a\\|b<br>c |\n| --- |');
  expect(result).toContain('![Picture](assets/pic.png)');
});

it('only collects referenced media assets and deduplicates nested attachments', () => {
  expect(
    pageAssetIds([
      block('image', [], { url: 'asset:one' }),
      block('paragraph', [], {}, [
        block('file', [], { url: 'asset:one' }),
        block('file', [], { url: 'asset:two' }),
      ]),
      block('appSlice', [], { url: 'asset:ignored' }),
    ]),
  ).toEqual(['one', 'two']);
});

it('builds PDF text and table structures with styles, numbering and image placeholders', () => {
  expect(
    pdfInline(
      [
        text('中文', { bold: true }),
        { type: 'link', href: 'javascript:bad()', content: [text('Safe')] },
      ],
      context,
    ),
  ).toMatchObject([{ text: '中文', bold: true }, { text: 'Safe' }]);
  expect(
    pdfInline({ type: 'link', href: 'javascript:bad()', content: [text('Safe')] }, context)[0],
  ).not.toHaveProperty('link');
  const content = pdfBlocks(
    [
      block('numberedListItem', [text('first')]),
      block('numberedListItem', [text('second')]),
      block('table', {
        rows: [{ cells: [[text('Header')]] }, { cells: [[text('中文')]] }],
        headerRows: 1,
      }),
      block('image', [], { url: 'https://example.com/missing.png', caption: 'Image' }),
    ],
    context,
    new Map(),
  );
  expect(content[0]).toMatchObject({ text: [{ text: '1. ' }, { text: 'first' }] });
  expect(content[1]).toMatchObject({ text: [{ text: '2. ' }, { text: 'second' }] });
  expect(content[2]).toMatchObject({ table: { headerRows: 1, widths: ['*'] } });
  expect(content[3]).toMatchObject({ text: '[Image: Unavailable]' });
});

it('makes download names safe without losing readable Unicode titles', () => {
  expect(filename('中文/a:b. ')).toBe('中文_a_b');
  expect(filename('...')).toBe('Untitled');
});

it('loads missing reference metadata without enumerating content or crossing spaces', async () => {
  const batches: string[][] = [];
  const page = object('page', 'w', {
    blocks: [
      block('paragraph', [
        { type: 'mention', props: { workspaceId: 'w', kind: 'page', id: 'target' } },
        { type: 'mention', props: { workspaceId: 'other', kind: 'page', id: 'foreign' } },
      ]),
    ],
  });
  const input: PageExportInput = {
    page,
    objects: [page],
    labels: { untitled: 'Untitled', unavailable: 'Missing', unsupported: 'Unsupported' },
    readAsset: async () => undefined,
    readMetadata: async (ids) => {
      batches.push(ids);
      return [context.objects.get('target')!];
    },
  };
  await prepareReferences(input);
  expect(batches).toEqual([['target']]);
  expect(input.objects).toContainEqual(context.objects.get('target'));
  await prepareReferences(input);
  expect(batches).toHaveLength(1);
});

it('exports record titles and GitHub profile references without requiring a people lookup', () => {
  const db = object('database', 'w', {
    id: 'db',
    name: 'Tasks',
    fields: [{ id: 'title', name: 'Title', type: 'title' }],
  });
  const row = object('record', 'w', {
    id: 'row',
    databaseId: db.id,
    properties: { title: 'Ship editor' },
    blocks: [],
  });
  const exported = { ...context, objects: new Map([db, row].map((o) => [o.id, o])) };
  const content = [
    { type: 'mention', props: { workspaceId: 'w', kind: 'record', id: 'row' } },
    {
      type: 'mention',
      props: { workspaceId: 'w', kind: 'github-user', id: '42', login: 'octocat' },
    },
  ];
  const result = pageMarkdown(
    object('page', 'w', { title: 'Refs', blocks: [block('paragraph', content)] }),
    exported,
  );
  expect(result).toContain('Ship editor');
  expect(result).toContain('https://github.com/octocat');
  expect(pdfInline(content, exported)).toEqual([
    { text: 'Ship editor' },
    { text: '@octocat', link: 'https://github.com/octocat' },
  ]);
});
