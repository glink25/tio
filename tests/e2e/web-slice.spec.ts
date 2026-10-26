import { readFileSync } from 'node:fs';

import { test, expect } from '@playwright/test';

import { createChild } from './ui-helpers';

const ledgerSlice = readFileSync('docs/examples/web-slice-ledger.html', 'utf8');
async function settings(page: import('@playwright/test').Page) {
  await page.getByRole('button', { name: 'Web Slice settings', exact: true }).click();
  await page.getByRole('tab', { name: 'Settings', exact: true }).click();
}
async function closeSettings(page: import('@playwright/test').Page) {
  await page.getByRole('button', { name: 'Close', exact: true }).click();
}

test.beforeEach(async ({ page }) => {
  await page.goto('/@fs' + process.cwd() + '/packages/web-editor/dist/index.html');
  await page.waitForFunction(() => !!(window as any).TioEditor);
  await page.evaluate(
    async ({ root, ledgerSlice }) => {
      const { mountEditor } = (window as any).TioEditor;
      const { MemoryRepository } = await import(root + '/packages/provider-memory/src/index.ts');
      const repository = new MemoryRepository();
      const grants = new Map();
      const permissionState = { fail: false };
      const permissionStore = {
        get: (key: string) => grants.get(key),
        set: (key: string, value: unknown) => {
          if (permissionState.fail) throw new Error('Storage unavailable');
          grants.set(key, value);
        },
      };
      await repository.commit({
        id: 'seed',
        expectedVersion: 0,
        changes: [
          {
            id: 'p',
            workspaceId: 'w',
            type: 'page',
            schemaVersion: 1,
            title: 'Slice test',
            blocks: [
              {
                id: 's',
                type: 'webSlice',
                props: {
                  title: 'Ledger',
                  html: ledgerSlice,
                  runtimeVersion: 1,
                  height: 320,
                  autoHeight: true,
                },
                content: [],
                children: [],
              },
            ],
          },
        ],
        assetIds: [],
      });
      document.body.innerHTML = '<div id="editor"></div>';
      const editor = await mountEditor(document.getElementById('editor')!, {
        repository,
        workspaceId: 'w',
        target: { id: 'p' },
        webSlice: { permissionStore },
        presentation: { locale: 'en', theme: 'light' },
      });
      Object.assign(window, { fixture: { repository, editor, permissionState } });
    },
    { root: '/@fs' + process.cwd(), ledgerSlice },
  );
});

test('sandbox ledger initializes, persists and updates with SDK ready before scripts', async ({
  page,
}) => {
  const frame = () => page.frameLocator('iframe[title="Ledger"]');
  await expect(frame().getByRole('button', { name: '创建账目表 / Initialize' })).toBeDisabled();
  await settings(page);
  await page.getByRole('radio', { name: 'Read & write', exact: true }).check();
  await closeSettings(page);
  await expect(frame().getByRole('button', { name: '创建账目表 / Initialize' })).toBeEnabled();
  await frame().getByRole('button', { name: '创建账目表 / Initialize' }).click();
  await expect(frame().getByRole('button', { name: '记一笔 / Add' })).toBeEnabled();
  await frame().getByPlaceholder('金额 / Amount').fill('38');
  await frame().getByPlaceholder('备注 / Note').fill('Lunch');
  await frame().getByRole('button', { name: '记一笔 / Add' }).click();
  await expect(frame().locator('#total')).toContainText('38.00');
  await settings(page);
  await page.getByRole('button', { name: 'Restart', exact: true }).click();
  await closeSettings(page);
  await expect(frame().locator('#total')).toContainText('38.00');
  const records = await page.evaluate(async () =>
    (await (window as any).fixture.repository.readSnapshot()).entries.filter(
      (e: any) => e.object.type === 'record',
    ),
  );
  expect(records).toHaveLength(1);
  await settings(page);
  await page.getByRole('radio', { name: 'Read only', exact: true }).check();
  await closeSettings(page);
  await expect(frame().getByRole('button', { name: '记一笔 / Add' })).toBeDisabled();
  await settings(page);
  await page.getByRole('button', { name: 'Stop', exact: true }).click();
  await expect(page.locator('iframe')).toHaveCount(0);
});

test('source editor previews without granting write access and protects parent DOM', async ({
  page,
}) => {
  await page.getByRole('button', { name: 'Web Slice settings', exact: true }).click();
  await expect(page.getByLabel('HTML')).toBeVisible();
  await page.getByRole('button', { name: 'Preview', exact: true }).click();
  await expect(
    page
      .frameLocator('iframe[title="Web Slice preview"]')
      .getByRole('button', { name: '创建账目表 / Initialize' }),
  ).toBeDisabled();
  const frame = page.frames().find((f) => f !== page.mainFrame())!;
  expect(
    await frame.evaluate(() => {
      try {
        return !!parent.document;
      } catch {
        return false;
      }
    }),
  ).toBe(false);
  const result = await frame.evaluate(async () => {
    try {
      await (window as any).tio.databases.get('secret').get();
      return 'bad';
    } catch (e: any) {
      return e.code;
    }
  });
  expect(result).toBe('PERMISSION_DENIED');
});

test('resource policy blocks external loads by default and allows HTTPS when enabled', async ({
  page,
}) => {
  const requests: string[] = [];
  await page.route('https://slice-test.invalid/**', async (route) => {
    requests.push(route.request().url());
    await route.fulfill({
      status: 200,
      headers: { 'Access-Control-Allow-Origin': '*' },
      contentType: 'application/javascript',
      body: 'window.externalLoaded = true;',
    });
  });
  const getFrame = () => page.frames().find((f) => f !== page.mainFrame())!;
  await expect(page.frameLocator('iframe[title="Ledger"]').locator('#status')).toContainText(
    'Enable',
  );
  const denied = await getFrame().evaluate(async () => {
    try {
      await fetch('https://slice-test.invalid/data');
      return false;
    } catch {
      return true;
    }
  });
  expect(denied).toBe(true);
  expect(requests).toHaveLength(0);
  await getFrame().evaluate(() => {
    const img = document.createElement('img');
    img.src = 'https://slice-test.invalid/image';
    document.body.append(img);
    const script = document.createElement('script');
    script.src = 'https://slice-test.invalid/script';
    document.head.append(script);
    const frame = document.createElement('iframe');
    frame.src = 'https://slice-test.invalid/frame';
    document.body.append(frame);
  });
  // A subsequent SDK round trip lets the blocked resource tasks settle.
  await getFrame().evaluate(() => (window as any).tio.context.get());
  expect(requests).toHaveLength(0);
  await settings(page);
  await page.getByRole('switch', { name: 'External resources & network' }).click();
  await page.getByRole('button', { name: 'Allow', exact: true }).click();
  await closeSettings(page);
  await expect(page.frameLocator('iframe[title="Ledger"]').locator('#status')).toContainText(
    'Enable',
  );
  expect(
    await getFrame().evaluate(async () => (await fetch('https://slice-test.invalid/data')).ok),
  ).toBe(true);
  await getFrame().evaluate(
    () =>
      new Promise<void>((resolve, reject) => {
        const script = document.createElement('script');
        script.src = 'https://slice-test.invalid/script';
        script.onload = () => resolve();
        script.onerror = () => reject(new Error('load'));
        document.head.append(script);
      }),
  );
  expect(await getFrame().evaluate(() => (window as any).externalLoaded)).toBe(true);
});

test('slash menu inserts a valid slice and code application survives reopening', async ({
  page,
}) => {
  const editor = page.locator('.bn-editor');
  await editor.click({ position: { x: 20, y: 10 } });
  // Insert into a regular paragraph through the editor keyboard.
  await page.keyboard.press('ControlOrMeta+End');
  await page.keyboard.press('Enter');
  await page.keyboard.type('/web');
  await expect(page.getByText('Web Slice', { exact: true })).toHaveCount(2);
  await page.keyboard.press('Enter');
  await expect(page.locator('[data-web-slice]')).toHaveCount(2);
  const slice = page.locator('[data-web-slice]').last();
  await slice.getByRole('button', { name: 'Web Slice settings', exact: true }).click();
  await page
    .getByLabel('HTML')
    .fill(
      '<h2>Applied HTML</h2><script>document.body.dataset.ready = String(!!window.tio)</script>',
    );
  await page.getByRole('button', { name: 'Apply changes', exact: true }).click();
  await expect(
    page.frameLocator('iframe[title="Web Slice"]').getByRole('heading', { name: 'Applied HTML' }),
  ).toBeVisible();
  await page.evaluate(async () => {
    const f = (window as any).fixture;
    await f.editor.dispose();
    f.editor = await (window as any).TioEditor.mountEditor(document.getElementById('editor'), {
      repository: f.repository,
      workspaceId: 'w',
      target: { id: 'p' },
      presentation: { locale: 'en', theme: 'light' },
    });
  });
  await expect(
    page.frameLocator('iframe[title="Web Slice"]').getByRole('heading', { name: 'Applied HTML' }),
  ).toBeVisible();
});

test('Web host persists a Slice grant and ledger records across a reload', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: '本机', exact: true }).click();
  await page.getByRole('button', { name: '新建工作空间', exact: true }).click();
  await expect(page.getByLabel('页面标题')).toBeVisible();
  await createChild(page, 'Web Slice App');
  await page.locator('.bn-editor').click();
  await page.keyboard.type('/web');
  await page.getByText('自定义网页', { exact: true }).click();
  const slice = page.locator('[data-web-slice]');
  await slice.getByRole('button', { name: 'Web Slice 设置', exact: true }).click();
  await page.getByLabel('HTML').fill(ledgerSlice);
  await page.getByRole('button', { name: '应用更改', exact: true }).click();
  await page.getByRole('tab', { name: '设置', exact: true }).click();
  await page.getByRole('radio', { name: '读写', exact: true }).check();
  await page.getByRole('button', { name: '关闭', exact: true }).click();
  const frame = page.frameLocator('iframe[title="Web Slice"]');
  await frame.getByRole('button', { name: '创建账目表 / Initialize' }).click();
  await expect(frame.getByRole('button', { name: '记一笔 / Add' })).toBeEnabled();
  await frame.getByPlaceholder('金额 / Amount').fill('25');
  await frame.getByRole('button', { name: '记一笔 / Add' }).click();
  await expect(frame.locator('#total')).toContainText('25.00');
  await page.reload();
  await page.locator('[data-web-slice]').getByRole('button', { name: 'Web Slice 设置' }).click();
  await page.getByRole('tab', { name: '设置', exact: true }).click();
  await expect(page.getByRole('radio', { name: '读写', exact: true })).toBeChecked();
  await page.getByRole('button', { name: '关闭', exact: true }).click();
  await expect(page.frameLocator('iframe[title="Web Slice"]').locator('#total')).toContainText(
    '25.00',
  );
  await page.screenshot({ path: 'test-results/web-slice-ledger.png', fullPage: true });
});

test('settings preserve drafts and live session, confirm discard and isolate logs', async ({
  page,
}) => {
  const slice = page.locator('[data-web-slice]');
  await expect(slice.getByRole('button')).toHaveCount(1);
  const live = page.frames().find((f) => f !== page.mainFrame())!;
  await live.evaluate(() => {
    (window as any).sessionMarker = 'stable';
  });
  await page.screenshot({ path: 'test-results/web-slice-display.png' });
  const trigger = slice.getByRole('button', { name: 'Web Slice settings', exact: true });
  await trigger.click();
  const draft = '<h2>Draft view</h2><script>console.error("Preview diagnostic")</script>';
  await page.getByLabel('HTML').fill(draft);
  await page.screenshot({ path: 'test-results/web-slice-code.png' });
  await page.getByRole('button', { name: 'Preview', exact: true }).click();
  await expect(
    page
      .frameLocator('iframe[title="Web Slice preview"]')
      .getByRole('heading', { name: 'Draft view' }),
  ).toBeVisible();
  await page.screenshot({ path: 'test-results/web-slice-preview.png' });
  await page.getByRole('tab', { name: 'Settings', exact: true }).click();
  await expect(page.locator('iframe[title="Web Slice preview"]')).toHaveCount(0);
  await expect(page.getByLabel('Height (px)')).toHaveCount(0);
  await page.getByRole('switch', { name: 'Auto height' }).click();
  await page.getByLabel('Height (px)').fill('640');
  await page.getByLabel('Height (px)').blur();
  await expect(slice.locator('iframe')).toHaveCSS('height', '640px');
  await page.screenshot({ path: 'test-results/web-slice-settings.png' });
  expect(await live.evaluate(() => (window as any).sessionMarker)).toBe('stable');
  await page.getByRole('tab', { name: /Logs/ }).click();
  await expect(page.getByText('"Preview diagnostic"', { exact: true })).toBeVisible();
  await page.screenshot({ path: 'test-results/web-slice-logs.png' });
  await page.getByRole('button', { name: 'Clear', exact: true }).click();
  await expect(page.getByText('No runtime logs')).toBeVisible();
  await page.getByRole('tab', { name: 'Code', exact: true }).click();
  await expect(page.getByLabel('HTML')).toContainText('Draft view');
  await closeSettings(page);
  await page.getByRole('button', { name: 'Continue editing', exact: true }).click();
  await expect(page.getByLabel('HTML')).toBeVisible();
  await closeSettings(page);
  await page.getByRole('button', { name: 'Discard changes', exact: true }).click();
  await expect(trigger).toBeFocused();
  expect(await live.evaluate(() => (window as any).sessionMarker)).toBe('stable');
  await trigger.click();
  await expect(page.getByLabel('HTML')).not.toContainText('Draft view');
});

test('drawer fits mobile dark layout and restores failed permission changes', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.evaluate(() => document.querySelector('.tio-editor')?.classList.add('dark'));
  await settings(page);
  const drawer = page.getByRole('dialog', { name: 'Web Slice settings', exact: true });
  const box = await drawer.boundingBox();
  expect(box?.x).toBe(0);
  expect(box?.width).toBe(390);
  await page.evaluate(() => {
    (window as any).fixture.permissionState.fail = true;
  });
  await page.getByRole('radio', { name: 'Read & write', exact: true }).click();
  await expect(page.getByRole('radio', { name: 'Read only', exact: true })).toBeChecked();
  await expect(page.getByText('Could not save permission. Try again.')).toBeVisible();
  await page.screenshot({ path: 'test-results/web-slice-mobile-dark.png' });
});

test('SDK pages handle reads and writes direct mentions and revokes removed references', async ({
  page,
}) => {
  await expect(
    page.frameLocator('iframe').getByRole('button', { name: '创建账目表 / Initialize' }),
  ).toBeDisabled();
  await page.evaluate(async () => {
    const r = (window as any).fixture.repository,
      s = await r.readSnapshot();
    const current = s.entries.find((e: any) => e.object.id === 'p').object;
    await r.commit({
      id: crypto.randomUUID(),
      expectedVersion: s.version,
      assetIds: [],
      changes: [
        {
          id: 'target',
          workspaceId: 'w',
          type: 'page',
          schemaVersion: 1,
          title: 'Target',
          blocks: [],
        },
        {
          ...current,
          blocks: [
            ...current.blocks,
            {
              id: 'mention',
              type: 'paragraph',
              props: {},
              content: [
                { type: 'mention', props: { workspaceId: 'w', kind: 'page', id: 'target' } },
              ],
              children: [],
            },
          ],
        },
      ],
    });
  });
  await expect(page.getByRole('button', { name: 'Target', exact: true })).toBeVisible();
  const frame = () => page.frames().find((f) => f !== page.mainFrame())!;
  expect(
    await frame().evaluate(async () => (await (window as any).tio.pages.get('target').get()).title),
  ).toBe('Target');
  await settings(page);
  await page.getByRole('radio', { name: 'Read & write', exact: true }).check();
  await closeSettings(page);
  await expect(
    page.frameLocator('iframe').getByRole('button', { name: '创建账目表 / Initialize' }),
  ).toBeEnabled();
  await frame().evaluate(async () => {
    const target = (window as any).tio.pages.get('target'),
      current = await target.get();
    await target.update({ title: 'Updated through SDK' }, current.version);
  });
  await expect(
    page.getByRole('button', { name: 'Updated through SDK', exact: true }),
  ).toBeVisible();
  await page.evaluate(async () => {
    const r = (window as any).fixture.repository,
      s = await r.readSnapshot();
    const current = s.entries.find((e: any) => e.object.id === 'p').object;
    await r.commit({
      id: crypto.randomUUID(),
      expectedVersion: s.version,
      assetIds: [],
      changes: [{ ...current, blocks: current.blocks.filter((b: any) => b.id !== 'mention') }],
    });
  });
  await expect(page.getByRole('button', { name: 'Updated through SDK', exact: true })).toHaveCount(
    0,
  );
  expect(
    await frame().evaluate(async () => {
      try {
        await (window as any).tio.pages.get('target').getBlocks();
        return 'unexpected';
      } catch (error: any) {
        return error.code;
      }
    }),
  ).toBe('PERMISSION_DENIED');
});
