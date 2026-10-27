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
  const currentTitle = await page.getByLabel('页面标题').inputValue();
  const row = page
    .locator('nav')
    .getByRole('button', { name: currentTitle, exact: true })
    .locator('..');
  await row.getByRole('button', { name: '新建子页面', exact: true }).click();
  const preview = page.getByRole('dialog', { name: '预览', exact: true });
  await expect(preview.getByLabel('页面标题')).toHaveValue('未命名');
  await preview.getByLabel('页面标题').fill(title);
  await preview.getByRole('button', { name: '展开为整页', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
}

/** Existing feature tests opt into a rich fixture; product creation stays minimal. */
export async function finishWorkspaceCreation(page: Page, sample = true) {
  const dialog = page.getByRole('dialog', { name: '新建工作空间', exact: true });
  await dialog.getByRole('textbox').fill('我的工作空间');
  await dialog.getByRole('button', { name: '新建', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByLabel('页面标题')).toHaveValue('开始');
  if (!sample || new URL(page.url()).port !== '6789') return;
  await page.evaluate(async (root) => {
    const { LocalCatalog } = await import(root + '/packages/local-store/src/index.ts');
    const { createConnectionBinding } = await import(
      root + '/apps/web/src/services/connection-adapters.ts'
    );
    const { sampleWorkspace, WorkspaceRuntime } = await import(
      root + '/packages/workspace/src/index.ts'
    );
    const catalog = new LocalCatalog();
    const session = (await catalog.sessions()).find((s: any) =>
      location.hash.includes(s.workspaceId),
    );
    const saved = await catalog.setting('connection');
    const repository = createConnectionBinding(saved.connection, saved.handle).repository(
      session.workspaceId,
      session.id,
    );
    const runtime = await WorkspaceRuntime.open(repository);
    const initial = runtime.snapshot().find((o: any) => o.type === 'page');
    const objects = sampleWorkspace();
    const fixture = JSON.parse(
      JSON.stringify(objects)
        .replaceAll(objects[0].id, session.workspaceId)
        .replaceAll(objects[1].id, initial.id),
    );
    runtime.patch(initial.id, fixture[1]);
    runtime.create(fixture.slice(2));
    await runtime.close();
    repository.close();
    await catalog.close();
  }, '/@fs' + process.cwd());
  await page.reload();
  await expect(page.getByLabel('页面标题')).toHaveValue('开始');
}
