import { test, expect } from '@playwright/test';

import { repoRoot } from '../paths';

test('typed content and title survive a full browser reload', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: '仅此浏览器', exact: true }).click();
  await page.getByRole('button', { name: '创建工作空间', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '新建工作空间', exact: true });
  await dialog.getByRole('textbox').fill('持久化测试');
  await dialog.getByRole('button', { name: '新建', exact: true }).click();
  const title = page.getByLabel('页面标题');
  await expect(title).toHaveValue('开始');
  const longTitle = '这是一个很长很长的标题，编辑后重新打开仍然完整。'.repeat(5);
  await title.fill(longTitle);
  const editor = page.locator('.bn-editor').first();
  await editor.click();
  await page.keyboard.press('ControlOrMeta+End');
  await page.keyboard.press('Enter');
  await page.keyboard.insertText('真实输入持久化');
  await expect(editor).toContainText('真实输入持久化');
  await expect(page.locator('header').getByRole('button', { name: /^已保存本地/ })).toBeVisible();
  await page.reload();
  await expect(title).toHaveValue(longTitle);
  await expect(editor).toContainText('真实输入持久化');
});

test('host status contains persistence errors and recovers the latest input without a retry action', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByRole('button', { name: '仅此浏览器', exact: true }).click();
  await page.getByRole('button', { name: '创建工作空间', exact: true }).click();
  const create = page.getByRole('dialog', { name: '新建工作空间', exact: true });
  await create.getByRole('textbox').fill('自动恢复测试');
  await create.getByRole('button', { name: '新建', exact: true }).click();
  const title = page.getByLabel('页面标题');
  await expect(title).toHaveValue('开始');
  await page.evaluate(async (root) => {
    const { LocalStore } = await import(root + '/packages/local-store/src/index.ts');
    const commit = LocalStore.prototype.commit;
    const failure = { blocked: true };
    (window as any).saveFailure = failure;
    LocalStore.prototype.commit = function (...args: Parameters<typeof commit>) {
      if (failure.blocked) return Promise.reject(new Error('Temporary storage failure'));
      return commit.apply(this, args);
    };
  }, '/@fs' + repoRoot);
  await title.fill('失败后仍可输入');
  const status = page.locator('header').getByRole('button', { name: /保存失败/ });
  await expect(status).toBeVisible();
  await title.fill('故障期间的最新输入');
  await page.evaluate(() => {
    (window as any).saveFailure.blocked = false;
  });
  await expect(page.locator('header').getByRole('button', { name: /^已保存本地/ })).toBeVisible();
  await page.reload();
  await expect(title).toHaveValue('故障期间的最新输入');
});
