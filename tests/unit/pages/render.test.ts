import {
  buildSite,
  escapeHtml,
  renderBlocks,
  routeFile,
  safeUrl,
  type RenderContext,
} from '@glink25/tio-pages';
import { object, type Block } from '@tio/core';
import { FileWorkspaceContent } from '@tio/file-storage';
import { MemoryProvider } from '@tio/provider-memory';
import { describe, expect, it } from 'vitest';

let blockSequence = 0;
const block = (type: string, content: unknown = [], props = {}, children: Block[] = []): Block => ({
  id: `block_${++blockSequence}`,
  type,
  content,
  props,
  children,
});
const text = (value: string) => [{ type: 'text', text: value, styles: {} }];
const context: RenderContext = {
  renderChildren: () => '',
  objects: new Map(),
  pageUrl: () => undefined,
  assetUrl: () => undefined,
};

describe('static HTML rendering', () => {
  it('escapes user HTML and rejects executable links without losing their label', () => {
    const html = renderBlocks(
      [
        block('paragraph', [
          { type: 'link', href: 'javascript:alert(1)', content: text('<script>') },
        ]),
      ],
      context,
    );
    expect(html).toContain('&lt;script&gt;');
    expect(html).not.toContain('<a');
    for (const url of [
      'javascript:alert(1)',
      '//evil.test',
      '/\\evil.test',
      'java\nscript:alert(1)',
    ])
      expect(safeUrl(url)).toBe('');
    expect(escapeHtml('"<&')).toBe('&quot;&lt;&amp;');
  });
  it('preserves code whitespace and renders nested lists and formatted table cells', () => {
    const html = renderBlocks(
      [
        block('codeBlock', text('  <div>\n\tvalue\n'), { language: 'html' }),
        block('numberedListItem', text('first'), { start: 3 }, [
          block('bulletListItem', text('nested')),
        ]),
        block('numberedListItem', text('second')),
        block('table', {
          type: 'tableContent',
          headerRows: 1,
          rows: [
            {
              cells: [
                {
                  type: 'tableCell',
                  props: {},
                  content: [{ type: 'text', text: 'heading', styles: { bold: true } }],
                },
              ],
            },
          ],
        }),
      ],
      context,
    );
    expect(html).toContain('  &lt;div&gt;\n\tvalue\n');
    expect(html).toContain('<ol start="3"><li');
    expect(html).toContain('nested</li></ul></li>');
    expect(html).toContain('<th><strong>heading</strong></th>');
  });
  it('requires extensions to handle unknown blocks instead of silently dropping content', () => {
    expect(() => renderBlocks([block('futureWidget')], context)).toThrow('Unsupported block');
    expect(
      renderBlocks([block('futureWidget')], {
        ...context,
        renderBlock: () => '<aside>widget</aside>',
      }),
    ).toBe('<aside>widget</aside>');
  });
  it('does not link unpublished or cross-workspace mentions', () => {
    const page = object('page', 'ws', { id: 'page', title: 'Target', blocks: [] });
    const ctx = { ...context, objects: new Map([[page.id, page]]), pageUrl: () => '/post/target' };
    const mention = (workspaceId: string) =>
      block('paragraph', [{ type: 'mention', props: { workspaceId, kind: 'page', id: page.id } }]);
    expect(renderBlocks([mention('ws')], ctx)).toContain('href="/post/target"');
    expect(renderBlocks([mention('other')], ctx)).not.toContain('<a');
    expect(renderBlocks([mention('ws')], { ...ctx, pageUrl: () => undefined })).not.toContain('<a');
  });
});

describe('workspace static build', () => {
  async function fixture() {
    const files = new MemoryProvider();
    const content = new FileWorkspaceContent(files, 'ws', { maxFileBytes: 1024 });
    await content.write(object('workspace', 'ws', { id: 'ws', name: 'Site' }));
    await content.write(
      object('page', 'ws', {
        id: 'page',
        title: 'Post',
        blocks: [
          block('paragraph', text('文章'.repeat(2000))),
          block('image', [], { url: 'asset:cover', caption: '<cover>' }),
        ],
      }),
    );
    const asset = object('asset', 'ws', {
      id: 'cover',
      filename: 'cover.png',
      assetPath: 'assets/cover.png',
      mime: 'image/png',
      byteSize: 3,
    });
    await content.writeAsset(asset, new Uint8Array([1, 2, 3]));
    await content.write(asset);
    return { content, files };
  }
  it('reads chunked documents, copies assets and honors explicit page routes', async () => {
    const { content, files } = await fixture();
    const before = [...files.files].map(([path, data]) => [path, Array.from(data)]);
    const result = await buildSite(content, {
      routes: [
        { path: '/post/中文', pageId: 'page', render: (ctx) => ctx.renderPage('page') },
        { path: '/', render: (ctx) => ctx.pageUrl('page')! },
      ],
    });
    expect(result.routes).toEqual(['/post/中文', '/']);
    expect(new TextDecoder().decode(result.files.get('post/中文/index.html'))).toContain(
      'src="/assets/cover.png"',
    );
    expect(new TextDecoder().decode(result.files.get('index.html'))).toBe(
      '/post/%E4%B8%AD%E6%96%87',
    );
    expect(result.files.get('assets/cover.png')).toEqual(new Uint8Array([1, 2, 3]));
    expect([...files.files].map(([path, data]) => [path, Array.from(data)])).toEqual(before);
  });
  it('fails duplicate output and missing assets before returning a site', async () => {
    const { content, files } = await fixture();
    await expect(
      buildSite(content, {
        routes: [
          { path: '/', render: () => '' },
          { path: '/', render: () => '' },
        ],
      }),
    ).rejects.toThrow('Duplicate output');
    files.files.delete('workspaces/ws/assets/cover.png');
    await expect(buildSite(content, { routes: [] })).rejects.toThrow('Missing or invalid asset');
  });
  it('rejects traversal, encoded routes and query strings', () => {
    for (const route of ['/../escape', '//host', '/%2e%2e/path', '/x?y', '/x#y', '/x\\y'])
      expect(() => routeFile(route)).toThrow('Invalid route');
    expect(routeFile('/')).toBe('index.html');
    expect(routeFile('/post/中文')).toBe('post/中文/index.html');
  });
});
