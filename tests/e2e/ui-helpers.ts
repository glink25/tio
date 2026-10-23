import { expect, type Page } from '@playwright/test';
export async function settings(page: Page, section?: string) {
  await page.getByRole('button', { name: '设置', exact: true }).click();
  if (section) await page.getByRole('button', { name: section, exact: true }).click();
}
export async function setLight(page: Page) {
  await settings(page);
  await page.getByRole('button', { name: '浅色模式', exact: true }).click();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
}
export async function createChild(page: Page, title: string) {
  await page.locator('header').getByRole('button', { name: '更多操作', exact: true }).click();
  await page.getByRole('menuitem', { name: '新建子页面', exact: true }).click();
  const preview = page.getByRole('dialog', { name: '预览', exact: true });
  await expect(preview.getByLabel('页面标题')).toHaveValue('未命名');
  await preview.getByLabel('页面标题').fill(title);
  await preview.getByRole('button', { name: '展开为整页', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
}
