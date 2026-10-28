import { expect, test, type Page } from '@playwright/test';
import type { CommitRequest } from '@tio/core';

import { repoRoot, testsRoot } from '../paths';

async function createAppPage(page: Page) {
  await page.goto('/');
  await page.evaluate(async (root) => {
    const { LocalStore } = await import(root + '/packages/local-store/src/index.ts');
    const commit = LocalStore.prototype.commit;
    LocalStore.prototype.commit = function (request: CommitRequest) {
      if (request.changes.some((o) => o.type === 'page')) {
        LocalStore.prototype.commit = commit;
        const changes = request.changes.map((o) =>
          o.type !== 'page'
            ? o
            : {
                ...o,
                blocks: [
                  ...(o.blocks ?? []),
                  ...['first', 'second'].map((id) => ({
                    id,
                    type: 'appSlice',
                    props: {
                      title: id,
                      html: `<style>html,body{margin:0;height:100%;background:#edf1ed}main{padding:48px;font:24px system-ui}</style><main>${id} app<output></output></main><script>tio.context.get().then(c=>document.querySelector('output').textContent=c.theme);tio.ui.resize(160)</script>`,
                      runtimeVersion: 1,
                      height: 320,
                      autoHeight: true,
                    },
                    content: [],
                    children: [],
                  })),
                ],
              },
        );
        return commit.call(this, { ...request, changes });
      }
      return commit.call(this, request);
    };
  }, '/@fs' + repoRoot);
  await page.getByRole('button', { name: '仅此浏览器', exact: true }).click();
  await page.getByRole('button', { name: '创建工作空间', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '新建工作空间', exact: true });
  await dialog.getByRole('textbox').fill('应用测试');
  await dialog.getByRole('button', { name: '新建', exact: true }).click();
  await expect(page.getByLabel('页面标题')).toHaveValue('开始');
}

test('app mode survives reload and preserves navigation, body and full viewport sizing', async ({
  page,
}) => {
  await createAppPage(page);
  await page.getByRole('button', { name: '开始 · 更多操作', exact: true }).click();
  await expect(page.getByRole('menuitem', { name: '开启 App Mode', exact: true })).toHaveCount(0);
  await page.keyboard.press('Escape');
  await page.locator('header').getByRole('button', { name: '更多操作', exact: true }).click();
  await page.getByRole('menuitem', { name: '开启 App Mode', exact: true }).click();
  const app = page.locator('[data-app-mode]');
  await expect(app).toBeVisible();
  await expect(page.getByLabel('页面标题')).toHaveCount(0);
  await expect(page.locator('.bn-editor')).toHaveCount(0);
  await expect(page.locator('header')).toHaveCount(0);
  await expect(app.locator('iframe')).toHaveCount(1);
  await expect(app.frameLocator('iframe').locator('main')).toContainText('first app');
  await expect
    .poll(() => app.locator('iframe').evaluate((el) => el.getBoundingClientRect().height))
    .toBe(720);
  await page.screenshot({ path: `${testsRoot}/.cache/visual/app-desktop-light.png` });
  await page.emulateMedia({ colorScheme: 'dark' });
  await expect(app.frameLocator('iframe').locator('output')).toHaveText('dark');
  await page.screenshot({ path: `${testsRoot}/.cache/visual/app-desktop-dark.png` });
  await page.getByRole('button', { name: '折叠侧栏', exact: true }).click();
  await expect(page.locator('aside')).toHaveCount(0);
  await expect(page.getByRole('button', { name: '打开侧栏', exact: true })).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.screenshot({ path: `${testsRoot}/.cache/visual/app-mobile.png` });
  await page.reload();
  await expect(app).toBeVisible();
  await expect(app.frameLocator('iframe').locator('main')).toContainText('first app');
  await page.getByRole('button', { name: '打开侧栏', exact: true }).click();
  await page.getByRole('button', { name: '开始 · 更多操作', exact: true }).click();
  await page.getByRole('menuitem', { name: '关闭 App Mode', exact: true }).click();
  await page.keyboard.press('Escape');
  await expect(page.getByLabel('页面标题')).toHaveValue('开始');
  await expect(page.locator('.bn-editor')).toContainText('输入 / 添加内容。');
  await expect(page.locator('[data-app-slice]')).toHaveCount(2);
});

test('automatic theme follows system while explicit choices persist', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'dark', reducedMotion: 'reduce' });
  await page.goto('/');
  await expect(page.locator('html')).toHaveClass('dark');
  await page.emulateMedia({ colorScheme: 'light' });
  await expect(page.locator('html')).not.toHaveClass('dark');
  await page.getByRole('button', { name: '自动模式 · 切换为浅色模式', exact: true }).click();
  await page.emulateMedia({ colorScheme: 'dark' });
  await expect(page.locator('html')).not.toHaveClass('dark');
  await page.reload();
  await expect(page.locator('html')).not.toHaveClass('dark');
  await page.getByRole('button', { name: '浅色模式 · 切换为深色模式', exact: true }).click();
  await expect(page.locator('html')).toHaveClass('dark');
  await page.getByRole('button', { name: '深色模式 · 切换为自动模式', exact: true }).click();
  await page.emulateMedia({ colorScheme: 'light' });
  await expect(page.locator('html')).not.toHaveClass('dark');
});
