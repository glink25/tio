import { test, expect } from '@playwright/test';

import { settings, setLight } from './ui-helpers';

test('one folder connection writes independent spaces directly without an editor', async ({
  page,
}) => {
  await page.goto('/');
  const result = await page.evaluate(async (root) => {
    const { WorkspaceServices } = await import(
      root + '/apps/web/src/services/workspace-services.ts'
    );
    const { object } = await import(root + '/packages/core/src/index.ts');
    const { executeBasic } = await import(root + '/packages/workspace/src/index.ts');
    const { createConnectionBinding } = await import(
      root + '/apps/web/src/services/connection-adapters.ts'
    );
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
    const hostA = createConnectionBinding(services.connection, directory).repository(
      a.workspaceId,
      a.id,
    );
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
          const a = await (await spaces.getDirectoryHandle('a')).getDirectoryHandle('objects');
          const b = await (await spaces.getDirectoryHandle('b')).getDirectoryHandle('objects');
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
  test(`folder ${permission} after reload requires authorization before opening files`, async ({
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
    await expect
      .poll(() =>
        page.evaluate(async () => {
          const root = await (
            await navigator.storage.getDirectory()
          ).getDirectoryHandle('auth-folder');
          const spaces = await root.getDirectoryHandle('workspaces');
          for await (const [, space] of spaces.entries()) {
            const objects = await (space as FileSystemDirectoryHandle).getDirectoryHandle(
              'objects',
            );
            for await (const [, file] of objects.entries()) {
              const value = JSON.parse(
                await (await (file as FileSystemFileHandle).getFile()).text(),
              );
              if (value.title === '授权前的文档') return true;
            }
          }
          return false;
        }),
      )
      .toBe(true);
    await expect(page.locator('header output').filter({ hasText: '已保存本地' })).toBeVisible();
    await page.evaluate(
      (value) => localStorage.setItem('test.folder.permission', value),
      permission,
    );
    await page.reload();
    await expect(page.getByLabel('页面标题')).toHaveCount(0);
    await expect(page.getByRole('button', { name: '需要重新授权' })).toBeVisible();
    expect(await page.evaluate(() => localStorage.getItem('test.folder.requests'))).toBeNull();
    await page.getByRole('button', { name: '需要重新授权' }).click();
    await expect(page.getByLabel('页面标题')).toHaveCount(0);
    expect(await page.evaluate(() => localStorage.getItem('test.folder.requests'))).toBe('1');
    await page.evaluate(() => localStorage.setItem('test.folder.answer', 'granted'));
    await page.getByRole('button', { name: '需要重新授权' }).click();
    await expect(page.getByLabel('页面标题')).toHaveValue('授权前的文档');
    expect(await page.evaluate(() => localStorage.getItem('test.folder.requests'))).toBe('2');
    const titles = await page.evaluate(async () => {
      const folder = await (
        await navigator.storage.getDirectory()
      ).getDirectoryHandle('auth-folder');
      const spaces = await folder.getDirectoryHandle('workspaces');
      const result: string[] = [];
      for await (const [, space] of spaces.entries()) {
        const pages = await (space as FileSystemDirectoryHandle).getDirectoryHandle('objects');
        for await (const [, file] of pages.entries())
          result.push(
            JSON.parse(await (await (file as FileSystemFileHandle).getFile()).text()).title,
          );
      }
      return result;
    });
    expect(titles).toContain('授权前的文档');
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

test('worker search finds unopened bodies and refreshes after deletion without loading them into the editor', async ({
  page,
}) => {
  await page.goto('/');
  const result = await page.evaluate(async (root) => {
    const { createConnectionBinding } = await import(
      root + '/apps/web/src/services/connection-adapters.ts'
    );
    const { object, textBlock } = await import(root + '/packages/core/src/index.ts');
    const { WorkspaceRuntime } = await import(root + '/packages/workspace/src/index.ts');
    const binding = createConnectionBinding({ id: 'search-test', kind: 'device', name: 'Search' });
    const repository = binding.repository('w', 'search-test');
    await repository.commit({
      id: 'seed',
      expectedVersion: 0,
      assetIds: [],
      changes: [
        object('page', 'w', { id: 'a', title: 'Selected', blocks: [] }),
        object('page', 'w', { id: 'b', title: 'Unopened', blocks: [textBlock('needle-in-body')] }),
      ],
    });
    const runtime = await WorkspaceRuntime.open(repository, undefined, undefined, {
      targetId: 'a',
    });
    let after: string | undefined;
    const matches: string[] = [];
    const completions: boolean[] = [];
    do {
      const page = await runtime.search({ text: 'needle-in-body', limit: 1, after });
      matches.push(...page.items.map((o: any) => o.id));
      completions.push(page.complete);
      after = page.next;
    } while (after);
    const unloaded = runtime.state.getState().loads.b === undefined;
    runtime.patch('b', { deleted: true });
    await runtime.flush();
    const deleted = await runtime.search({ text: 'needle-in-body', limit: 100 });
    runtime.dispose();
    repository.close();
    return { matches, completions, unloaded, deleted: deleted.items.length };
  }, '/@fs' + process.cwd());
  expect(result).toEqual({
    matches: ['b'],
    completions: [false, true],
    unloaded: true,
    deleted: 0,
  });
});

test('folder saves leave no business-object replica and no completed bodies in the recovery journal', async ({
  page,
}) => {
  await page.goto('/');
  const result = await page.evaluate(async (root) => {
    const { WorkspaceServices } = await import(
      root + '/apps/web/src/services/workspace-services.ts'
    );
    const { object, textBlock } = await import(root + '/packages/core/src/index.ts');
    const directory = await (
      await navigator.storage.getDirectory()
    ).getDirectoryHandle('no-replica', { create: true });
    const services = new WorkspaceServices();
    await services.connect('folder', directory);
    await services.create([
      object('workspace', 'w', { id: 'w', name: 'Direct' }),
      object('page', 'w', { id: 'p', title: 'Direct', blocks: [textBlock('unique-durable-body')] }),
    ]);
    const readStore = (name: string, store: string) =>
      new Promise<any[]>((resolve, reject) => {
        const request = indexedDB.open(name);
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
          const db = request.result;
          const get = db.transaction(store).objectStore(store).getAll();
          get.onerror = () => reject(get.error);
          get.onsuccess = () => {
            resolve(get.result);
            db.close();
          };
        };
      });
    const objects = await readStore('tio-workspaces', 'objects');
    const journals = await readStore('tio-provider-recovery', 'journals');
    await services.dispose();
    return {
      objects: objects.length,
      bodyRetained: JSON.stringify(journals).includes('unique-durable-body'),
      pending: journals.some((j) => j.pending),
    };
  }, '/@fs' + process.cwd());
  expect(result).toEqual({ objects: 0, bodyRetained: false, pending: false });
});
