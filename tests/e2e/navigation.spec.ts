import { expect, test, type Page } from '@playwright/test';

test.use({ actionTimeout: 10000 });

async function setup(page: Page) {
  await page.goto('/');
  await page.getByRole('button', { name: '仅此浏览器', exact: true }).click();
  await page.getByRole('button', { name: '创建工作空间', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '新建工作空间', exact: true });
  await dialog.getByRole('textbox').fill('导航测试');
  await dialog.getByRole('button', { name: '新建', exact: true }).click();
  await expect(page.getByLabel('页面标题')).toHaveValue('开始');
}
async function add(page: Page, name: string, parent?: string) {
  const aside = page.locator('aside');
  if (parent)
    await aside
      .locator('[data-navigation-id]')
      .filter({ has: page.getByRole('button', { name: parent, exact: true }) })
      .getByRole('button', { name: '新建子页面', exact: true })
      .click();
  else {
    await aside.getByRole('button', { name: '新建页面', exact: true }).first().click();
    await page.getByRole('menuitem', { name: '新建页面', exact: true }).click();
  }
  const preview = page.getByRole('dialog', { name: '预览', exact: true });
  await preview.getByLabel('页面标题').fill(name);
  await page.keyboard.press('Escape');
  await expect(preview).not.toBeVisible();
}
const tree = (page: Page) => page.locator('aside nav [data-navigation-id] > button:nth-of-type(3)');
async function remove(page: Page, title: string) {
  await page
    .locator('aside')
    .getByRole('button', { name: `${title} · 更多操作`, exact: true })
    .click();
  await page.getByRole('menuitem', { name: '移至回收站', exact: true }).click();
}

test('new pages prepend, keyboard sorting persists and deleting the selected page repairs navigation', async ({
  page,
}) => {
  await setup(page);
  await add(page, 'Alpha');
  await add(page, 'Beta');
  await expect(tree(page)).toHaveText(['Beta', 'Alpha', '开始']);
  const handle = page.locator('aside').getByRole('button', { name: '移动到 Alpha', exact: true });
  await handle.focus();
  await page.keyboard.press('Space');
  await expect(handle).toHaveAttribute('aria-pressed', 'true');
  await page.keyboard.press('ArrowUp');
  await expect(page.locator('aside nav [data-drop-position=before]')).toContainText('Beta');
  await page.keyboard.press('Space');
  await expect(handle).not.toHaveAttribute('aria-pressed', 'true');
  await expect(tree(page)).toHaveText(['Alpha', 'Beta', '开始']);
  await page.locator('aside nav').getByRole('button', { name: 'Alpha', exact: true }).click();
  await remove(page, 'Alpha');
  await expect(page.getByLabel('页面标题')).toHaveValue('Beta');
  await expect(page.getByText('页面不可用', { exact: true })).toHaveCount(0);
  await expect(page.locator('header').getByRole('button', { name: /^已保存本地/ })).toBeVisible();
  await page.reload();
  await expect(page.getByLabel('页面标题')).toHaveValue('Beta');
  await expect(tree(page)).toHaveText(['Beta', '开始']);
  await remove(page, 'Beta');
  await expect(page.getByLabel('页面标题')).toHaveValue('开始');
  await remove(page, '开始');
  await expect(page.getByText('选择一个页面，或创建新页面', { exact: true })).toBeVisible();
});

test('child pages prepend and pointer dragging can reorder and move a subtree', async ({
  page,
}) => {
  await setup(page);
  await add(page, 'Parent');
  await add(page, 'First child', 'Parent');
  await add(page, 'Second child', 'Parent');
  await expect(tree(page)).toHaveText(['Parent', 'Second child', 'First child', '开始']);
  const source = page.locator('aside').getByRole('button', { name: '移动到 Parent', exact: true });
  const target = page.locator('aside nav').getByRole('button', { name: '开始', exact: true });
  const start = await source.boundingBox();
  if (!start) throw new Error('Missing navigation drag source');
  await page.mouse.move(start.x + start.width / 2, start.y + start.height / 2);
  await page.mouse.down();
  await page.mouse.move(start.x + start.width / 2 + 8, start.y + start.height / 2);
  await expect(source).toHaveAttribute('aria-pressed', 'true');
  const end = await target.boundingBox();
  if (!end) throw new Error('Missing navigation drag target');
  await page.mouse.move(end.x + 30, end.y + end.height / 2, { steps: 15 });
  await expect(page.locator('aside nav [data-drop-position=inside]')).toContainText('开始');
  await page.mouse.up();
  await expect(tree(page)).toHaveText(['开始', 'Parent', 'Second child', 'First child']);
  await page.locator('aside nav').getByRole('button', { name: 'First child', exact: true }).click();
  await remove(page, 'Parent');
  await expect(page.getByLabel('页面标题')).toHaveValue('开始');
});
