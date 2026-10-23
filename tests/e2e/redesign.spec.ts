import { expect, test, type Page } from '@playwright/test';

import { createChild } from './ui-helpers';
async function start(page: Page) {
  await page.goto('/');
  await page.getByRole('button', { name: '本机', exact: true }).click();
  await page.getByRole('button', { name: '新建工作空间', exact: true }).click();
  await expect(page.getByLabel('页面标题')).toHaveValue('开始');
}
async function viewSettings(page: Page) {
  await page.getByRole('button', { name: '视图设置', exact: true }).last().click();
}
test('new page previews, workspace isolation, history and trash recovery', async ({ page }) => {
  await start(page);
  const firstUrl = page.url();
  await createChild(page, '空间 A 专属页面');
  const childUrl = page.url();
  expect(childUrl).toContain('#/w/');
  expect(childUrl).not.toBe(firstUrl);
  await page.goBack();
  await expect(page.getByLabel('页面标题')).toHaveValue('开始');
  await page.goForward();
  await expect(page.getByLabel('页面标题')).toHaveValue('空间 A 专属页面');
  await page.getByRole('button', { name: '切换工作空间', exact: true }).click();
  await expect(page.getByRole('button', { name: '重命名工作空间', exact: true })).toHaveCount(1);
  await page.getByRole('button', { name: '新建工作空间', exact: true }).click();
  await expect(page.getByLabel('页面标题')).toHaveValue('开始');
  expect(page.url().split('/p/')[0]).not.toBe(firstUrl.split('/p/')[0]);
  await page.keyboard.press('ControlOrMeta+k');
  await page.getByRole('combobox').fill('空间 A 专属页面');
  await expect(page.getByText('没有找到结果')).toBeVisible();
  await page.keyboard.press('Escape');
  await page.goBack();
  await expect(page.getByLabel('页面标题')).toHaveValue('空间 A 专属页面');
  await page.locator('header').getByRole('button', { name: '更多操作', exact: true }).click();
  await page.getByRole('menuitem', { name: '移至回收站', exact: true }).click();
  await expect(page.getByText('已移至回收站', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '回收站', exact: true }).click();
  await expect(page.getByRole('dialog')).toContainText('空间 A 专属页面');
  await page.getByRole('button', { name: '恢复', exact: true }).click();
  await page.keyboard.press('Escape');
  await expect(page.getByLabel('页面标题')).toHaveValue('空间 A 专属页面');
  await page.reload();
  await expect(page.getByLabel('页面标题')).toHaveValue('空间 A 专属页面');
});
test('named views persist independent layouts, filters and properties', async ({ page }) => {
  await start(page);
  await page.locator('nav').getByRole('button', { name: '项目计划', exact: true }).click();
  await page.getByRole('button', { name: '新建视图', exact: true }).click();
  await viewSettings(page);
  await page.getByLabel('视图名称').fill('待办看板');
  await page.getByLabel('布局', { exact: true }).selectOption('board');
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: '筛选', exact: true }).click();
  await page.getByRole('button', { name: '添加筛选条件' }).click();
  await page.getByLabel('筛选内容').fill('探索');
  await page.keyboard.press('Escape');
  await expect(page.locator('.board-column').getByRole('button')).toHaveCount(1);
  await page.getByRole('tab', { name: '全部项目', exact: true }).click();
  await expect(page.locator('canvas').first()).toBeVisible();
  await expect(page.getByRole('button', { name: '清空', exact: true })).toHaveCount(0);
  await page.getByRole('tab', { name: '待办看板', exact: true }).click();
  await page.reload();
  await expect(page.getByRole('tab', { name: '待办看板', exact: true })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await expect(page.locator('.board-column').getByRole('button')).toHaveCount(1);
  await viewSettings(page);
  await page.getByRole('button', { name: '字段', exact: true }).click();
  await page.getByRole('button', { name: '添加字段', exact: true }).click();
  await page.getByLabel('字段名称').fill('备注');
  await page.getByRole('button', { name: '完成', exact: true }).click();
  await expect(page.getByRole('dialog', { name: '数据库字段' })).toContainText('备注');
});
test('mobile nested panels close one level at a time and records remain editable', async ({
  page,
}) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await start(page);
  const addRecord = page.getByRole('button', { name: '新建', exact: true });
  const target = await addRecord.boundingBox();
  expect(target!.height).toBeGreaterThanOrEqual(44);
  expect(target!.width).toBeGreaterThanOrEqual(44);
  await viewSettings(page);
  await page.getByRole('button', { name: '字段', exact: true }).click();
  await expect(page.getByRole('dialog', { name: '数据库字段' })).toBeVisible();
  await page.getByRole('button', { name: '添加字段', exact: true }).click();
  await expect(page.getByRole('dialog', { name: '编辑属性' })).toBeVisible();
  await page.goBack();
  await expect(page.getByRole('dialog', { name: '编辑属性' })).toHaveCount(0);
  await expect(page.getByRole('dialog', { name: '数据库字段' })).toBeVisible();
  await page.goBack();
  await expect(page.getByRole('dialog', { name: '数据库字段' })).toHaveCount(0);
  await expect(page.getByRole('dialog', { name: '视图设置' })).toBeVisible();
  await page.goBack();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.getByRole('button', { name: '新建', exact: true }).click();
  await page.getByLabel('名称', { exact: true }).fill('手机上新增');
  await page.goBack();
  await expect(page.locator('.mobile-records')).toContainText('手机上新增');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
