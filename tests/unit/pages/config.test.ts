import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { renderBlocks, type RenderContext } from '@glink25/tio-pages';
import { createCodeRenderer } from '@glink25/tio-pages/code';
import { buildSiteDirectory, folderContent } from '@glink25/tio-pages/node';
import { object, type Block } from '@tio/core';
import { describe, expect, it } from 'vitest';

import { testsRoot } from '../../paths';

const source = '  const greeting = "<hello>";\n';
const code = (language: string, displayMode?: string): Block => ({
  id: 'code',
  type: 'codeBlock',
  props: { language, ...(displayMode ? { displayMode } : {}) },
  content: [{ type: 'text', text: source, styles: {} }],
  children: [],
});
const page = (block: Block) =>
  object('page', 'space', { id: 'page', title: 'Hello', blocks: [block] });
function context(renderBlock: RenderContext['renderBlock']): RenderContext {
  const ctx: RenderContext = {
    objects: new Map(),
    pageUrl: () => undefined,
    assetUrl: () => undefined,
    renderChildren: (blocks) => renderBlocks(blocks, ctx),
    renderBlock,
  };
  return ctx;
}

describe('configurable static publishing', () => {
  it('builds independent templates and assets directly from an external .tio-page directory', async () => {
    await mkdir(join(testsRoot, '.cache'), { recursive: true });
    const root = await mkdtemp(join(testsRoot, '.cache/pages-config-'));
    try {
      const content = folderContent(root, 'space');
      await content.write(object('workspace', 'space', { id: 'space', name: 'Someone else' }));
      await content.write(page(code('js')));
      await mkdir(join(root, '.tio-page'));
      await writeFile(join(root, '.tio-page/custom.css'), 'body { color: teal; }');
      await writeFile(join(root, '.tio-page/custom.js'), 'document.body.dataset.custom = "yes"');
      const configFile = join(root, '.tio-page/config.ts');
      await writeFile(
        configFile,
        `import { defineSite } from '@glink25/tio-pages';
export default defineSite({ workspaceId: 'space', assets: { 'theme.css': './custom.css', 'custom.js': './custom.js' }, stylesheets: ['/theme.css'], scripts: ['/custom.js'], code: { themes: { light: 'github-light', dark: 'github-dark' } }, template: (objects, context) => ({ routes: [{ path: '/journal/hello', pageId: 'page', render: (site) => '<html><head>' + context.headHtml() + '</head><body><header>Another author</header>' + site.renderPage('page') + '</body></html>' }] }) });`,
      );
      const result = await buildSiteDirectory(root, join(root, '.tio-page/dist'));
      const html = new TextDecoder().decode(result.files.get('journal/hello/index.html'));
      expect(html).toContain('Another author');
      expect(html).toContain('/theme.css');
      expect(html).toContain('/custom.js');
      expect(html).toContain('shiki');
      expect(html).not.toContain('Link AI');
      expect(await readFile(join(root, '.tio-page/dist/theme.css'), 'utf8')).toBe(
        'body { color: teal; }',
      );
      await writeFile(
        configFile,
        `export default { workspaceId: 'space', template: () => ({ routes: [{ path: '/different-route', render: () => '<main>New template</main>' }] }) };`,
      );
      await buildSiteDirectory(root, join(root, '.tio-page/dist'));
      await expect(
        readFile(join(root, '.tio-page/dist/journal/hello/index.html')),
      ).rejects.toThrow();
      expect(
        await readFile(join(root, '.tio-page/dist/different-route/index.html'), 'utf8'),
      ).toContain('New template');
      await expect(buildSiteDirectory(root, join(root, 'workspaces'))).rejects.toThrow(
        'Output must not',
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
  it('highlights aliases and unknown languages without changing the document or shipping browser grammars', async () => {
    const document = page(code('js'));
    const before = structuredClone(document);
    const renderer = await createCodeRenderer([document, page(code('unknown-language'))]);
    const html = renderBlocks(document.blocks!, context(renderer.renderBlock));
    expect(html).toContain('--shiki-light');
    expect(html).toContain('--shiki-dark');
    expect(html).not.toContain('<hello>');
    expect(renderer.files.size).toBe(0);
    expect(renderer.scripts).toEqual([]);
    expect(document).toEqual(before);
    expect(renderBlocks([code('unknown-language')], context(renderer.renderBlock))).toContain(
      '<pre',
    );
  });
  it('honors persisted modes and configured labels, and only includes enabled preview runtimes', async () => {
    const block = code('html', 'split');
    const renderer = await createCodeRenderer([page(block)], {
      defaultMode: 'code',
      previews: ['html'],
      labels: { split: 'Side by side' },
    });
    const html = renderBlocks([block], context(renderer.renderBlock));
    expect(html).toContain('data-mode="split"');
    expect(html).toContain('Side by side');
    expect(renderer.files.size).toBe(1);
    expect(renderer.files.has('tio-code/client.js')).toBe(true);
    const disabled = await createCodeRenderer([page(block)], { previews: [] });
    expect(renderBlocks([block], context(disabled.renderBlock))).not.toContain('fieldset');
    expect(disabled.scripts).toEqual([]);
  });
});
