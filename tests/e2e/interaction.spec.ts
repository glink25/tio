import { expect, test } from '@playwright/test';

import { finishWorkspaceCreation, settings } from './ui-helpers';

test('minimal creation, recent identity, settings and destructive logout across tabs', async ({
  page,
  context,
}) => {
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'GitHub 登录', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'GitHub Token 登录', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: /导入|语言|浅色模式/ })).toHaveCount(0);
  await page.getByRole('button', { name: '本机', exact: true }).click();
  await page.getByRole('button', { name: '新建工作空间', exact: true }).click();
  const create = page.getByRole('dialog', { name: '新建工作空间', exact: true });
  await create.getByRole('textbox').fill('   ');
  await create.getByRole('button', { name: '新建', exact: true }).click();
  await expect(create).toBeVisible();
  await create.getByRole('textbox').fill('不应创建');
  await create.getByRole('button', { name: '取消', exact: true }).click();
  await expect(page.getByLabel('暂无工作空间')).toBeVisible();
  await page.getByRole('button', { name: '新建工作空间', exact: true }).click();
  await finishWorkspaceCreation(page, false);
  await expect(page.locator('nav').getByRole('button', { name: '开始', exact: true })).toHaveCount(
    1,
  );
  await expect(page.getByRole('button', { name: '项目计划', exact: true })).toHaveCount(0);
  await expect(page.locator('header').getByRole('button', { name: /^已保存本地/ })).toHaveCount(1);
  await page.locator('header').getByRole('button', { name: '更多操作', exact: true }).click();
  await expect(page.getByRole('menuitem', { name: /重命名|新建子页面|数据库/ })).toHaveCount(0);
  await page.keyboard.press('Escape');
  await settings(page, '同步');
  await expect(page.getByRole('dialog', { name: '设置', exact: true })).toContainText('local/本机');
  await page.getByRole('button', { name: '退出登录', exact: true }).click();
  const logout = page.getByRole('dialog', { name: '退出登录', exact: true });
  await expect(logout).toContainText('全部工作空间将被永久删除');
  await logout.getByRole('button', { name: '取消', exact: true }).click();
  await page.keyboard.press('Escape');
  const second = await context.newPage();
  await second.goto(page.url());
  await expect(second.getByLabel('页面标题')).toHaveValue('开始');
  await settings(page, '同步');
  await page.getByRole('button', { name: '退出登录', exact: true }).click();
  await logout.getByRole('button', { name: '退出登录', exact: true }).click();
  for (const tab of [page, second]) {
    await expect(tab.getByRole('heading', { name: 'Tio' })).toBeVisible();
    expect(await tab.evaluate(() => localStorage.getItem('tio.github.credentials'))).toBeNull();
    await tab.getByRole('button', { name: '本机', exact: true }).click();
    await expect(tab.getByRole('button', { name: /我的工作空间/ })).toHaveCount(0);
  }
});

test('selector back confirms logout and restores login after confirmation', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: '本机', exact: true }).click();
  await page.getByRole('button', { name: '返回', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '退出登录', exact: true });
  await dialog.getByRole('button', { name: '取消', exact: true }).click();
  await expect(page.getByRole('button', { name: '新建工作空间', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '返回', exact: true }).click();
  await dialog.getByRole('button', { name: '退出登录', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Tio' })).toBeVisible();
});

test('mobile input dialogs stay centered in the visible viewport as the keyboard opens', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.addInitScript(() => {
    const viewport = new EventTarget();
    Object.assign(viewport, { width: 390, height: 844, offsetTop: 0, offsetLeft: 0 });
    Object.defineProperty(window, 'visualViewport', { configurable: true, value: viewport });
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'GitHub Token 登录', exact: true }).click();
  const token = page.getByRole('dialog', { name: 'GitHub', exact: true });
  await expect(token).toBeVisible();
  const centered = async (height: number, offsetTop: number) => {
    await page.evaluate(
      ({ height, offsetTop }) => {
        Object.assign(window.visualViewport!, { height, offsetTop });
        window.visualViewport!.dispatchEvent(new Event('resize'));
        window.visualViewport!.dispatchEvent(new Event('scroll'));
      },
      { height, offsetTop },
    );
    await expect
      .poll(async () => {
        const box = await page.getByRole('dialog').boundingBox();
        return Math.abs(box!.y + box!.height / 2 - (offsetTop + height / 2));
      })
      .toBeLessThan(2);
    const box = await page.getByRole('dialog').boundingBox();
    expect(box!.y).toBeGreaterThanOrEqual(offsetTop + 15);
    expect(box!.y + box!.height).toBeLessThanOrEqual(offsetTop + height - 15);
  };
  await centered(844, 0);
  await page.locator('#github-token').fill('test-token');
  await centered(390, 24);
  await page.keyboard.press('Escape');
  await centeredViewportReset();
  await page.getByRole('button', { name: '本机', exact: true }).click();
  await expect(page.getByLabel('暂无工作空间')).toBeVisible();
  await page.getByRole('button', { name: '新建工作空间', exact: true }).click();
  await centered(844, 0);
  await page.getByRole('textbox').fill('手机笔记');
  await centered(360, 32);
  await expect(page.getByRole('textbox')).toBeInViewport();
  await page.getByRole('dialog').getByRole('button', { name: '新建', exact: true }).click();
  await expect(page.getByLabel('页面标题')).toHaveValue('开始');

  async function centeredViewportReset() {
    await page.evaluate(() => {
      Object.assign(window.visualViewport!, { height: 844, offsetTop: 0 });
      window.visualViewport!.dispatchEvent(new Event('resize'));
    });
  }
});
