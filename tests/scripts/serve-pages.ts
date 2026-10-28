import { copyFile, mkdir, readFile, rm } from 'node:fs/promises';
import { createServer } from 'node:http';
import { extname, join, resolve } from 'node:path';

import { buildSiteDirectory, folderContent } from '@glink25/tio-pages/node';
import { chromium } from '@playwright/test';
import { object, type Block } from '@tio/core';

import { repoRoot, testsRoot } from '../paths';

process.env.PUPPETEER_EXECUTABLE_PATH ??= chromium.executablePath();
const root = join(testsRoot, '.cache/pages-browser');
await rm(root, { recursive: true, force: true });
await mkdir(join(root, '.tio-page'), { recursive: true });
await copyFile(join(testsRoot, 'fixtures/pages/config.ts'), join(root, '.tio-page/config.ts'));
await copyFile(
  join(repoRoot, 'examples/blog/.tio-page/style.css'),
  join(root, '.tio-page/style.css'),
);
const code = (id: string, language: string, displayMode: string, source: string): Block => ({
  id,
  type: 'codeBlock',
  props: { language, displayMode },
  content: [{ type: 'text', text: source, styles: {} }],
  children: [],
});
const content = folderContent(root, 'pages-test');
await content.write(object('workspace', 'pages-test', { id: 'pages-test', name: 'Preview tests' }));
const blocks = ['code', 'preview', 'split'].flatMap((mode) => [
  code(
    'html-' + mode,
    'html',
    mode,
    '<h1>HTML preview</h1><script>try { parent.document.body.dataset.escape = "yes" } catch {}</script>',
  ),
  code('mermaid-' + mode, 'mermaid', mode, 'graph LR\n  A[Start] --> B[Finish]'),
]);
blocks.push(code('highlight', 'js', 'code', '  const message = "hello";\n'));
await content.write(object('page', 'pages-test', { id: 'modes', title: 'Code modes', blocks }));
await content.write(
  object('page', 'pages-test', {
    id: 'lazy',
    title: 'Lazy preview',
    blocks: [code('lazy-mermaid', 'mermaid', 'code', 'graph LR\n  A --> B')],
  }),
);
const output = join(root, '.tio-page/dist');
await buildSiteDirectory(root, output);
createServer((request, response) => {
  void (async () => {
    try {
      const path = decodeURIComponent(new URL(request.url!, 'http://localhost').pathname);
      let file = resolve(output, '.' + path);
      if (!file.startsWith(output + '/') && file !== output) throw new Error('Invalid path');
      if (!extname(file)) file = join(file, 'index.html');
      response.setHeader(
        'Content-Type',
        extname(file) === '.js'
          ? 'text/javascript'
          : extname(file) === '.css'
            ? 'text/css'
            : extname(file) === '.svg'
              ? 'image/svg+xml'
              : 'text/html',
      );
      response.end(await readFile(file));
    } catch {
      response.writeHead(404).end();
    }
  })();
}).listen(Number(process.env.TIO_PAGES_TEST_PORT ?? 6790), '127.0.0.1');
