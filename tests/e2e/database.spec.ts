import { expect, test, type Page } from '@playwright/test';

import { repoRoot } from '../paths';

test.setTimeout(25000);

test.beforeEach(async ({ page }) => {
  await page.goto('/@fs' + repoRoot + '/packages/web-editor/dist/index.html');
  await page.waitForFunction(() => !!(window as any).TioEditor);
  await page.evaluate(async (root) => {
    const { MemoryRepository } = await import(root + '/packages/provider-memory/src/index.ts');
    const { sampleWorkspace } = await import(root + '/tests/fixtures/workspace.ts');
    const objects = sampleWorkspace('en');
    const database = objects.find((o: any) => o.type === 'database');
    database.fields.push({
      id: 'related',
      name: 'Related',
      type: 'relation',
      targetDatabaseId: database.id,
    });
    objects.find((o: any) => o.type === 'databaseView').visibleFieldIds = database.fields.map(
      (f: any) => f.id,
    );
    const repository = new MemoryRepository();
    await repository.commit({ id: 'seed', expectedVersion: 0, changes: objects, assetIds: [] });
    document.body.innerHTML = '<div id="editor"></div>';
    const editor = await (window as any).TioEditor.mountEditor(document.getElementById('editor'), {
      repository,
      workspaceId: objects[0].id,
      target: { id: database.id },
      presentation: { locale: 'en', theme: 'light' },
    });
    Object.assign(window, {
      databaseFixture: {
        editor,
        repository,
        databaseId: database.id,
        recordId: objects.find((o: any) => o.type === 'record').id,
      },
    });
  }, '/@fs' + repoRoot);
});

async function rowClick(page: Page, row: number) {
  const canvas = page.locator('canvas').first();
  await expect(canvas).toBeVisible();
  const bounds = await canvas.boundingBox();
  await page.mouse.click(bounds!.x + 15, bounds!.y + 38 + row * 42 + 21);
}
async function properties(page: Page) {
  return page.evaluate(async () => {
    const f = (window as any).databaseFixture;
    await f.editor.flush();
    const snapshot = await f.repository.readSnapshot();
    return snapshot.entries.find((e: any) => e.object.id === f.recordId).object.properties;
  });
}
async function openRecord(page: Page) {
  await page.evaluate(() => {
    const f = (window as any).databaseFixture;
    return f.editor.open({ id: f.recordId });
  });
}

test('external updates preserve unconfirmed reference edits and cancel reveals the latest value', async ({
  page,
}) => {
  await openRecord(page);
  const related = page.getByRole('group', { name: 'Related editor', exact: true });
  await related.getByRole('button', { name: 'Related', exact: true }).click();
  const search = page.getByRole('combobox', { name: 'Related', exact: true });
  await search.fill('Design');
  await page.getByRole('option', { name: 'Design a personal knowledge workspace' }).click();
  await search.press('Escape');
  await page.evaluate(async () => {
    const f = (window as any).databaseFixture;
    const snapshot = await f.repository.readSnapshot();
    const record = snapshot.entries.find((e: any) => e.object.id === f.recordId).object;
    await f.repository.commit({
      id: 'external-reference',
      expectedVersion: snapshot.version,
      assetIds: [],
      changes: [
        {
          ...record,
          properties: {
            ...record.properties,
            title: 'External record update',
            related: [f.recordId],
          },
        },
      ],
    });
  });
  await expect(page.getByRole('heading', { name: 'External record update' })).toBeVisible();
  await expect(related).toContainText('Design a personal knowledge workspace');
  await related.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(related).toContainText('External record update');
  await expect(related).not.toContainText('Design a personal knowledge workspace');
});

test('record drawer content supports typing, slash insertion and reopening', async ({ page }) => {
  await page.getByRole('button', { name: 'Add a record', exact: true }).click();
  const drawer = page.getByRole('dialog', { name: 'Record details', exact: true });
  const body = drawer.getByRole('region', { name: 'Record content', exact: true });
  const editor = body.locator('.bn-editor');
  await editor.click();
  await page.keyboard.insertText('Notes for this record');
  await page.keyboard.press('Enter');
  await page.keyboard.type('/heading');
  await page.getByRole('option', { name: 'Heading 2', exact: true }).first().click();
  await page.keyboard.insertText('Next steps');
  await expect(editor.getByRole('heading', { level: 2 })).toHaveText('Next steps');
  const id = await page.evaluate(async () => {
    const f = (window as any).databaseFixture;
    await f.editor.flush();
    return (await f.repository.readSnapshot()).entries.find(
      (e: any) => e.object.type === 'record' && e.object.properties.title === 'Untitled record',
    ).object.id;
  });
  await drawer.getByRole('button', { name: 'Close record', exact: true }).click();
  await page.evaluate(
    (recordId) => (window as any).databaseFixture.editor.open({ id: recordId }),
    id,
  );
  const reopened = page.getByRole('region', { name: 'Record content', exact: true });
  await expect(reopened).toContainText('Notes for this record');
  await expect(reopened.locator('.bn-editor').getByRole('heading', { level: 2 })).toHaveText(
    'Next steps',
  );
});

test('cell drafts and committed cells share keyboard and menu undo/redo without reopening the workspace', async ({
  page,
}) => {
  // Layout changes must not discard a cell's unconfirmed input (including
  // viewport changes while a mobile keyboard opens).
  const canvas = page.locator('canvas').first();
  await expect(canvas).toBeVisible();
  const bounds = await canvas.boundingBox();
  await page.mouse.dblclick(bounds!.x + 120, bounds!.y + 59);
  const cellEditor = page.getByRole('dialog', { name: 'Name', exact: true });
  const cellInput = cellEditor.getByRole('textbox', { name: 'Name', exact: true });
  await cellInput.fill('Unconfirmed cell draft');
  await page.evaluate(() => {
    window.dispatchEvent(new Event('resize'));
    window.dispatchEvent(new Event('scroll'));
  });
  await expect(cellInput).toHaveValue('Unconfirmed cell draft');
  await expect(cellInput).toBeFocused();
  await cellInput.press('Escape');
  await expect(cellEditor).toBeHidden();
  expect(Object.values(await properties(page))).not.toContain('Unconfirmed cell draft');
  await openRecord(page);
  const name = page.getByRole('group', { name: 'Name editor', exact: true });
  const input = name.getByRole('textbox', { name: 'Name', exact: true });
  const original = await input.inputValue();
  await input.fill('Changed draft');
  await input.press('ControlOrMeta+z');
  await expect(input).toHaveValue(original);
  await input.press('ControlOrMeta+Shift+z');
  await expect(input).toHaveValue('Changed draft');
  expect(Object.values(await properties(page))).toContain(original);
  await name.getByRole('button', { name: 'Done', exact: true }).click();
  await input.press('ControlOrMeta+z');
  await expect(input).toHaveValue(original);
  await page.getByRole('button', { name: 'More actions' }).click();
  await page.getByRole('menuitem', { name: 'Redo action', exact: true }).click();
  await expect(input).toHaveValue('Changed draft');
  await input.press('Control+y');
  await expect(input).toHaveValue('Changed draft');
  await page.evaluate(() => {
    const f = (window as any).databaseFixture;
    return f.editor.open({ id: f.databaseId });
  });
  await expect(page.locator('canvas').first()).toBeVisible();
  await rowClick(page, 0);
  await page.locator('canvas').first().focus();
  await page.keyboard.press('ControlOrMeta+z');
  await expect.poll(async () => Object.values(await properties(page))).toContain(original);
  await page.locator('canvas').first().focus();
  await page.keyboard.press('ControlOrMeta+Shift+z');
  await expect.poll(async () => Object.values(await properties(page))).toContain('Changed draft');
});
