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
    database.fields.push(
      { id: 'mention', name: 'Mention', type: 'mention' },
      { id: 'related', name: 'Related', type: 'relation', targetDatabaseId: database.id },
      {
        id: 'single',
        name: 'Single',
        type: 'relation',
        targetDatabaseId: database.id,
        multiple: false,
      },
    );
    objects.find((o: any) => o.type === 'databaseView').visibleFieldIds = database.fields.map(
      (f: any) => f.id,
    );
    const deniedDeletes = new Set<string>();
    const repository = new MemoryRepository();
    await repository.commit({ id: 'seed', expectedVersion: 0, changes: objects, assetIds: [] });
    document.body.innerHTML = '<div id="editor"></div>';
    const editor = await (window as any).TioEditor.mountEditor(document.getElementById('editor'), {
      repository,
      access: {
        version: 'test',
        allows: (resource: any, operation: string) =>
          operation !== 'delete' || !deniedDeletes.has(resource.id),
      },
      workspaceId: objects[0].id,
      target: { id: database.id },
      presentation: { locale: 'en', theme: 'light' },
    });
    Object.assign(window, {
      databaseFixture: {
        editor,
        repository,
        deniedDeletes,
        databaseId: database.id,
        recordId: objects.find((o: any) => o.type === 'record').id,
        homeId: objects.find((o: any) => o.type === 'page').id,
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

test('row selection deletes a batch, supports one undo and clears on search', async ({ page }) => {
  const canvas = page.locator('canvas').first();
  await expect(canvas).toBeVisible();
  const before = await canvas.boundingBox();
  await rowClick(page, 0);
  await expect(page.getByText('1 selected', { exact: true })).toBeVisible();
  expect(await canvas.boundingBox()).toEqual(before);
  await rowClick(page, 1);
  await expect(page.getByText('2 selected', { exact: true })).toBeVisible();
  await page
    .getByRole('region', { name: 'Row actions' })
    .getByRole('button', { name: 'Delete record' })
    .click();
  await expect
    .poll(() =>
      page.evaluate(async () => {
        const f = (window as any).databaseFixture;
        await f.editor.flush();
        return (await f.repository.readSnapshot()).entries.filter(
          (e: any) => e.object.type === 'record' && e.object.deleted,
        ).length;
      }),
    )
    .toBe(2);
  await page.getByRole('button', { name: 'More actions' }).click();
  await page.getByRole('menuitem', { name: 'Undo' }).click();
  await expect
    .poll(() =>
      page.evaluate(async () => {
        const f = (window as any).databaseFixture;
        await f.editor.flush();
        return (await f.repository.readSnapshot()).entries.filter(
          (e: any) => e.object.type === 'record' && !e.object.deleted,
        ).length;
      }),
    )
    .toBe(3);
  await rowClick(page, 0);
  await page.getByRole('button', { name: 'Search records…' }).click();
  await page.getByRole('textbox', { name: 'Search records…' }).fill('Collect');
  await expect(page.getByRole('region', { name: 'Row actions' })).toHaveCount(0);
});

test('reference forms keep choices as drafts until done, cancel and clear', async ({ page }) => {
  await openRecord(page);
  const mention = page.getByRole('group', { name: 'Mention editor', exact: true });
  await mention.getByRole('button', { name: 'Mention', exact: true }).click();
  const search = page.getByRole('combobox', { name: 'Mention', exact: true });
  await search.fill('Quick');
  await page.getByRole('option', { name: 'Quick notes' }).click();
  expect((await properties(page)).mention).toBeUndefined();
  await search.press('Escape');
  await mention.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(mention.getByRole('button', { name: 'Remove Mention' })).toHaveCount(0);
  await mention.getByRole('button', { name: 'Mention', exact: true }).click();
  await search.fill('Quick');
  await search.press('ArrowDown');
  await search.press('Enter');
  await search.press('Escape');
  await mention.getByRole('button', { name: 'Done', exact: true }).click();
  expect((await properties(page)).mention.kind).toBe('page');
  const related = page.getByRole('group', { name: 'Related editor', exact: true });
  await related.getByRole('button', { name: 'Related', exact: true }).click();
  await page.getByRole('combobox', { name: 'Related', exact: true }).fill('Collect');
  await page.getByRole('option', { name: 'Collect your first ideas' }).click();
  await page.getByRole('combobox', { name: 'Related', exact: true }).fill('Design');
  await page.getByRole('option', { name: 'Design a personal knowledge workspace' }).click();
  await page.getByRole('combobox', { name: 'Related', exact: true }).press('Escape');
  expect((await properties(page)).related).toBeUndefined();
  await related.getByRole('button', { name: 'Done', exact: true }).click();
  expect((await properties(page)).related).toHaveLength(2);
  await related.getByRole('button', { name: 'Remove Collect your first ideas' }).click();
  await related.getByRole('button', { name: 'Done', exact: true }).click();
  expect((await properties(page)).related).toHaveLength(1);
  await page.evaluate(() => {
    const f = (window as any).databaseFixture;
    return f.editor.open({ id: f.databaseId });
  });
  await openRecord(page);
  await expect(mention).toContainText('Quick notes');
  await expect(related).toContainText('Design a personal knowledge workspace');
});

test('new record uses the same forms and single relation clears without submitting on selection', async ({
  page,
}) => {
  await page.getByRole('button', { name: 'Add a record', exact: true }).click();
  const detail = page.getByRole('dialog');
  const single = detail.getByRole('group', { name: 'Single editor', exact: true });
  await single.getByRole('button', { name: 'Single', exact: true }).click();
  await page.getByRole('combobox', { name: 'Single', exact: true }).fill('Collect');
  await page.getByRole('option', { name: 'Collect your first ideas' }).click();
  await page.getByRole('combobox', { name: 'Single', exact: true }).press('Escape');
  await single.getByRole('button', { name: 'Done', exact: true }).click();
  await expect(single).toContainText('Collect your first ideas');
  await single.getByRole('button', { name: 'Remove Collect your first ideas' }).click();
  await single.getByRole('button', { name: 'Done', exact: true }).click();
  await page.evaluate(async () => {
    const f = (window as any).databaseFixture;
    await f.editor.flush();
  });
  const saved = await page.evaluate(async () => {
    const f = (window as any).databaseFixture;
    return (await f.repository.readSnapshot()).entries.find(
      (e: any) => e.object.type === 'record' && e.object.properties.title === 'Untitled record',
    ).object.properties;
  });
  expect(saved.single).toBeNull();
});

test('delete permission is checked for whole records, independently of editable cells', async ({
  page,
}) => {
  await page.evaluate(() => {
    const f = (window as any).databaseFixture;
    f.deniedDeletes.add(f.recordId);
  });
  const canvas = page.locator('canvas').first();
  await expect(canvas).toBeVisible();
  const bounds = await canvas.boundingBox();
  await page.mouse.click(bounds!.x + 15, bounds!.y + 19);
  await expect(page.getByText('3 selected', { exact: true })).toBeVisible();
  await expect(
    page
      .getByRole('region', { name: 'Row actions' })
      .getByRole('button', { name: 'Delete record' }),
  ).toBeDisabled();
  await expect(page.getByText('Some selected records cannot be deleted')).toBeVisible();
  expect((await properties(page)).title).toBe('Collect your first ideas');
});

test('delete keys never remove records from cell selection or active text inputs', async ({
  page,
}) => {
  await openRecord(page);
  const title = page.getByRole('group', { name: 'Name editor', exact: true }).getByRole('textbox');
  await title.fill('Draft');
  await title.press('Backspace');
  expect((await properties(page)).title).toBe('Collect your first ideas');
  await page.evaluate(() => {
    const f = (window as any).databaseFixture;
    return f.editor.open({ id: f.databaseId });
  });
  const canvas = page.locator('canvas').first();
  await expect(canvas).toBeVisible();
  const bounds = await canvas.boundingBox();
  await page.mouse.click(bounds!.x + 100, bounds!.y + 59);
  await page.keyboard.press('Delete');
  await rowClick(page, 0);
  await page.keyboard.press('Delete');
  await expect
    .poll(() =>
      page.evaluate(async () => {
        const f = (window as any).databaseFixture;
        await f.editor.flush();
        return (await f.repository.readSnapshot()).entries.filter(
          (e: any) => e.object.type === 'record' && e.object.deleted,
        ).length;
      }),
    )
    .toBe(1);
});

test('relation search ignores late responses, appends pages, retries and retains selections', async ({
  page,
}) => {
  await openRecord(page);
  const options = page.locator('[cmdk-list]').getByRole('option');
  await page.evaluate(() => {
    const f = (window as any).databaseFixture;
    const query = f.repository.queryRecords.bind(f.repository);
    f.failRelation = true;
    f.repository.queryRecords = async (request: any) => {
      if (request.text === 'Collect')
        await new Promise<void>((resolve) => {
          f.releaseRelation = resolve;
        });
      if (request.text === 'fail' && f.failRelation) throw new Error('Query failed');
      return query({ ...request, limit: request.text ? 100 : 1 });
    };
  });
  const related = page.getByRole('group', { name: 'Related editor', exact: true });
  await related.getByRole('button', { name: 'Related', exact: true }).click();
  await expect(options).toHaveCount(1);
  await options.first().click();
  await page.getByRole('button', { name: 'Load more', exact: true }).click();
  await expect(options).toHaveCount(2);
  const search = page.getByRole('combobox', { name: 'Related', exact: true });
  await search.fill('Collect');
  await expect
    .poll(() => page.evaluate(() => typeof (window as any).databaseFixture.releaseRelation))
    .toBe('function');
  await search.fill('Design');
  await expect(
    page.getByRole('option', { name: 'Design a personal knowledge workspace' }),
  ).toBeVisible();
  await page.evaluate(() => (window as any).databaseFixture.releaseRelation());
  await expect(page.getByRole('option', { name: 'Collect your first ideas' })).toHaveCount(0);
  await search.fill('fail');
  await expect(page.getByRole('alert')).toContainText('Unable to load options');
  await page.evaluate(() => {
    (window as any).databaseFixture.failRelation = false;
  });
  await page.getByRole('button', { name: 'Retry', exact: true }).click();
  await expect(page.getByText('No matching options')).toBeVisible();
  await search.press('Escape');
  await related.getByRole('button', { name: 'Done', exact: true }).click();
  expect((await properties(page)).related).toHaveLength(1);
});

test('grid references edit inline and cancel without writing', async ({ page }) => {
  const canvas = page.locator('canvas').first();
  await expect(canvas).toBeVisible();
  const bounds = await canvas.boundingBox();
  await page.mouse.dblclick(bounds!.x + 32 + 270 + 3 * 155 + 40, bounds!.y + 59);
  const editor = page.getByRole('group', { name: 'Mention editor', exact: true });
  await expect(editor.getByRole('combobox')).toBeVisible();
  await expect(editor.getByRole('button', { name: 'Mention', exact: true })).toHaveCount(0);
  await editor.getByRole('combobox').fill('Quick');
  await page.getByRole('option', { name: 'Quick notes' }).click();
  await editor.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(editor).toHaveCount(0);
  const values = await page.evaluate(async () => {
    const f = (window as any).databaseFixture;
    await f.editor.flush();
    return (await f.repository.readSnapshot()).entries
      .filter((e: any) => e.object.type === 'record')
      .map((e: any) => e.object.properties.mention);
  });
  expect(values.every((value: any) => value === undefined)).toBe(true);
});

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

test('mention search appends pages and IME Enter does not select a candidate', async ({ page }) => {
  await openRecord(page);
  await page.evaluate(() => {
    const f = (window as any).databaseFixture;
    const query = f.repository.queryNavigation.bind(f.repository);
    f.repository.queryNavigation = (request: any) => query({ ...request, limit: 1 });
  });
  const mention = page.getByRole('group', { name: 'Mention editor', exact: true });
  await mention.getByRole('button', { name: 'Mention', exact: true }).click();
  const options = page.locator('[cmdk-list]').getByRole('option');
  await expect(options).toHaveCount(1);
  await page.getByRole('button', { name: 'Load more', exact: true }).click();
  await expect(options).toHaveCount(2);
  const search = page.getByRole('combobox', { name: 'Mention', exact: true });
  await search.fill('Quick');
  await expect(page.getByRole('option', { name: 'Quick notes' })).toBeVisible();
  await search.dispatchEvent('keydown', { key: 'Enter', isComposing: true });
  await search.press('Escape');
  await expect(mention.getByRole('button', { name: 'Done', exact: true })).toHaveCount(0);
  expect((await properties(page)).mention).toBeUndefined();
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
  await page.locator('.bn-suggestion-menu-item').filter({ hasText: 'Heading 2' }).first().click();
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
