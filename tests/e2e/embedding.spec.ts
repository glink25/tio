import { expect, test } from '@playwright/test';

import { repoRoot } from '../paths';
test.beforeEach(async ({ page }) => {
  await page.goto('/@fs' + repoRoot + '/packages/web-editor/dist/index.html');
  await page.waitForFunction(() => !!(window as any).TioEditor);
  await page.evaluate(async (root) => {
    const { mountBridgedEditor } = (window as any).TioEditor;
    const { MemoryRepository } = await import(root + '/packages/provider-memory/src/index.ts');
    const { createLoopback, serveHost } = await import(
      root + '/packages/host-protocol/src/index.ts'
    );
    const { executeBasic } = await import(root + '/packages/workspace/src/index.ts');
    const { sampleWorkspace } = await import(root + '/tests/fixtures/workspace.ts');
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
    const grants = new Map();
    const one = await mountBridgedEditor(document.getElementById('one')!, pair.client, context, {
      workspaceId: objects[0].id,
      target,
      presentation: { locale: 'en', theme: 'light' },
      appSlice: {
        permissionStore: {
          get: (key: string) => grants.get(key),
          set: (key: string, permission: unknown) => {
            grants.set(key, permission);
          },
        },
      },
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
      fixture: { grants, one, two, repository, executeBasic, context, target, recordId: record.id },
    });
  }, '/@fs' + repoRoot);
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
  await expect(page.locator('#one').getByRole('alert')).toHaveCount(0);
  await expect(page.locator('#one header')).not.toContainText('save failed');
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

test('document information exposes read-only system times updated by content edits', async ({
  page,
}) => {
  const before = await page.evaluate(async () => {
    const f = (window as any).fixture;
    return (await f.repository.readSnapshot()).entries.find(
      (entry: any) => entry.object.id === f.target.id,
    ).object;
  });
  await page.locator('#one').getByLabel('Page title').fill('Timestamped content');
  await page.evaluate(async () => (window as any).fixture.one.flush());
  const after = await page.evaluate(async () => {
    const f = (window as any).fixture;
    return (await f.repository.readSnapshot()).entries.find(
      (entry: any) => entry.object.id === f.target.id,
    ).object;
  });
  expect(after.createdAt).toBe(before.createdAt);
  expect(Date.parse(after.updatedAt)).toBeGreaterThan(Date.parse(before.updatedAt));
  await page.locator('#one').getByRole('button', { name: 'More actions', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Document information', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Document information', exact: true });
  await expect(dialog.locator('time').nth(0)).toHaveAttribute('datetime', after.createdAt);
  await expect(dialog.locator('time').nth(1)).toHaveAttribute('datetime', after.updatedAt);
  await expect(dialog.getByRole('textbox')).toHaveCount(0);
  await dialog.getByRole('button', { name: 'Close', exact: true }).click();
  await page.evaluate(async () => {
    const f = (window as any).fixture;
    await f.one.open({ id: f.recordId });
    await f.one.open(f.target);
  });
  const reopened = await page.evaluate(async () => {
    const f = (window as any).fixture;
    return (await f.repository.readSnapshot()).entries.find(
      (entry: any) => entry.object.id === f.target.id,
    ).object;
  });
  expect(reopened.createdAt).toBe(after.createdAt);
  expect(reopened.updatedAt).toBe(after.updatedAt);
});

test('numbered lists with an explicit start remain editable and persist as lists', async ({
  page,
}) => {
  await page.evaluate(async () => {
    const f = (window as any).fixture;
    const snapshot = await f.repository.readSnapshot();
    const current = snapshot.entries.find((entry: any) => entry.object.id === f.target.id).object;
    await f.repository.commit({
      id: crypto.randomUUID(),
      expectedVersion: snapshot.version,
      assetIds: [],
      changes: [
        {
          ...current,
          blocks: [
            {
              id: 'numbered-first',
              type: 'numberedListItem',
              props: { start: 3 },
              content: [{ type: 'text', text: 'First list item', styles: {} }],
              children: [],
            },
            {
              id: 'numbered-second',
              type: 'numberedListItem',
              props: {},
              content: [{ type: 'text', text: 'Second list item', styles: {} }],
              children: [],
            },
          ],
        },
      ],
    });
  });
  const lists = page.locator('#one [data-content-type="numberedListItem"]');
  await expect(lists).toHaveCount(2);
  await expect(lists.first()).toContainText('First list item');
  await lists.first().click();
  await page.keyboard.press('End');
  await page.keyboard.type(' edited');
  await page.evaluate(async () => (window as any).fixture.one.flush());
  const saved = await page.evaluate(async () => {
    const f = (window as any).fixture;
    return (await f.repository.readSnapshot()).entries.find(
      (entry: any) => entry.object.id === f.target.id,
    ).object.blocks;
  });
  expect(saved[0].type).toBe('numberedListItem');
  expect(saved[0].props.start).toBe(3);
  expect(JSON.stringify(saved[0].content)).toContain('First list item edited');
});

test('an image upload finishing after navigation never updates either document icon', async ({
  page,
}) => {
  const bytes = await page.evaluate(() => {
    const canvas = document.createElement('canvas');
    canvas.width = 2;
    canvas.height = 2;
    canvas.getContext('2d')!.fillRect(0, 0, 2, 2);
    return canvas.toDataURL('image/png').split(',')[1];
  });
  await page.evaluate(() => {
    // Keep the original method; the wrapper below supplies its File receiver with call().
    // oxlint-disable-next-line typescript/unbound-method
    const read = File.prototype.arrayBuffer;
    File.prototype.arrayBuffer = async function () {
      const bytes = await read.call(this);
      await new Promise<void>((resolve) => {
        (window as any).releaseMediaRead = resolve;
      });
      return bytes;
    };
  });
  await page.locator('#one').getByRole('button', { name: 'Change icon', exact: true }).click();
  await page.getByRole('tab', { name: 'Upload', exact: true }).click();
  await page.getByLabel('Upload image', { exact: true }).setInputFiles({
    name: 'delayed.png',
    mimeType: 'image/png',
    buffer: Buffer.from(bytes, 'base64'),
  });
  await page.waitForFunction(() => !!(window as any).releaseMediaRead);
  await page.evaluate(async () => {
    const f = (window as any).fixture;
    await f.one.open({ id: f.recordId });
  });
  await expect(page.locator('#one').getByRole('tab', { name: 'Upload', exact: true })).toHaveCount(
    0,
  );
  await page.evaluate(() => (window as any).releaseMediaRead());
  await expect
    .poll(async () =>
      page.evaluate(async () => {
        const entries = (await (window as any).fixture.repository.readSnapshot()).entries;
        return entries.some((entry: any) => entry.object.filename === 'delayed.png');
      }),
    )
    .toBe(true);
  const icons = await page.evaluate(async () => {
    const f = (window as any).fixture;
    await f.one.flush();
    const entries = (await f.repository.readSnapshot()).entries;
    return {
      home: entries.find((entry: any) => entry.object.id === f.target.id).object.icon,
      record: entries.find((entry: any) => entry.object.id === f.recordId).object.icon,
    };
  });
  expect(icons).toEqual({ home: '🌿', record: undefined });
  await expect(page.locator('#one').getByRole('tab', { name: 'Upload', exact: true })).toHaveCount(
    0,
  );
});

test('app mode renders a single sandbox, replaces removed instances and respects host read-only', async ({
  page,
}) => {
  await page.evaluate(async () => {
    const f = (window as any).fixture;
    f.grants.set(JSON.stringify(['local', f.context.workspaceId, f.target.id, 'first']), {
      data: 'readWrite',
      allowExternalResources: false,
    });
    await f.one.setPresentation({ readOnly: true });
    const snapshot = await f.repository.readSnapshot();
    const object = snapshot.entries.find((e: any) => e.object.id === f.target.id).object;
    const apps = ['first', 'second'].map((id) => ({
      id,
      type: 'appSlice',
      props: {
        title: id,
        html: `<h1>${id}</h1>`,
        runtimeVersion: 1,
        height: 320,
        autoHeight: true,
      },
      content: [],
      children: [],
    }));
    await f.repository.commit({
      id: crypto.randomUUID(),
      expectedVersion: snapshot.version,
      changes: [{ ...object, appMode: true, blocks: apps }],
      assetIds: [],
    });
  });
  const one = page.locator('#one');
  await expect(one.locator('.bn-editor')).toHaveCount(0);
  await expect(one.frameLocator('iframe').locator('h1')).toHaveText('first');
  const oldFrame = page
    .frames()
    .find((frame) => frame.parentFrame() && frame.url() === 'about:srcdoc')!;
  const denial = await one.locator('iframe').evaluate(async (element) => {
    // Opaque origin remains enforced by the browser.
    try {
      void (element as HTMLIFrameElement).contentWindow!.document;
      return false;
    } catch {
      return true;
    }
  });
  expect(denial).toBe(true);
  const appFrame = await one
    .locator('iframe')
    .elementHandle()
    .then((handle) => handle!.contentFrame());
  expect(
    await appFrame!.evaluate(async () => {
      try {
        await (window as any).tio.page.update(
          { title: 'Forbidden' },
          (await (window as any).tio.page.get()).version,
        );
        return 'allowed';
      } catch (error) {
        return (error as any).code;
      }
    }),
  ).toBe('PERMISSION_DENIED');
  await page.evaluate(async () => {
    const f = (window as any).fixture;
    const snapshot = await f.repository.readSnapshot();
    const object = snapshot.entries.find((e: any) => e.object.id === f.target.id).object;
    await f.repository.commit({
      id: crypto.randomUUID(),
      expectedVersion: snapshot.version,
      changes: [{ ...object, blocks: object.blocks.slice(1) }],
      assetIds: [],
    });
  });
  await expect(one.frameLocator('iframe').locator('h1')).toHaveText('second');
  expect(oldFrame.isDetached()).toBe(true);
  await page.evaluate(async () => {
    const f = (window as any).fixture;
    const snapshot = await f.repository.readSnapshot();
    const object = snapshot.entries.find((e: any) => e.object.id === f.target.id).object;
    await f.repository.commit({
      id: crypto.randomUUID(),
      expectedVersion: snapshot.version,
      changes: [{ ...object, blocks: [] }],
      assetIds: [],
    });
  });
  await expect(one.locator('iframe')).toHaveCount(0);
  await expect(one).toContainText('This page has no App Slice');
});
