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
  await expect(page.getByRole('alert')).toHaveCount(0);
  await expect(page.locator('[data-sonner-toast]')).toHaveCount(0);
  await status.hover();
  await expect(page.getByRole('tooltip')).toContainText('Temporary storage failure');
  await status.click();
  const details = page.getByRole('dialog', { name: '保存与同步状态' });
  await expect(details).toContainText('Temporary storage failure');
  await expect(
    details.getByRole('button', { name: /重试|立即同步|恢复文件|放弃本地草稿/ }),
  ).toHaveCount(0);
  await page.keyboard.press('Escape');
  await title.fill('故障期间的最新输入');
  await page.evaluate(() => {
    (window as any).saveFailure.blocked = false;
  });
  await expect(page.locator('header').getByRole('button', { name: /^已保存本地/ })).toBeVisible();
  await page
    .locator('header')
    .getByRole('button', { name: /^已保存本地/ })
    .click();
  await expect(page.getByRole('dialog', { name: '保存与同步状态' })).not.toContainText(
    'Temporary storage failure',
  );
  await page.reload();
  await expect(title).toHaveValue('故障期间的最新输入');
});

test('document icons persist, change and participate in undo without changing content', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByRole('button', { name: '仅此浏览器', exact: true }).click();
  await page.getByRole('button', { name: '创建工作空间', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '新建工作空间', exact: true });
  await dialog.getByRole('textbox').fill('图标持久化');
  await dialog.getByRole('button', { name: '新建', exact: true }).click();
  const title = page.getByLabel('页面标题');
  await expect(title).toHaveValue('开始');
  await title.fill('保留标题和正文的图标编辑');
  const editor = page.locator('.bn-editor').first();
  const content = await editor.innerText();
  const saved = page.locator('header').getByRole('button', { name: /^已保存本地/ });
  const icon = page.getByRole('button', { name: '更换图标', exact: true });
  const select = async (search: string, emoji: string) => {
    await page.locator('em-emoji-picker').getByPlaceholder('搜索').fill(search);
    await page.locator('em-emoji-picker').getByRole('button', { name: emoji, exact: true }).click();
    await expect(icon).toContainText(emoji);
    await expect(saved).toBeVisible();
  };
  await title.hover();
  await page.getByRole('button', { name: '添加图标', exact: true }).click();
  await select('rocket', '🚀');
  await page.reload();
  await expect(icon).toContainText('🚀');
  await icon.click();
  await select('grinning', '😀');
  await page.reload();
  await expect(icon).toContainText('😀');
  await icon.click();
  await page.getByRole('button', { name: '移除图标', exact: true }).click();
  await expect(icon).toHaveCount(0);
  await title.focus();
  await page.keyboard.press('ControlOrMeta+z');
  await expect(icon).toContainText('😀');
  await page.keyboard.press('ControlOrMeta+Shift+z');
  await expect(icon).toHaveCount(0);
  await expect(saved).toBeVisible();
  await page.reload();
  await expect(title).toHaveValue('保留标题和正文的图标编辑');
  await expect(editor).toHaveText(content, { useInnerText: true });
  await expect(icon).toHaveCount(0);
});
