import { readFile } from 'node:fs/promises';

import { expect, test, type Page } from '@playwright/test';
import { zipSync, strToU8 } from 'fflate';

import { repoRoot } from '../paths';

async function mount(page: Page, target = 'main') {
  await page.goto('/@fs' + repoRoot + '/packages/web-editor/dist/index.html');
  await page.waitForFunction(() => !!(window as any).TioEditor);
  await page.evaluate(
    async ({ root, target }) => {
      const { MemoryRepository } = await import(root + '/packages/provider-memory/src/index.ts');
      const { object, textBlock } = await import(root + '/packages/core/src/index.ts');
      const repository = new MemoryRepository();
      await repository.commit({
        id: 'seed',
        expectedVersion: 0,
        assetIds: [],
        changes: [
          object('workspace', 'files', { id: 'files', name: 'Files' }),
          object('page', 'files', {
            id: 'main',
            title: 'Parent',
            blocks: [textBlock('Keep parent')],
          }),
          object('database', 'files', {
            id: 'db',
            name: 'Original',
            fields: [
              { id: 'title', name: 'Name', type: 'title' },
              { id: 'value', name: 'Value', type: 'text' },
            ],
          }),
          object('databaseView', 'files', {
            id: 'view',
            databaseId: 'db',
            name: 'View',
            layout: 'table',
            visibleFieldIds: ['title', 'value'],
            filters: [],
            sorts: [],
          }),
          object('record', 'files', {
            id: 'one',
            databaseId: 'db',
            properties: { title: 'one', value: '12' },
            blocks: [],
          }),
          object('record', 'files', {
            id: 'two',
            databaseId: 'db',
            properties: { title: 'two', value: 'bad' },
            blocks: [],
          }),
        ],
      });
      document.body.innerHTML = '<div id="editor"></div>';
      const errors: string[] = [];
      let handle: any;
      handle = await (window as any).TioEditor.mountEditor(document.getElementById('editor'), {
        repository,
        workspaceId: 'files',
        target: { id: target },
        presentation: { locale: 'en', theme: 'light' },
        onNavigate: (next: any) => {
          void handle.open(next);
        },
        onError: (e: any) => errors.push(String(e)),
      });
      (window as any).files = { repository, handle, errors };
    },
    { root: '/@fs' + repoRoot, target },
  );
  await expect(page.getByRole('textbox', { name: 'Page title', exact: true })).toHaveValue(
    target === 'db' ? 'Original' : 'Parent',
  );
}
async function submenu(page: Page, action: 'Import' | 'Export') {
  await page.getByRole('button', { name: 'More actions', exact: true }).click();
  await page.getByRole('menuitem', { name: action, exact: true }).hover();
}
async function upload(page: Page, format: string, name: string, buffer: Buffer) {
  await submenu(page, 'Import');
  const choice = page.waitForEvent('filechooser');
  await page.getByRole('menuitem', { name: format, exact: true }).click();
  await (await choice).setFiles({ name, mimeType: 'application/octet-stream', buffer });
}
async function snapshot(page: Page) {
  return page.evaluate(async () => {
    await (window as any).files.handle.flush();
    return (await (window as any).files.repository.readSnapshot()).entries.map(
      (e: any) => e.object,
    );
  });
}

test('imports Markdown ZIP as child pages with attachments and reopens persisted content', async ({
  page,
}) => {
  await mount(page);
  const image = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6k1AAAAAASUVORK5CYII=',
    'base64',
  );
  const bytes = zipSync({
    'Child.md': strToU8(
      '# Child\n\n**Imported**\n\n![image](assets/image.png)\n\n[Next](Second.md)\n\n```html\n<h1>code</h1>\n```',
    ),
    'Second.md': strToU8('# Second\n\nSecond content'),
    'assets/image.png': image,
  });
  await upload(page, 'Markdown', 'Pages.zip', Buffer.from(bytes));
  await expect(page.getByRole('textbox', { name: 'Page title', exact: true })).toHaveValue('Child');
  const objects = await snapshot(page);
  const child = objects.find((o: any) => o.title === 'Child');
  const second = objects.find((o: any) => o.title === 'Second');
  expect(child.parentId).toBe('main');
  expect(second.parentId).toBe('main');
  expect(child.blocks.some((b: any) => b.type === 'heading')).toBe(false);
  expect(child.blocks.find((b: any) => b.type === 'image').props.url).toMatch(/^asset:/);
  expect(JSON.stringify(child.blocks)).toContain(second.id);
  expect(child.blocks.find((b: any) => b.type === 'codeBlock').props.displayMode).toBe('code');
  expect(objects.find((o: any) => o.id === 'main').blocks[0].content[0].text).toBe('Keep parent');
  await page.evaluate(async (id) => {
    await (window as any).files.handle.open({ id: 'main' });
    await (window as any).files.handle.open({ id });
  }, child.id);
  await expect(page.locator('.bn-editor')).toContainText('Imported');
  await page.getByRole('button', { name: 'More actions', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Undo action', exact: true }).click();
  const undone = await snapshot(page);
  expect(undone.find((o: any) => o.id === child.id).deleted).toBe(true);
  expect(undone.find((o: any) => o.id === second.id).deleted).toBe(true);
  expect(undone.find((o: any) => o.type === 'asset').deleted).toBe(true);
  await page.evaluate(() => (window as any).files.handle.open({ id: 'main' }));
  await expect(page.getByRole('textbox', { name: 'Page title', exact: true })).toHaveValue(
    'Parent',
  );
  await page.getByRole('button', { name: 'More actions', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Redo action', exact: true }).click();
  const redone = await snapshot(page);
  expect(redone.find((o: any) => o.id === child.id).deleted).not.toBe(true);
  expect(redone.find((o: any) => o.type === 'asset').deleted).not.toBe(true);
  expect(await page.evaluate(() => (window as any).files.errors)).toEqual([]);
});

test('imports inferred CSV child database, exports CSV and typed XLSX, then restores XLSX', async ({
  page,
}) => {
  const requests: string[] = [];
  page.on('request', (r) => requests.push(r.url()));
  await mount(page, 'db');
  expect(requests.some((url) => /exceljs|papaparse|\/xlsx-|\/csv-/.test(url))).toBe(false);
  await upload(
    page,
    'CSV',
    'Imported.csv',
    Buffer.from('Name,Count,Flag,Code\r\na,12,true,001\r\nb,13,false,002'),
  );
  await expect(page.getByRole('textbox', { name: 'Page title', exact: true })).toHaveValue(
    'Imported',
  );
  let objects = await snapshot(page);
  const db = objects.find((o: any) => o.name === 'Imported' && o.type === 'database');
  expect(db.parentId).toBe('db');
  expect(db.fields.map((f: any) => f.type)).toEqual(['title', 'number', 'boolean', 'text']);
  await submenu(page, 'Export');
  const csvDownload = page.waitForEvent('download');
  await page.getByRole('menuitem', { name: 'CSV', exact: true }).click();
  expect(
    (await readFile((await (await csvDownload).path())!, 'utf8')).replace(/^\uFEFF/, ''),
  ).toContain('a,12,true,001');
  await submenu(page, 'Export');
  const xlsxDownload = page.waitForEvent('download');
  await page.getByRole('menuitem', { name: 'XLSX', exact: true }).click();
  const bytes = await readFile((await (await xlsxDownload).path())!);
  await page.evaluate(async () => (window as any).files.handle.open({ id: 'db' }));
  await expect(page.getByRole('textbox', { name: 'Page title', exact: true })).toHaveValue(
    'Original',
  );
  await upload(page, 'XLSX', 'Restored.xlsx', bytes);
  await expect(page.getByRole('textbox', { name: 'Page title', exact: true })).toHaveValue(
    'Restored',
  );
  objects = await snapshot(page);
  const restored = objects.find((o: any) => o.name === 'Restored');
  expect(restored.fields.map((f: any) => f.type)).toEqual(['title', 'number', 'boolean', 'text']);
  expect(
    objects.filter((o: any) => o.databaseId === restored.id && o.type === 'record'),
  ).toHaveLength(2);
  expect(await page.evaluate(() => (window as any).files.errors)).toEqual([]);
});

test('changes a property type, clears invalid cells and restores both with undo', async ({
  page,
}) => {
  await mount(page, 'db');
  await page.getByRole('button', { name: 'View settings', exact: true }).last().click();
  await page.getByRole('button', { name: 'Properties', exact: true }).click();
  await page.getByRole('button', { name: 'Value', exact: true }).click();
  await page.getByRole('combobox', { name: 'Property type', exact: true }).click();
  await page.getByRole('option', { name: 'Number', exact: true }).click();
  await page.getByRole('button', { name: 'Done', exact: true }).click();
  await expect
    .poll(async () => (await snapshot(page)).find((o: any) => o.id === 'db').fields[1].type)
    .toBe('number');
  let objects = await snapshot(page);
  expect(objects.find((o: any) => o.id === 'one').properties.value).toBe(12);
  expect(objects.find((o: any) => o.id === 'two').properties.value).toBeNull();
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'More actions', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Undo action', exact: true }).click();
  objects = await snapshot(page);
  expect(objects.find((o: any) => o.id === 'db').fields[1].type).toBe('text');
  expect(objects.find((o: any) => o.id === 'two').properties.value).toBe('bad');
});

test('read-only pages disable import and keep export available', async ({ page }) => {
  await mount(page, 'db');
  await page.evaluate(() => (window as any).files.handle.setPresentation({ readOnly: true }));
  await page.getByRole('button', { name: 'More actions', exact: true }).click();
  await expect(page.getByRole('menuitem', { name: 'Import', exact: true })).toHaveAttribute(
    'data-disabled',
  );
  await expect(page.getByRole('menuitem', { name: 'Export', exact: true })).not.toHaveAttribute(
    'data-disabled',
  );
});
