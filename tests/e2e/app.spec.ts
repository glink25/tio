import { test, expect } from '@playwright/test';

import { settings, setLight, createChild } from './ui-helpers';
test('offline editing, database, board, persistence and backup', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Tio' })).toBeVisible();
  await page.getByRole('button', { name: '本机' }).click();
  await page.getByRole('button', { name: '新建工作空间', exact: true }).click();
  await expect(page.getByLabel('页面标题')).toHaveValue('开始');
  await page.getByLabel('页面标题').fill('我的测试笔记');
  await expect(page.getByText('已保存本地', { exact: true })).toBeVisible();
  const editor = page.locator('.bn-editor').first();
  await editor.click();
  await page.keyboard.press('ControlOrMeta+End');
  await page.keyboard.press('Enter');
  await page.keyboard.insertText('中文输入持久化测试');
  await expect(editor).toContainText('中文输入持久化测试');
  await page.waitForTimeout(600);
  await page.reload();
  await expect(page.getByLabel('页面标题')).toHaveValue('我的测试笔记');
  await expect(page.locator('.bn-editor').first()).toContainText('中文输入持久化测试');
  await page.locator('nav').getByRole('button', { name: '项目计划', exact: true }).first().click();
  await expect(page.getByLabel('页面标题')).toHaveValue('项目计划');
  await page.getByRole('button', { name: '视图设置', exact: true }).last().click();
  await page.getByLabel('布局', { exact: true }).selectOption('board');
  await page.keyboard.press('Escape');
  await expect(page.locator('.board-column')).toHaveCount(4);
  await page.getByRole('button', { name: '开启一次新的探索', exact: true }).click();
  await expect(page.getByLabel('名称', { exact: true })).toBeVisible();
  await page.getByLabel('名称', { exact: true }).fill('');
  await page.getByLabel('名称', { exact: true }).pressSequentially('Record input');
  await expect(page.getByLabel('名称', { exact: true })).toHaveValue('Record input');
  await page.getByLabel('名称', { exact: true }).fill('编辑记录测试');
  await page.getByLabel('状态', { exact: true }).selectOption('doing');
  await page.getByLabel('关闭记录').click();
  await expect(page.getByRole('button', { name: '编辑记录测试', exact: true })).toBeVisible();
  const downloadPromise = page.waitForEvent('download');
  await settings(page, '导入与导出');
  await page.getByRole('button', { name: '导出完整备份', exact: true }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toContain('.tio.zip');
  const readingDownload = page.waitForEvent('download');
  await page.getByRole('button', { name: '导出 Markdown（阅读）', exact: true }).click();
  expect((await readingDownload).suggestedFilename()).toContain('.markdown.zip');
  await page.keyboard.press('Escape');
  await page.screenshot({ path: 'test-results/desktop-board.png', fullPage: true });
  expect(errors).toEqual([]);
});
test('mobile layout can create and edit a record', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await page.screenshot({ path: 'test-results/mobile-welcome.png', fullPage: true });
  await page.getByRole('button', { name: '本机' }).click();
  await page.getByRole('button', { name: '新建工作空间', exact: true }).click();
  await expect(page.getByLabel('页面标题')).toBeVisible();
  await page.getByRole('button', { name: '新建', exact: true }).click();
  await expect(page.getByLabel('名称', { exact: true })).toBeVisible();
  await page.getByLabel('名称', { exact: true }).fill('手机记录');
  await page.getByLabel('关闭记录').click();
  await expect(page.locator('.mobile-records')).toContainText('手机记录');
  await page.screenshot({ path: 'test-results/mobile-document.png', fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
test('browser file provider with genuine directory handles (OPFS, not native picker)', async ({
  page,
}) => {
  await page.goto('/');
  const result = await page.evaluate(
    async (providerUrl) => {
      // Same browser DirectoryHandle API exercised in an isolated origin-private test directory.
      const { LocalFolderProvider } = await import(providerUrl);
      const root = await navigator.storage.getDirectory();
      const dir = await root.getDirectoryHandle('integration-test', { create: true });
      const provider = new LocalFolderProvider(dir);
      await provider.write(
        'workspaces/test/workspace.json',
        new TextEncoder().encode('{"test":true}'),
      );
      await provider.write('unrelated.txt', new TextEncoder().encode('preserve'));
      const list = await provider.list('workspaces/');
      const bytes = await provider.read('workspaces/test/workspace.json');
      await provider.delete('workspaces/test/workspace.json');
      return {
        list,
        text: new TextDecoder().decode(bytes!),
        missing: await provider.read('workspaces/test/workspace.json'),
        unrelated: new TextDecoder().decode((await provider.read('unrelated.txt'))!),
      };
    },
    '/@fs' + process.cwd() + '/packages/provider-local-folder/src/index.ts',
  );
  expect(result.list).toEqual([{ path: 'workspaces/test/workspace.json' }]);
  expect(result.text).toBe('{"test":true}');
  expect(result.missing).toBeNull();
  expect(result.unrelated).toBe('preserve');
});
test('folder entry, background sync, external changes and fresh-cache restore', async ({
  page,
}) => {
  await page.goto('/');
  const installPicker = async () =>
    page.evaluate(async () => {
      const root = await navigator.storage.getDirectory();
      const handle = await root.getDirectoryHandle('demo-folder', { create: true });
      (window as any).showDirectoryPicker = async () => handle;
    });
  await installPicker();
  await page.getByRole('button', { name: '连接本地文件夹', exact: false }).click();
  await page.getByRole('button', { name: '新建工作空间', exact: true }).click();
  await expect(page.getByText('已同步文件夹', { exact: true })).toBeVisible();
  await page.getByLabel('页面标题').fill('文件夹中的文档');
  await expect(page.getByText('已同步文件夹', { exact: true })).toBeVisible();
  await expect
    .poll(async () =>
      page.evaluate(async () => {
        const root = await navigator.storage.getDirectory();
        const dir = await root.getDirectoryHandle('demo-folder');
        const bases = await dir.getDirectoryHandle('workspaces').catch(() => null);
        if (!bases) return false;
        for await (const [, base] of (bases as any).entries()) {
          const pages = await base.getDirectoryHandle('objects').catch(() => null);
          if (!pages) continue;
          for await (const [, file] of pages.entries()) {
            const data = JSON.parse(await (await file.getFile()).text());
            if (data.title === '文件夹中的文档') return true;
          }
        }
        return false;
      }),
    )
    .toBe(true);
  await page.evaluate(async () => {
    const root = await navigator.storage.getDirectory();
    const dir = await root.getDirectoryHandle('demo-folder');
    const bases = await dir.getDirectoryHandle('workspaces');
    for await (const [, base] of (bases as any).entries()) {
      const pages = await base.getDirectoryHandle('objects');
      for await (const [, file] of pages.entries()) {
        const data = JSON.parse(await (await file.getFile()).text());
        if (data.title === '文件夹中的文档') {
          data.title = '外部修改的文档';
          const w = await file.createWritable();
          await w.write(JSON.stringify(data));
          await w.close();
        }
      }
    }
  });
  await page.getByRole('button', { name: '已同步文件夹' }).click();
  await expect(page.getByLabel('页面标题')).toHaveValue('外部修改的文档');
  await settings(page, '存储与同步');
  await page.getByRole('button', { name: '返回入口 / 断开会话' }).click();
  await page.evaluate(async () => {
    const req = indexedDB.open('tio-workspaces');
    const db: IDBDatabase = await new Promise((resolve, reject) => {
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    const tx = db.transaction(['objects', 'assets', 'sessions', 'settings'], 'readwrite');
    for (const name of ['objects', 'assets', 'sessions', 'settings']) tx.objectStore(name).clear();
    await new Promise<void>((r, j) => {
      tx.oncomplete = () => r();
      tx.onerror = () => j(tx.error);
    });
    db.close();
  });
  await page.reload();
  await installPicker();
  await page.getByRole('button', { name: '连接本地文件夹', exact: false }).click();
  await page.getByRole('button', { name: '我的工作空间', exact: true }).click();
  await expect(page.getByText('已同步文件夹', { exact: true })).toBeVisible();
  await page
    .locator('nav')
    .getByRole('button', { name: '外部修改的文档', exact: true })
    .first()
    .click();
  await expect(page.getByLabel('页面标题')).toHaveValue('外部修改的文档');
});
test('production PWA reloads and reopens offline with saved content', async ({ page, context }) => {
  await page.goto('http://127.0.0.1:4175/');
  await page.getByRole('button', { name: '本机' }).click();
  await page.getByRole('button', { name: '新建工作空间', exact: true }).click();
  await page.getByLabel('页面标题').fill('离线重开验证');
  await expect(page.getByText('已保存本地', { exact: true })).toBeVisible();
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);
  await context.setOffline(true);
  await page.reload();
  await expect(page.getByLabel('页面标题')).toHaveValue('离线重开验证');
  await page.close();
  const reopened = await context.newPage();
  await reopened.goto('http://127.0.0.1:4175/');
  await expect(reopened.getByLabel('页面标题')).toHaveValue('离线重开验证');
  await context.setOffline(false);
});

test('English and Chinese UI switch instantly, persist, and preserve content', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: '语言', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Tio' })).toBeVisible();
  await page.getByRole('button', { name: 'This device' }).click();
  await page.getByRole('button', { name: 'New workspace', exact: true }).click();
  await expect(page.getByLabel('Page title')).toHaveValue('Getting started');
  await page.getByLabel('Page title').fill('My own content');
  await expect(page.getByText('Saved locally', { exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByLabel('Page title')).toHaveValue('My own content');
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByRole('button', { name: 'Language', exact: true }).click();
  await page.keyboard.press('Escape');
  await expect(page.getByLabel('页面标题')).toHaveValue('My own content');
  await page
    .locator('aside')
    .getByRole('button', { name: /搜索/ })
    .click();
  await expect(page.getByRole('dialog', { name: '搜索工作空间' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.screenshot({ path: 'test-results/i18n-workspace.png', fullPage: true });
});

test('nested pages, references, workspace rename and dark theme persist', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('html')).toHaveClass('dark');
  await page.getByRole('button', { name: '本机', exact: true }).click();
  await page.getByRole('button', { name: '新建工作空间', exact: true }).click();
  await page.getByLabel('页面标题').fill('');
  await page.getByLabel('页面标题').pressSequentially('Parent page');
  await expect(page.getByLabel('页面标题')).toHaveValue('Parent page');
  await page.getByLabel('页面标题').fill('父页面');
  await createChild(page, '子页面');
  await createChild(page, '孙页面');
  await page.locator('header').getByRole('button', { name: '更多操作', exact: true }).click();
  await page.getByRole('menuitem', { name: '引用页面', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: '随手记', exact: true }).click();
  await expect(page.locator('.bn-editor').getByRole('button', { name: '随手记' })).toBeVisible();
  await page.getByRole('button').filter({ hasText: '我的工作空间' }).first().click();
  await page.getByRole('button', { name: '重命名工作空间' }).click();
  await page.getByRole('textbox', { name: '重命名工作空间' }).fill('我的知识库');
  await page.getByRole('dialog').getByRole('button', { name: '编辑', exact: true }).click();
  await expect(page.getByText('已保存本地', { exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByLabel('页面标题')).toHaveValue('孙页面');
  await expect(page.locator('html')).toHaveClass('dark');
  await expect(
    page.locator('header').getByRole('button', { name: '父页面', exact: true }),
  ).toBeVisible();
  await expect(
    page.locator('header').getByRole('button', { name: '子页面', exact: true }),
  ).toBeVisible();
  await expect(page.locator('aside').first()).toContainText('我的知识库');
  await page.screenshot({ path: 'test-results/dark-nested-page.png', fullPage: true });
  await page.locator('nav').getByRole('button', { name: '项目计划', exact: true }).click();
  await expect(page.locator('canvas').first()).toBeVisible();
  await page.screenshot({ path: 'test-results/dark-database.png', fullPage: true });
  await page.locator('nav').getByRole('button', { name: '孙页面', exact: true }).click();
  await page.locator('.bn-editor').getByRole('button', { name: '随手记' }).click();
  await expect(page.getByLabel('页面标题')).toHaveValue('随手记');
  await expect(page.locator('main .tio-page-references')).toHaveCount(0);
  await page.locator('nav').getByRole('button', { name: '孙页面', exact: true }).click();
  await expect(page.locator('.tio-page-references')).toContainText('引用的文档');
  await expect(
    page.locator('.tio-page-references').getByRole('button', { name: '随手记' }),
  ).toBeVisible();
  await setLight(page);
  await expect(page.locator('html')).not.toHaveClass('dark');
});

test('slash commands create nested pages', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: '本机', exact: true }).click();
  await page.getByRole('button', { name: '新建工作空间', exact: true }).click();
  await createChild(page, '斜杠父页');
  await page.locator('.bn-editor').click();
  await page.keyboard.type('/page');
  await page.getByRole('option', { name: '新建子页面', exact: true }).click();
  await expect(page.getByRole('dialog').getByLabel('页面标题')).toHaveValue('未命名');
  await page.getByRole('button', { name: '展开为整页', exact: true }).click();
  await expect(
    page.locator('header').getByRole('button', { name: '斜杠父页', exact: true }),
  ).toBeVisible();
});

test('backup import restores editable pages and names in a separate workspace', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByRole('button', { name: '本机', exact: true }).click();
  await page.getByRole('button', { name: '新建工作空间', exact: true }).click();
  await page.getByLabel('页面标题').fill('备份中的页面');
  await expect(page.getByText('已保存本地', { exact: true })).toBeVisible();
  const downloading = page.waitForEvent('download');
  await settings(page, '导入与导出');
  await page.getByRole('button', { name: '导出完整备份', exact: true }).click();
  const download = await downloading;
  const path = await download.path();
  expect(path).toBeTruthy();
  await page.keyboard.press('Escape');
  await page.getByLabel('页面标题').fill('原空间的新名称');
  await page.locator('input[type="file"]').setInputFiles(path!);
  await expect(page.getByLabel('页面标题')).toHaveValue('备份中的页面');
  await page.getByLabel('页面标题').fill('导入后可编辑');
  await expect(page.getByText('已保存本地', { exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByLabel('页面标题')).toHaveValue('导入后可编辑');
  await setLight(page);
  await page.reload();
  await expect(page.locator('html')).not.toHaveClass('dark');
});
