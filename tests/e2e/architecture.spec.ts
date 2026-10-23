import { test, expect } from '@playwright/test';

import { settings, setLight } from './ui-helpers';

test('one folder connection hosts independent spaces and synchronizes without an editor', async ({
  page,
}) => {
  await page.goto('/');
  const result = await page.evaluate(async (root) => {
    const { WorkspaceServices } = await import(
      root + '/apps/web/src/services/workspace-services.ts'
    );
    const { object } = await import(root + '/packages/core/src/index.ts');
    const { executeBasic } = await import(root + '/packages/workspace/src/index.ts');
    const { LocalStore } = await import(root + '/packages/local-store/src/index.ts');
    const directory = await (
      await navigator.storage.getDirectory()
    ).getDirectoryHandle('multi-space', { create: true });
    const services = new WorkspaceServices();
    await services.connect('folder', directory);
    await services.refreshRemote();
    const a = await services.create([
      object('workspace', 'a', { id: 'a', name: 'A' }),
      object('page', 'a', { id: 'p', title: 'A page', blocks: [] }),
    ]);
    const b = await services.create([
      object('workspace', 'b', { id: 'b', name: 'B' }),
      object('page', 'b', { id: 'p', title: 'B page', blocks: [] }),
    ]);
    const runtimeA = await services.open(a);
    runtimeA.patch('p', { title: 'A edited' });
    const runtimeB = await services.open(b);
    const hostA = new LocalStore(a.id);
    await executeBasic(hostA, {
      version: 1,
      workspaceId: 'a',
      type: 'rename',
      id: 'p',
      name: 'Native A',
    });
    hostA.close();
    (window as any).architecture = { services, directory, a, b };
    return {
      a: a.workspaceId,
      b: b.workspaceId,
      bTitle: runtimeB.snapshot().find((o: any) => o.id === 'p').title,
      spaces: (await services.sessions()).map((s: any) => s.name),
    };
  }, '/@fs' + process.cwd());
  expect(result).toEqual({ a: 'a', b: 'b', bTitle: 'B page', spaces: ['A', 'B'] });
  await expect
    .poll(() =>
      page.evaluate(async () => {
        try {
          const dir = (window as any).architecture.directory;
          const spaces = await dir.getDirectoryHandle('workspaces');
          const a = await (await spaces.getDirectoryHandle('a')).getDirectoryHandle('pages');
          const b = await (await spaces.getDirectoryHandle('b')).getDirectoryHandle('pages');
          return [
            JSON.parse(await (await (await a.getFileHandle('p.json')).getFile()).text()).title,
            JSON.parse(await (await (await b.getFileHandle('p.json')).getFile()).text()).title,
          ];
        } catch {
          return [];
        }
      }),
    )
    .toEqual(['Native A', 'B page']);
  await page.evaluate(async () => {
    await (window as any).architecture.services.dispose();
  });
});

test('host and editor computed colors follow host preferences across navigation and reload', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByRole('button', { name: '本机', exact: true }).click();
  await page.getByRole('button', { name: '新建工作空间', exact: true }).click();
  await expect(page.getByLabel('页面标题')).toBeVisible();
  await expect(page.locator('aside')).toHaveCSS('background-color', 'rgb(32, 32, 32)');
  await expect(page.locator('.tio-editor')).toHaveCSS('background-color', 'rgb(25, 25, 25)');
  await setLight(page);
  await expect(page.locator('aside')).toHaveCSS('background-color', 'rgb(247, 247, 245)');
  await expect(page.locator('.tio-editor')).toHaveCSS('background-color', 'rgb(255, 255, 255)');
  await page.reload();
  await expect(page.locator('aside')).toHaveCSS('background-color', 'rgb(247, 247, 245)');
  await settings(page);
  await page.getByRole('button', { name: '深色模式', exact: true }).click();
  await page.keyboard.press('Escape');
  await expect(page.locator('body')).toHaveCSS('background-color', 'rgb(25, 25, 25)');
  await expect(page.locator('header')).toHaveCSS('--color-panel', '#191919');
});

for (const permission of ['prompt', 'denied']) {
  test(`folder ${permission} after reload retains the editor and reauthorizes only on click`, async ({
    page,
  }) => {
    await page.addInitScript(() => {
      const prototype = FileSystemHandle.prototype;
      prototype.queryPermission = async () =>
        (localStorage.getItem('test.folder.permission') ?? 'granted') as PermissionState;
      prototype.requestPermission = async () => {
        localStorage.setItem(
          'test.folder.requests',
          String(Number(localStorage.getItem('test.folder.requests') ?? 0) + 1),
        );
        const result = localStorage.getItem('test.folder.answer') ?? 'denied';
        localStorage.setItem('test.folder.permission', result);
        return result as PermissionState;
      };
    });
    await page.goto('/');
    await page.evaluate(async () => {
      const handle = await (
        await navigator.storage.getDirectory()
      ).getDirectoryHandle('auth-folder', { create: true });
      (window as any).showDirectoryPicker = async () => handle;
    });
    await page.getByRole('button', { name: '连接本地文件夹', exact: false }).click();
    await page.getByRole('button', { name: '新建工作空间', exact: true }).click();
    await page.getByLabel('页面标题').fill('授权前的文档');
    await expect(page.getByText('已保存本地', { exact: true })).toBeVisible();
    await page.evaluate(
      (value) => localStorage.setItem('test.folder.permission', value),
      permission,
    );
    await page.reload();
    await expect(page.getByLabel('页面标题')).toHaveValue('授权前的文档');
    await expect(page.getByRole('button', { name: '需要重新授权' })).toBeVisible();
    expect(await page.evaluate(() => localStorage.getItem('test.folder.requests'))).toBeNull();
    await page.getByLabel('页面标题').fill('离线继续编辑');
    await expect(page.getByText('已保存本地', { exact: true })).toBeVisible();
    await page.reload();
    await expect(page.getByLabel('页面标题')).toHaveValue('离线继续编辑');
    await page.getByRole('button', { name: '需要重新授权' }).click();
    await expect(page.getByLabel('页面标题')).toHaveValue('离线继续编辑');
    await expect(page.getByRole('button', { name: '需要重新授权' })).toBeVisible();
    expect(await page.evaluate(() => localStorage.getItem('test.folder.requests'))).toBe('1');
    await page.evaluate(() => localStorage.setItem('test.folder.answer', 'granted'));
    await page.getByRole('button', { name: '需要重新授权' }).click();
    await expect(page.getByText('已同步文件夹', { exact: true })).toBeVisible();
    await expect(page.getByLabel('页面标题')).toHaveValue('离线继续编辑');
    expect(await page.evaluate(() => localStorage.getItem('test.folder.requests'))).toBe('2');
    const titles = await page.evaluate(async () => {
      const folder = await (
        await navigator.storage.getDirectory()
      ).getDirectoryHandle('auth-folder');
      const spaces = await folder.getDirectoryHandle('workspaces');
      const result: string[] = [];
      for await (const [, space] of spaces.entries()) {
        const pages = await (space as FileSystemDirectoryHandle).getDirectoryHandle('pages');
        for await (const [, file] of pages.entries())
          result.push(
            JSON.parse(await (await (file as FileSystemFileHandle).getFile()).text()).title,
          );
      }
      return result;
    });
    expect(titles).toContain('离线继续编辑');
  });
}
test('a restored folder connection without cached spaces exposes recovery in the selector', async ({
  page,
}) => {
  await page.addInitScript(() => {
    FileSystemHandle.prototype.queryPermission = async () => 'prompt';
    FileSystemHandle.prototype.requestPermission = async () => 'denied';
  });
  await page.goto('/');
  await page.evaluate(async (root) => {
    const { WorkspaceServices } = await import(
      root + '/apps/web/src/services/workspace-services.ts'
    );
    const directory = await (
      await navigator.storage.getDirectory()
    ).getDirectoryHandle('no-cache', { create: true });
    const service = new WorkspaceServices();
    await service.connect('folder', directory);
    await service.dispose();
  }, '/@fs' + process.cwd());
  await page.reload();
  await expect(page.getByRole('heading', { name: 'no-cache' })).toBeVisible();
  await page.getByRole('button', { name: '需要重新授权' }).click();
  await expect(page.getByRole('heading', { name: 'no-cache' })).toBeVisible();
  await expect(page.getByRole('button', { name: '需要重新授权' })).toBeVisible();
  await expect(page.getByLabel('页面标题')).toHaveCount(0);
});
