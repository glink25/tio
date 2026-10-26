import { test, expect, type Page } from '@playwright/test';

async function state(page: Page, key: string) {
  return page.evaluate(
    (field) =>
      (window as any).databaseFixture.handle.getSaveState().objects.find((o: any) => o.id === 'r')
        .properties[field],
    key,
  );
}
async function openRecord(page: Page) {
  await page.evaluate(async () => {
    await (window as any).databaseFixture.handle.open({ id: 'r' });
  });
  await expect(page.getByRole('textbox', { name: 'Name', exact: true })).toBeVisible();
}
test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto('/@fs' + process.cwd() + '/packages/web-editor/dist/index.html');
  await page.waitForFunction(() => !!(window as any).TioEditor);
  await page.evaluate(async (root) => {
    const { MemoryRepository } = await import(root + '/packages/provider-memory/src/index.ts');
    const fields = [
      { id: 'title', type: 'title', name: 'Name' },
      { id: 'cost', type: 'number', name: 'Cost' },
      { id: 'date', type: 'date', name: 'Date' },
      {
        id: 'status',
        type: 'status',
        name: 'Status',
        options: [
          { id: 'todo', label: 'To do', color: 'gray', group: 'todo' },
          { id: 'done', label: 'Done', color: 'green', group: 'done' },
        ],
      },
      { id: 'files', type: 'files', name: 'Files' },
      { id: 'links', type: 'relation', name: 'Tasks', targetDatabaseId: 'tasks' },
      {
        id: 'total',
        type: 'rollup',
        name: 'Total',
        rollup: { relationFieldId: 'links', targetFieldId: 'cost', operation: 'sum' },
      },
      { id: 'formula', type: 'formula', name: 'Doubled', formula: 'prop("cost") * 2' },
      { id: 'created', type: 'createdTime', name: 'Created' },
    ];
    const objects = [
      { id: 'd', type: 'database', name: 'Database fields', fields },
      {
        id: 'v',
        type: 'databaseView',
        databaseId: 'd',
        name: 'Table',
        layout: 'table',
        filters: [],
        sorts: [],
        visibleFieldIds: fields.map((f) => f.id),
      },
      {
        id: 'r',
        type: 'record',
        databaseId: 'd',
        properties: { title: 'Example', cost: 12, status: 'todo', links: [] },
        blocks: [],
        createdAt: '2026-10-26T00:00:00Z',
        updatedAt: '2026-10-26T00:00:00Z',
      },
      {
        id: 'tasks',
        type: 'database',
        name: 'Tasks database',
        fields: [
          { id: 'title', name: 'Name', type: 'title' },
          { id: 'cost', name: 'Cost', type: 'number' },
        ],
      },
      {
        id: 'task1',
        type: 'record',
        databaseId: 'tasks',
        properties: { title: 'Linked task', cost: 8 },
        blocks: [],
      },
    ].map((o) => ({ workspaceId: 'w', schemaVersion: 1, ...o }));
    const repository = new MemoryRepository();
    await repository.commit({ id: 'seed', expectedVersion: 0, changes: objects, assetIds: [] });
    document.body.innerHTML = '<div id="database-editor" style="margin:24px"></div>';
    const handle = await (window as any).TioEditor.mountEditor(
      document.getElementById('database-editor'),
      {
        repository,
        workspaceId: 'w',
        target: { id: 'd' },
        presentation: { theme: 'light', locale: 'en' },
      },
    );
    Object.assign(window, { databaseFixture: { handle, repository } });
  }, '/@fs' + process.cwd());
  await expect(page.locator('canvas').first()).toBeVisible();
});
test('grid drafts commit/cancel, keyboard anchors, selected header and compact overlays', async ({
  page,
}) => {
  const canvas = page.locator('canvas').first();
  const bounds = (await canvas.boundingBox())!;
  const point = { x: bounds.x + 310, y: bounds.y + 59 };
  await page.mouse.dblclick(point.x, point.y);
  const input = page
    .getByRole('dialog', { name: 'Cost', exact: true })
    .getByRole('textbox', { name: 'Cost', exact: true });
  await expect(input).toBeVisible();
  await input.fill('1.5');
  expect(await state(page, 'cost')).toBe(12);
  await input.press('Enter');
  await expect.poll(() => state(page, 'cost')).toBe(1.5);
  await page.mouse.dblclick(point.x, point.y);
  await input.fill('-');
  await input.press('Enter');
  await expect(page.getByRole('alert')).toBeVisible();
  expect(await state(page, 'cost')).toBe(1.5);
  await input.press('Escape');
  await expect(page.getByRole('dialog', { name: 'Cost', exact: true })).toHaveCount(0);
  await canvas.focus();
  await page.keyboard.press('Enter');
  await expect(input).toBeVisible();
  const popover = page.getByRole('dialog', { name: 'Cost', exact: true });
  const layout = await popover.boundingBox(),
    child = await input.boundingBox();
  expect(layout!.width).toBeLessThanOrEqual(300);
  expect(layout!.width - child!.width).toBeLessThan(40);
  expect(Math.abs(layout!.x - (bounds.x + 270))).toBeLessThan(25);
  await page.screenshot({ path: 'test-results/database-edit-light.png', fullPage: true });
  await page.keyboard.press('Escape');
  await page.mouse.click(bounds.x + 310, bounds.y + 15);
  await expect(page.getByRole('menu')).toBeVisible();
  await page.screenshot({ path: 'test-results/database-header-light.png', fullPage: true });
  await page.keyboard.press('Escape');
  const create = page.getByRole('button', { name: 'New', exact: true });
  const foreground = await create.evaluate((node) => getComputedStyle(node).color);
  expect(foreground).toBe('rgb(255, 255, 255)');
  await page.evaluate(() =>
    (window as any).databaseFixture.handle.setPresentation({ theme: 'dark' }),
  );
  await expect(page.locator('.tio-editor')).toHaveClass(/dark/);
  await page.mouse.click(bounds.x + 310, bounds.y + 15);
  await page.screenshot({ path: 'test-results/database-header-dark.png', fullPage: true });
});
test('record dates, searchable relations, aggregates and local file upload/download', async ({
  page,
}) => {
  await openRecord(page);
  const date = page.getByRole('group', { name: 'Date editor', exact: true });
  await date.getByLabel('Date', { exact: true }).fill('2026-10-26');
  await date.getByLabel('Include time').check();
  await date.getByLabel('End date', { exact: true }).check();
  await date.getByLabel('End', { exact: true }).fill('2026-10-27T10:00');
  await date.getByLabel('Time zone', { exact: true }).fill('Asia/Shanghai');
  await date.getByRole('button', { name: 'Done', exact: true }).click();
  expect(await state(page, 'date')).toEqual({
    start: '2026-10-26T09:00:00+08:00',
    end: '2026-10-27T10:00:00+08:00',
    timeZone: 'Asia/Shanghai',
  });
  const tasks = page.getByRole('group', { name: 'Tasks editor', exact: true });
  await tasks.getByLabel('Search options or records').fill('Linked');
  await tasks.getByRole('option', { name: 'Linked task', exact: true }).click();
  await tasks.getByRole('button', { name: 'Done', exact: true }).click();
  expect(await state(page, 'links')).toEqual(['task1']);
  const total = page
    .locator('div.grid')
    .filter({ has: page.locator('span', { hasText: /^Total$/ }) });
  await expect(total).toContainText('8');
  const files = page.getByRole('group', { name: 'Files editor', exact: true });
  await files.getByLabel('Upload files (up to 20 MB each)').setInputFiles({
    name: 'example.txt',
    mimeType: 'text/plain',
    buffer: Buffer.from('hello from a database attachment'),
  });
  await expect(files).toContainText('example.txt');
  await files.getByRole('button', { name: 'Done', exact: true }).click();
  await expect(files.getByRole('link', { name: 'Download' })).toBeVisible();
  const download = page.waitForEvent('download');
  await files.getByRole('link', { name: 'Download' }).click();
  expect((await download).suggestedFilename()).toBe('example.txt');
  await page.evaluate(async () => {
    const f = (window as any).databaseFixture;
    await f.handle.flush();
    await f.handle.open({ id: 'd' });
    await f.handle.open({ id: 'r' });
  });
  await expect(page.getByRole('group', { name: 'Files editor' })).toContainText('example.txt');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: 'test-results/database-record-mobile.png', fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.evaluate(() =>
    (window as any).databaseFixture.handle.setPresentation({ readOnly: true }),
  );
  await expect(page.getByRole('textbox', { name: 'Name', exact: true })).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'Download' })).toBeVisible();
});
test('property configuration offers formula preview and persists stable references', async ({
  page,
}) => {
  await page.getByRole('button', { name: 'View settings', exact: true }).last().click();
  await page.getByRole('button', { name: 'Properties', exact: true }).click();
  await page.getByRole('button', { name: 'Add property', exact: true }).click();
  await page.getByLabel('Property name', { exact: true }).fill('Calculation');
  await page.getByLabel('New property type').selectOption('formula');
  await page.getByLabel('Formula', { exact: true }).fill('prop("Cost") + 3');
  await expect(page.getByLabel('Preview', { exact: true }).last()).toHaveText('15');
  await page.screenshot({ path: 'test-results/database-formula-preview.png', fullPage: true });
  await page.getByRole('button', { name: 'Done', exact: true }).click();
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (window as any).databaseFixture.handle
            .getSaveState()
            .objects.find((o: any) => o.id === 'd')
            .fields.find((f: any) => f.name === 'Calculation')?.formula,
      ),
    )
    .toContain('prop("cost")');
});
