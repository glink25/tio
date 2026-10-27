import { test, expect } from '@playwright/test';
test.beforeEach(async ({ page }) => {
  await page.goto('/@fs' + process.cwd() + '/packages/web-editor/dist/index.html');
  await page.waitForFunction(() => !!(window as any).TioEditor);
  await page.evaluate(async (root) => {
    const { mountBridgedEditor } = (window as any).TioEditor;
    const { MemoryRepository } = await import(root + '/packages/provider-memory/src/index.ts');
    const { createLoopback, serveHost } = await import(
      root + '/packages/host-protocol/src/index.ts'
    );
    const { sampleWorkspace, executeBasic } = await import(
      root + '/packages/workspace/src/index.ts'
    );
    document.body.innerHTML = '<div id="one"></div><div id="two"></div>';
    Object.defineProperty(window, 'indexedDB', {
      configurable: true,
      get() {
        throw new Error('Editor must not open IndexedDB');
      },
    });
    const objects = sampleWorkspace('zh');
    const database = objects.find((o: any) => o.type === 'database')!;
    database.fields!.push({ id: 'amount', name: 'Amount', type: 'number' });
    const record = objects.find((o: any) => o.type === 'record')!;
    record.properties!.amount = 12;
    const repository = new MemoryRepository();
    await repository.commit({ id: 'seed', expectedVersion: 0, changes: objects, assetIds: [] });
    const target = { id: objects.find((o: any) => o.type === 'page').id };
    const context = { sessionId: 'embed', workspaceId: objects[0].id };
    const pair = createLoopback();
    serveHost(pair.host, context, repository);
    const one = await mountBridgedEditor(document.getElementById('one')!, pair.client, context, {
      workspaceId: objects[0].id,
      target,
      presentation: { locale: 'en', theme: 'light' },
    });
    const pair2 = createLoopback();
    serveHost(pair2.host, { ...context, sessionId: 'second' }, repository);
    const two = await mountBridgedEditor(
      document.getElementById('two')!,
      pair2.client,
      { ...context, sessionId: 'second' },
      { workspaceId: objects[0].id, target, presentation: { locale: 'zh', theme: 'dark' } },
    );
    Object.assign(window, {
      fixture: { one, two, repository, executeBasic, context, target, recordId: record.id },
    });
  }, '/@fs' + process.cwd());
});

test('isolated editor uses only host persistence and isolates instances', async ({ page }) => {
  await expect(page.locator('#one').getByLabel('Page title')).toHaveValue('开始');
  await expect(page.locator('#two').getByLabel('页面标题')).toHaveValue('开始');
  await page.locator('#one').getByLabel('Page title').fill('Host persisted');
  await page.evaluate(async () => {
    await (window as any).fixture.one.flush();
  });
  await expect(page.locator('#two').getByLabel('页面标题')).toHaveValue('Host persisted');
  await page.evaluate(async () => {
    const f = (window as any).fixture;
    await f.executeBasic(f.repository, {
      version: 1,
      workspaceId: f.context.workspaceId,
      type: 'appendText',
      id: f.target.id,
      blockId: 'native_append',
      text: 'Written by native host',
    });
  });
  await expect(page.locator('#one .bn-editor')).toContainText('Written by native host');
  await page.locator('#one').getByRole('button', { name: 'More actions', exact: true }).click();
  await page.locator('#one').getByRole('menuitem', { name: 'Database', exact: true }).click();
  await expect(page.locator('#one').getByRole('dialog')).toBeVisible();
  await expect(page.locator('#two').getByRole('dialog')).toHaveCount(0);
  await page.keyboard.press('Escape');
  await page.screenshot({ path: 'test-results/embedded-two-instances.png', fullPage: true });
  await page.evaluate(async () => {
    const f = (window as any).fixture;
    await f.one.dispose();
    await f.two.dispose();
  });
  await expect(page.locator('.tio-editor')).toHaveCount(0);
});

test('focused inputs follow external state and preserve edits through persistence failure', async ({
  page,
}) => {
  const title = page.locator('#one').getByLabel('Page title');
  await title.fill('');
  await title.pressSequentially('Immediate title');
  await page.evaluate(async () => {
    await (window as any).fixture.one.flush();
  });
  await expect(title).toHaveValue('Immediate title');
  await expect(title).toBeFocused();
  await page.evaluate(async () => {
    const f = (window as any).fixture;
    const snapshot = await f.repository.readSnapshot();
    const object = snapshot.entries.find((e: any) => e.object.id === f.target.id).object;
    await f.repository.commit({
      id: crypto.randomUUID(),
      expectedVersion: snapshot.version,
      changes: [{ ...object, title: 'External title' }],
      assetIds: [],
    });
  });
  await expect(title).toHaveValue('External title');
  await expect(title).toBeFocused();
  await page.evaluate(() => {
    const f = (window as any).fixture;
    f.commit = f.repository.commit.bind(f.repository);
    f.repository.commit = async () => {
      throw new Error('Simulated disk full');
    };
  });
  await title.fill('Unsaved title');
  await expect
    .poll(() => page.evaluate(() => (window as any).fixture.one.getSaveState().status))
    .toBe('error');
  await title.pressSequentially(' plus input');
  await expect(title).toHaveValue('Unsaved title plus input');
  await page.evaluate(async () => {
    const f = (window as any).fixture;
    f.repository.commit = f.commit;
    await f.one.retry();
  });
  await expect(page.locator('#two').getByLabel('页面标题')).toHaveValue('Unsaved title plus input');
  await expect
    .poll(() => page.evaluate(() => (window as any).fixture.one.getSaveState().pending))
    .toBe(0);
});

test('numeric fields follow external updates and preserve decimals and clearing', async ({
  page,
}) => {
  await page.evaluate(async () => {
    const f = (window as any).fixture;
    await f.one.open({ id: f.recordId });
  });
  const amount = page.locator('#one').getByLabel('Amount', { exact: true });
  await expect(amount).toHaveValue('12');
  await amount.fill('1.5');
  await amount.press('Enter');
  await page.evaluate(async () => {
    await (window as any).fixture.one.flush();
  });
  await expect
    .poll(() =>
      page.evaluate(() => {
        const f = (window as any).fixture;
        return f.one.getSaveState().objects.find((o: any) => o.id === f.recordId).properties.amount;
      }),
    )
    .toBe(1.5);
  await page.evaluate(async () => {
    const f = (window as any).fixture;
    const snapshot = await f.repository.readSnapshot();
    const record = snapshot.entries.find((e: any) => e.object.id === f.recordId).object;
    await f.repository.commit({
      id: crypto.randomUUID(),
      expectedVersion: snapshot.version,
      changes: [{ ...record, properties: { ...record.properties, amount: 42 } }],
      assetIds: [],
    });
  });
  await expect(amount).toHaveValue('42');
  await amount.fill('');
  await amount.press('Enter');
  await amount.pressSequentially('-2.5');
  await amount.press('Enter');
  await expect(amount).toHaveValue('-2.5');
  await page.evaluate(async () => {
    await (window as any).fixture.one.flush();
  });
  await amount.fill('');
  await amount.press('Enter');
  await page.evaluate(async () => {
    await (window as any).fixture.one.flush();
  });
  await expect
    .poll(() =>
      page.evaluate(() => {
        const f = (window as any).fixture;
        return f.one.getSaveState().objects.find((o: any) => o.id === f.recordId).properties.amount;
      }),
    )
    .toBeNull();
});

test('table edits retain opaque nested content in neighboring tables', async ({ page }) => {
  const opaque = await page.evaluate(async () => {
    const f = (window as any).fixture;
    const snapshot = await f.repository.readSnapshot();
    const current = snapshot.entries.find((e: any) => e.object.id === f.target.id).object;
    const cell = (content: any[]) => ({ type: 'tableCell', props: {}, content });
    const text = (text: string) => ({ type: 'text', text, styles: {} });
    const unknown = {
      id: 'opaque-table',
      type: 'table',
      props: {},
      children: [],
      content: {
        type: 'tableContent',
        columnWidths: [null],
        rows: [{ cells: [cell([{ type: 'externalPerson', userId: 'person-1' }])] }],
      },
    };
    await f.repository.commit({
      id: crypto.randomUUID(),
      expectedVersion: snapshot.version,
      assetIds: [],
      changes: [
        {
          ...current,
          blocks: [
            {
              id: 'editable-table',
              type: 'table',
              props: {},
              children: [],
              content: {
                type: 'tableContent',
                columnWidths: [null, null],
                rows: [{ cells: [cell([text('Cell A')]), cell([text('Cell B')])] }],
              },
            },
            unknown,
          ],
        },
      ],
    });
    return unknown;
  });
  const cell = page.locator('#one .bn-editor table').first().locator('td').first();
  await expect(cell).toContainText('Cell A');
  await cell.click();
  await page.keyboard.press('End');
  await page.keyboard.type(' updated');
  await page.evaluate(() => (window as any).fixture.one.flush());
  const blocks = await page.evaluate(async () => {
    const f = (window as any).fixture;
    const snapshot = await f.repository.readSnapshot();
    return snapshot.entries.find((e: any) => e.object.id === f.target.id).object.blocks;
  });
  expect(JSON.stringify(blocks.find((b: any) => b.id === 'editable-table'))).toContain('updated');
  expect(blocks.find((b: any) => b.id === 'opaque-table')).toEqual(opaque);
  await expect(page.locator('#two .bn-editor table').first()).toContainText('updated');
});
