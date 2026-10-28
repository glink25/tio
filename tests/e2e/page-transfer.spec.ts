import { readFile } from 'node:fs/promises';

import { expect, test, type Page } from '@playwright/test';
import { unzipSync, strFromU8 } from 'fflate';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';

import { repoRoot } from '../paths';

async function mount(page: Page, options = { long: false, asset: false }) {
  await page.goto('/@fs' + repoRoot + '/packages/web-editor/dist/index.html');
  await page.waitForFunction(() => !!(window as any).TioEditor);
  await page.evaluate(
    async ({ root, options }) => {
      const { MemoryRepository } = await import(root + '/packages/provider-memory/src/index.ts');
      const { object, textBlock } = await import(root + '/packages/core/src/index.ts');
      const repository = new MemoryRepository();
      const blocks = [
        {
          ...textBlock('Replace me'),
          id: 'start',
          extra: { retained: true },
          props: { future: 'preserved' },
        },
        { ...textBlock(''), id: 'opaque', type: 'future', children: [textBlock('Opaque child')] },
        {
          ...textBlock('source'),
          id: 'code',
          type: 'codeBlock',
          props: { language: 'html', displayMode: 'code' },
        },
      ];
      blocks.push({
        ...textBlock(''),
        id: 'mention',
        content: [
          { type: 'mention', props: { workspaceId: 'transfer', kind: 'page', id: 'destination' } },
        ],
      } as any);
      const changes = [object('workspace', 'transfer', { id: 'transfer', name: 'Transfer' })];
      if (options.long) {
        blocks.push({
          ...textBlock('中文标题与 English'),
          id: 'heading',
          type: 'heading',
          props: { level: 2 },
        } as any);
        for (let index = 0; index < 55; index++)
          blocks.push(
            textBlock(
              `第 ${index + 1} 段 中文可以选择复制。English text stays searchable. ` +
                '长文档分页验证。'.repeat(8),
            ) as any,
          );
        blocks.push({
          ...textBlock(''),
          type: 'table',
          content: {
            type: 'tableContent',
            headerRows: 1,
            rows: [
              {
                cells: [
                  [{ type: 'text', text: '表头', styles: {} }],
                  [{ type: 'text', text: 'Value', styles: {} }],
                ],
              },
              ...Array.from({ length: 30 }, (_, i) => ({
                cells: [
                  [{ type: 'text', text: `数据 ${i}`, styles: {} }],
                  [{ type: 'text', text: '中文内容', styles: {} }],
                ],
              })),
            ],
          },
        } as any);
      }
      if (options.asset) {
        const canvas = document.createElement('canvas');
        canvas.width = 320;
        canvas.height = 160;
        const paint = canvas.getContext('2d')!;
        paint.fillStyle = '#e6efff';
        paint.fillRect(0, 0, 320, 160);
        paint.fillStyle = '#203a60';
        paint.font = '24px sans-serif';
        paint.fillText('Tio image export', 32, 90);
        const bytes = Uint8Array.from(atob(canvas.toDataURL('image/png').split(',')[1]), (char) =>
          char.charCodeAt(0),
        );
        await repository.stageAsset('pic', { name: '图片.png', mime: 'image/png', bytes });
        changes.push(
          object('asset', 'transfer', {
            id: 'pic',
            filename: '图片.png',
            mime: 'image/png',
            byteSize: bytes.length,
            assetPath: 'assets/pic.png',
          }),
        );
        blocks.push({
          ...textBlock(''),
          type: 'image',
          props: { url: 'asset:pic', caption: '图片说明' },
        } as any);
      }
      changes.push(object('page', 'transfer', { id: 'main', title: '页面导出', blocks }));
      changes.push(
        object('page', 'transfer', {
          id: 'destination',
          title: 'Destination',
          blocks: [textBlock('')],
        }),
      );
      await repository.commit({
        id: 'seed',
        expectedVersion: 0,
        changes,
        assetIds: options.asset ? ['pic'] : [],
      });
      document.body.innerHTML = '<div id="editor"></div>';
      const handle = await (window as any).TioEditor.mountEditor(
        document.getElementById('editor'),
        {
          repository,
          workspaceId: 'transfer',
          target: { id: 'main' },
          presentation: { locale: 'en', theme: 'light' },
        },
      );
      (window as any).transfer = { repository, handle };
    },
    { root: '/@fs' + repoRoot, options },
  );
  await expect(page.locator('[data-id="start"] .bn-inline-content')).toContainText('Replace me');
}

async function pasteData(page: Page, data: Record<string, string>) {
  await page.locator('.bn-editor').evaluate((element, data) => {
    const clipboardData = new DataTransfer();
    for (const [type, value] of Object.entries(data)) clipboardData.setData(type, value);
    element.dispatchEvent(
      new ClipboardEvent('paste', { clipboardData, bubbles: true, cancelable: true }),
    );
  }, data);
}
async function replaceStart(page: Page, data: Record<string, string>) {
  const first = page.locator('[data-id="start"] .bn-inline-content');
  await first.click();
  await first.evaluate((element) => {
    const editor = (element.closest('.bn-editor') as any).editor;
    editor.state.doc.descendants((node: any, position: number) => {
      if (node.isText && node.text === 'Replace me')
        editor.commands.setTextSelection({ from: position, to: position + node.text.length });
    });
  });
  await pasteData(page, data);
}
async function savedBlocks(page: Page, id = 'main') {
  return page.evaluate(async (id) => {
    const { repository, handle } = (window as any).transfer;
    await handle.flush();
    const snapshot = await repository.readSnapshot();
    return snapshot.entries.find((entry: any) => entry.object.id === id).object.blocks;
  }, id);
}

test('pastes HTML source as structured content, undoes it and reopens persisted blocks', async ({
  page,
}) => {
  await mount(page);
  await replaceStart(page, {
    'text/plain':
      '<h2>导入标题</h2><p>Hello <strong>world</strong></p><script>window.injected=true</script>',
  });
  await expect(page.locator('.bn-editor')).toContainText('导入标题');
  const blocks = await savedBlocks(page);
  expect(blocks.some((b: any) => b.type === 'heading')).toBe(true);
  expect(JSON.stringify(blocks)).toContain('"bold":true');
  expect(await page.evaluate(() => (window as any).injected)).toBeUndefined();
  await page.keyboard.press('ControlOrMeta+z');
  await expect(page.locator('.bn-editor')).not.toContainText('导入标题');
  await page.keyboard.press('ControlOrMeta+Shift+z');
  await savedBlocks(page);
  await page.evaluate(async () => {
    const { handle } = (window as any).transfer;
    await handle.open({ id: 'destination' });
    await handle.open({ id: 'main' });
  });
  await expect(page.locator('.bn-editor')).toContainText('导入标题');
});

test('distinguishes Markdown, rich HTML, fenced HTML, code and plain paste', async ({ page }) => {
  await mount(page);
  await replaceStart(page, {
    'text/plain': '# Markdown\n\n- one\n- two\n\n```html\n<b>code</b>\n```',
  });
  let blocks = await savedBlocks(page);
  expect(blocks.some((b: any) => b.type === 'heading')).toBe(true);
  expect(blocks.some((b: any) => b.type === 'bulletListItem')).toBe(true);
  expect(
    blocks.some(
      (b: any) => b.type === 'codeBlock' && JSON.stringify(b.content).includes('<b>code</b>'),
    ),
  ).toBe(true);
  await page.locator('[data-id="code"] .bn-inline-content').click();
  await page.locator('.bn-editor').evaluate((element) => {
    const editor = (element as any).editor;
    editor.state.doc.descendants((node: any, position: number) => {
      if (node.isText && node.text === 'source') editor.commands.setTextSelection(position);
    });
  });
  await pasteData(page, { 'text/plain': '<h1>Literal</h1>' });
  blocks = await savedBlocks(page);
  expect(JSON.stringify(blocks.find((b: any) => b.id === 'code').content)).toContain(
    '<h1>Literal</h1>',
  );
  await page.keyboard.press('ControlOrMeta+z');
  await page.locator('.bn-editor').evaluate((element) => {
    const editor = (element as any).editor;
    editor.commands.setTextSelection(3);
  });
  await pasteData(page, { 'text/plain': '**plain**', 'text/html': '<p><em>Rich HTML</em></p>' });
  expect(JSON.stringify(await savedBlocks(page))).toContain('Rich HTML');
  await page.keyboard.down('Shift');
  await pasteData(page, { 'text/plain': '# Literal Markdown' });
  await page.keyboard.up('Shift');
  await expect(page.locator('.bn-editor')).toContainText('# Literal Markdown');
});

test('native copying preserves unknown fields and creates independent IDs', async ({ page }) => {
  await mount(page);
  const data = await page.locator('.bn-editor').evaluate((element) => {
    const editor = (element as any).editor;
    editor.commands.selectAll();
    const clipboardData = new DataTransfer();
    element.dispatchEvent(
      new ClipboardEvent('copy', { clipboardData, bubbles: true, cancelable: true }),
    );
    return Object.fromEntries(
      [...clipboardData.types].map((type) => [type, clipboardData.getData(type)]),
    );
  });
  expect(data['blocknote/html']).toContain('data-tio-metadata');
  await page.evaluate(async () => (window as any).transfer.handle.open({ id: 'destination' }));
  await page.locator('.bn-editor').click();
  await pasteData(page, data);
  await page
    .locator('.bn-editor')
    .evaluate((element) => (element as any).editor.commands.setTextSelection(3));
  await pasteData(page, data);
  const blocks = await savedBlocks(page, 'destination');
  const copied = blocks.filter(
    (b: any) => b.extra?.retained && JSON.stringify(b.content).includes('Replace me'),
  );
  expect(copied).toHaveLength(2);
  expect(copied.every((b: any) => b.props.future === 'preserved')).toBe(true);
  expect(new Set(blocks.map((b: any) => b.id)).size).toBe(blocks.length);
  const opaque = blocks.filter((b: any) => b.type === 'future');
  expect(opaque).toHaveLength(2);
  expect(opaque.every((b: any) => b.children.length === 1)).toBe(true);
  expect(opaque[0].children[0].id).not.toBe(opaque[1].children[0].id);
  expect(JSON.stringify(blocks)).toContain('"workspaceId":"transfer"');
});

test('exports latest read-only Markdown without loading PDF or fonts', async ({ page }) => {
  const requested: string[] = [];
  page.on('request', (request) => requested.push(request.url()));
  await mount(page);
  await page.getByLabel('Page title', { exact: true }).fill('Latest title');
  await page.evaluate(() => (window as any).transfer.handle.setPresentation({ readOnly: true }));
  await page.getByRole('button', { name: 'More actions', exact: true }).click();
  const pending = page.waitForEvent('download');
  await page.getByRole('menuitem', { name: 'Export', exact: true }).hover();
  await page.getByRole('menuitem', { name: 'Markdown', exact: true }).click();
  const download = await pending;
  expect(download.suggestedFilename()).toBe('Latest title.md');
  const markdown = await readFile((await download.path())!, 'utf8');
  expect(markdown).toContain('# Latest title');
  expect(markdown).toContain('Destination');
  expect(requested.some((url) => /export-pdf-|\.otf(?:\?|$)/.test(url))).toBe(false);
});

test('exports only referenced attachments alongside Markdown', async ({ page }) => {
  await mount(page, { long: false, asset: true });
  await page.getByRole('button', { name: 'More actions', exact: true }).click();
  const pending = page.waitForEvent('download');
  await page.getByRole('menuitem', { name: 'Export', exact: true }).hover();
  await page.getByRole('menuitem', { name: 'Markdown', exact: true }).click();
  const download = await pending;
  expect(download.suggestedFilename()).toBe('页面导出.zip');
  const files = unzipSync(await readFile((await download.path())!));
  expect(Object.keys(files)).toEqual(['assets/pic-图片.png', '页面导出.md']);
  expect(strFromU8(files['页面导出.md'])).toContain('assets/pic-图片.png');
});

test('downloads a searchable, paginated Chinese PDF and loads fonts only on demand', async ({
  page,
}, testInfo) => {
  test.setTimeout(120_000);
  const requested: string[] = [];
  page.on('request', (request) => requested.push(request.url()));
  await mount(page, { long: true, asset: true });
  expect(requested.some((url) => /export-pdf-|\.otf(?:\?|$)/.test(url))).toBe(false);
  await page.getByRole('button', { name: 'More actions', exact: true }).click();
  const pending = page.waitForEvent('download', { timeout: 100_000 });
  await page.getByRole('menuitem', { name: 'Export', exact: true }).hover();
  await page.getByRole('menuitem', { name: 'PDF', exact: true }).click();
  const download = await pending;
  const path = testInfo.outputPath('page-export.pdf');
  await download.saveAs(path);
  expect(download.suggestedFilename()).toBe('页面导出.pdf');
  const loading = getDocument({
    data: new Uint8Array(await readFile(path)),
    useSystemFonts: false,
  });
  const document = await loading.promise;
  expect(document.numPages).toBeGreaterThan(2);
  let text = '';
  for (let index = 1; index <= document.numPages; index++) {
    const content = await (await document.getPage(index)).getTextContent();
    text += content.items.map((item) => ('str' in item ? item.str : '')).join('');
  }
  expect(text).toContain('页面导出');
  expect(text).toContain('中文可以选择复制');
  expect(text).toContain('English text stays searchable');
  expect(text).toContain('数据 29');
  for (const weight of ['Regular', 'Bold']) {
    expect(requested).toContain(
      `https://cdn.jsdelivr.net/gh/notofonts/noto-cjk@Sans2.004/Sans/SubsetOTF/SC/NotoSansSC-${weight}.otf`,
    );
  }
  await loading.destroy();
});
