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

// The form can stay mounted across resize and still lose fields when its advanced page unmounts.
// Verify both drafts survive navigation until the user confirms discarding the form.
test('Back preserves a workspace AI draft until the user confirms discarding it', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await page.getByRole('button', { name: '仅此浏览器', exact: true }).click();
  await page.getByRole('button', { name: '创建工作空间', exact: true }).click();
  const create = page.getByRole('dialog', { name: '新建工作空间', exact: true });
  await create.getByRole('textbox').fill('设置返回测试');
  await create.getByRole('button', { name: '新建', exact: true }).click();
  await expect(page.getByLabel('页面标题')).toHaveValue('开始');
  const contentUrl = page.url();

  await page.getByRole('button', { name: '打开侧栏', exact: true }).click();
  const sidebar = page.getByRole('dialog', { name: '打开侧栏', exact: true });
  await sidebar.getByRole('button', { name: '设置', exact: true }).click();
  await page.getByRole('menuitem', { name: '设置', exact: true }).click();
  const categories = page.getByRole('navigation', { name: '设置', exact: true });
  await expect(categories.getByRole('button', { name: 'AI 设置', exact: true })).toBeVisible();
  await page.setViewportSize({ width: 1024, height: 844 });
  await expect(categories.getByRole('button', { name: 'AI 设置', exact: true })).toBeVisible();
  const settingsLayers = page.locator('.tio-modal-layer[data-dialog-stack][data-state="open"]');
  await expect(settingsLayers).toHaveCount(1);
  const rootDepth = await page.evaluate(() => history.state.tioOverlayDepth);
  await categories.getByRole('button', { name: 'AI 设置', exact: true }).click();
  await expect(settingsLayers).toHaveCount(2);
  await expect(settingsLayers.first().locator('[role="dialog"]')).toHaveAttribute('inert', '');
  await expect.poll(() => page.evaluate(() => history.state.tioOverlayDepth)).toBe(rootDepth + 1);
  await expect(categories).not.toBeVisible();
  await page.getByRole('button', { name: '添加配置', exact: true }).click();

  const form = page.getByRole('dialog', { name: '添加配置', exact: true });
  const name = form.getByRole('textbox', { name: '名称', exact: true });
  await name.fill('待保存的配置');
  await form.getByRole('button', { name: '高级配置', exact: true }).click();
  const advanced = page.getByRole('dialog', { name: '高级配置', exact: true });
  const contextWindow = advanced.getByRole('spinbutton', { name: '上下文窗口（Token）' });
  await expect(settingsLayers).toHaveCount(4);
  await contextWindow.fill('8192');
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(contextWindow).toHaveValue('8192');
  await advanced.getByRole('button', { name: '返回', exact: true }).click();
  await expect(name).toHaveValue('待保存的配置');
  await form.getByRole('button', { name: '高级配置', exact: true }).click();
  await expect(contextWindow).toHaveValue('8192');
  await page.keyboard.press('Escape');
  await expect(name).toHaveValue('待保存的配置');

  const discard = page.getByRole('dialog', { name: '放弃尚未保存的修改？', exact: true });
  await page.evaluate(() => history.back());
  await discard.getByRole('button', { name: '继续编辑', exact: true }).click();
  await expect(name).toHaveValue('待保存的配置');
  await expect(page).toHaveURL(contentUrl);

  await page.evaluate(() => history.back());
  await discard.getByRole('button', { name: '放弃修改', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'AI 设置', exact: true })).toBeVisible();
  await expect(page).toHaveURL(contentUrl);
  await page.evaluate(() => history.back());
  await expect(page.getByRole('dialog', { name: '设置', exact: true })).toBeVisible();
  await expect(settingsLayers).toHaveCount(1);
  await page.evaluate(() => history.back());
  await expect(settingsLayers).toHaveCount(0);
  await expect(page).toHaveURL(contentUrl);
});
