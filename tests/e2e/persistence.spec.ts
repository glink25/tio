import { test, expect } from '@playwright/test';

test('typed content and title survive a full browser reload', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: '仅此浏览器', exact: true }).click();
  await page.getByRole('button', { name: '创建工作空间', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '新建工作空间', exact: true });
  await dialog.getByRole('textbox').fill('持久化测试');
  await dialog.getByRole('button', { name: '新建', exact: true }).click();
  const title = page.getByLabel('页面标题');
  await expect(title).toHaveValue('开始');
  await title.fill('编辑后重新打开');
  const editor = page.locator('.bn-editor').first();
  await editor.click();
  await page.keyboard.press('ControlOrMeta+End');
  await page.keyboard.press('Enter');
  await page.keyboard.insertText('真实输入持久化');
  await expect(editor).toContainText('真实输入持久化');
  await expect(page.locator('header').getByRole('button', { name: /^已保存本地/ })).toBeVisible();
  await page.reload();
  await expect(title).toHaveValue('编辑后重新打开');
  await expect(editor).toContainText('真实输入持久化');
});
