import { expect, test, type Page } from '@playwright/test';

import { repoRoot } from '../paths';

async function createWorkspace(page: Page, name: string) {
  await page.goto('/');
  await page.getByRole('button', { name: '仅此浏览器', exact: true }).click();
  await page.getByRole('button', { name: '创建工作空间', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '新建工作空间', exact: true });
  await dialog.getByRole('textbox').fill(name);
  await dialog.getByRole('button', { name: '新建', exact: true }).click();
  await expect(page.getByLabel('页面标题')).toHaveValue('开始');
}

async function openDeleteSettings(page: Page) {
  await page.getByRole('button', { name: '设置', exact: true }).click();
  await page.getByRole('menuitem', { name: '设置', exact: true }).click();
  const settings = page.getByRole('dialog', { name: '设置', exact: true });
  await settings.getByRole('button', { name: '同步', exact: true }).click();
  await expect(settings.getByRole('button', { name: '分享工作空间', exact: true })).toHaveCount(0);
  await settings.getByRole('button', { name: '删除工作空间', exact: true }).click();
  return page.getByRole('dialog', { name: '删除工作空间', exact: true });
}

test('deleting an active workspace discards failed saves and stops another open window', async ({
  page,
  context,
}) => {
  await createWorkspace(page, '删除测试');
  const other = await context.newPage();
  await other.goto(page.url());
  await expect(other.getByLabel('页面标题')).toHaveValue('开始');
  await page.evaluate(async (root) => {
    const { LocalStore } = await import(root + '/packages/local-store/src/index.ts');
    LocalStore.prototype.commit = () => Promise.reject(new Error('Storage unavailable'));
  }, '/@fs' + repoRoot);
  await page.getByLabel('页面标题').fill('未保存的修改');
  await expect(page.locator('header').getByRole('button', { name: /保存失败/ })).toBeVisible();
  const remove = await openDeleteSettings(page);
  await expect(remove).toContainText('删除测试');
  await remove.getByRole('button', { name: '取消', exact: true }).click();
  await expect(page.getByLabel('页面标题')).toHaveValue('未保存的修改');
  await page.keyboard.press('Escape');
  const confirmed = await openDeleteSettings(page);
  await confirmed.getByRole('button', { name: '永久删除', exact: true }).click();
  for (const tab of [page, other]) {
    await expect(tab.getByRole('heading', { name: '选择一个工作空间', exact: true })).toBeVisible();
    await expect(tab.getByLabel('页面标题')).toHaveCount(0);
    await expect(tab.getByRole('button', { name: /删除工作空间 · 删除测试/ })).toHaveCount(0);
    await tab.reload();
    await expect(tab.getByRole('heading', { name: '选择一个工作空间', exact: true })).toBeVisible();
    await expect(tab.getByLabel('页面标题')).toHaveCount(0);
  }
});

test('workspace list deletes an unopened workspace and preserves another workspace', async ({
  page,
}) => {
  await createWorkspace(page, '列表删除目标');
  await page.evaluate(async (root) => {
    const { LocalCatalog } = await import(root + '/packages/local-store/src/catalog.ts');
    const catalog = new LocalCatalog();
    await catalog.write('active', null);
    await catalog.saveSession({
      id: 'device_keep',
      connectionId: 'device',
      workspaceId: 'keep',
      name: '保留的空间',
    });
    await catalog.close();
    history.replaceState({}, '', location.pathname);
  }, '/@fs' + repoRoot);
  await page.reload();
  await expect(page.getByRole('heading', { name: '选择一个工作空间', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '删除工作空间 · 列表删除目标', exact: true }).click();
  const remove = page.getByRole('dialog', { name: '删除工作空间', exact: true });
  await expect(page.getByLabel('页面标题')).toHaveCount(0);
  await remove.getByRole('button', { name: '永久删除', exact: true }).click();
  await expect(remove).toHaveCount(0);
  await expect(
    page.getByRole('button', { name: '删除工作空间 · 列表删除目标', exact: true }),
  ).toHaveCount(0);
  await expect(page.getByRole('button', { name: '保留的空间', exact: true })).toBeVisible();
});

test('external management opens the declared web page and preserves the workspace', async ({
  page,
  context,
}) => {
  await createWorkspace(page, '网页操作测试');
  await context.route('https://github.com/**', (route) =>
    route.fulfill({ body: 'Provider website' }),
  );
  await page.evaluate(async (root) => {
    const { WorkspaceServices } = await import(root + '/workspace-services.ts');
    WorkspaceServices.prototype.workspaceActions = () => ({
      delete: {
        kind: 'external',
        title: '删除工作空间',
        description: 'Provider deletion instructions',
        confirmLabel: '前往网站',
        url: 'https://github.com/example/tio-test/settings',
      },
      share: {
        kind: 'external',
        title: '分享工作空间',
        description: 'Provider sharing instructions',
        confirmLabel: '前往网站',
        url: 'https://github.com/example/tio-test/settings/access',
      },
    });
  }, '/src/services');
  await page.getByRole('button', { name: '设置', exact: true }).click();
  await page.getByRole('menuitem', { name: '设置', exact: true }).click();
  const settings = page.getByRole('dialog', { name: '设置', exact: true });
  await settings.getByRole('button', { name: '同步', exact: true }).click();
  for (const [operation, path] of [
    ['分享工作空间', '/settings/access'],
    ['删除工作空间', '/settings'],
  ]) {
    await settings.getByRole('button', { name: operation, exact: true }).click();
    const action = page.getByRole('dialog', { name: operation, exact: true });
    await expect(action).toContainText('网页操作测试');
    const popupPromise = context.waitForEvent('page');
    await action.getByRole('button', { name: '前往网站', exact: true }).click();
    const popup = await popupPromise;
    await expect(popup).toHaveURL('https://github.com/example/tio-test' + path);
    expect(await popup.evaluate(() => window.opener === null)).toBe(true);
    await popup.close();
    await expect(action).toHaveCount(0);
  }
  await page.reload();
  await expect(page.getByLabel('页面标题')).toHaveValue('开始');
});
