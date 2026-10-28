import { expect, test, type Page } from '@playwright/test';
import { object } from '@tio/core';

import { repoRoot } from '../paths';

async function seed(page: Page, selectedId?: string) {
  await page.goto('/');
  await expect(page.getByRole('button', { name: '仅此浏览器', exact: true })).toBeVisible();
  await page.evaluate(
    async ({ root, selectedId }) => {
      localStorage.setItem(
        'tio.github.credentials',
        JSON.stringify({ userId: 1, login: 'owner', mode: 'app', accessToken: 'fixture' }),
      );
      localStorage.setItem(
        'tio.github.endpoints.github-1',
        JSON.stringify([
          ['w', { repositoryId: 10, fullName: 'owner/tio-w', branch: 'main', workspaceId: 'w' }],
        ]),
      );
      const { LocalCatalog } = await import(root + '/packages/local-store/src/catalog.ts');
      const catalog = new LocalCatalog();
      await catalog.setting('connection', {
        connection: { id: 'github-1', kind: 'github', name: 'owner' },
      });
      await catalog.setting('active', 'github-1_w');
      await catalog.saveSession({
        id: 'github-1_w',
        workspaceId: 'w',
        connectionId: 'github-1',
        name: '初始化测试',
        selectedId,
      });
      await catalog.close();
    },
    { root: '/@fs' + repoRoot, selectedId },
  );
}

async function remote(page: Page, withPage: boolean) {
  let release!: () => void;
  let blocked = true;
  let failed = false;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const workspace = object('workspace', 'w', { id: 'w', name: '初始化测试' });
  const objects = [
    workspace,
    ...(withPage ? [object('page', 'w', { id: 'p', title: '下载的页面', blocks: [] })] : []),
  ];
  const repo = {
    id: 10,
    name: 'tio-w',
    full_name: 'owner/tio-w',
    default_branch: 'main',
    owner: { login: 'owner' },
    permissions: { push: true },
  };
  await page.route('https://api.github.com/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (route.request().method() !== 'GET') throw new Error(`Unexpected write: ${path}`);
    let json: unknown;
    if (path === '/user') json = { id: 1 };
    else if (path === '/user/installations') json = { installations: [{ id: 1 }] };
    else if (path === '/user/installations/1/repositories') json = { repositories: [repo] };
    else if (path === '/repositories/10') json = repo;
    else if (path.includes('/git/ref/')) json = { object: { sha: 'head' } };
    else if (path.endsWith('/git/commits/head')) json = { tree: { sha: 'tree' } };
    else if (path.endsWith('/git/trees/tree'))
      json = {
        tree: objects.map((o) => ({
          path: `workspaces/w/objects/${o.id}.json`,
          sha: o.id,
          type: 'blob',
        })),
      };
    else if (path.includes('/git/blobs/')) {
      if (blocked) await gate;
      if (failed) {
        await route.fulfill({ status: 503, body: 'Unavailable' });
        return;
      }
      const o = objects.find((o) => path.endsWith('/' + o.id));
      if (!o) throw new Error(`Unexpected blob: ${path}`);
      json = { encoding: 'base64', content: Buffer.from(JSON.stringify(o)).toString('base64') };
    } else throw new Error(`Unexpected API: ${path}`);
    await route.fulfill({ json });
  });
  return {
    release() {
      blocked = false;
      release();
    },
    fail() {
      failed = true;
      blocked = false;
      release();
    },
    recover() {
      failed = false;
    },
    block() {
      blocked = true;
    },
  };
}

test('first download shows a busy skeleton, then a page; complete cached content survives reopening offline', async ({
  page,
}) => {
  await seed(page);
  const api = await remote(page, true);
  await page.reload();
  const initializing = page.getByLabel('正在初始化工作空间…', { exact: true });
  await expect(initializing).toHaveAttribute('aria-busy', 'true');
  await expect(page.getByText('还没有页面', { exact: true })).toHaveCount(0);
  api.release();
  await expect(page.getByLabel('页面标题')).toHaveValue('下载的页面');
  await expect(initializing).toHaveCount(0);
  await expect
    .poll(() => page.evaluate(() => localStorage.getItem('tio.github.complete.github-1_w/10/main')))
    .toBe('true');
  await page.route('https://api.github.com/**', (route) => route.abort());
  await page.reload();
  await expect(page.getByLabel('页面标题')).toHaveValue('下载的页面');
  await expect(initializing).toHaveCount(0);
});

test('only a completed empty download shows the empty-pages illustration and create action', async ({
  page,
}) => {
  await seed(page);
  const api = await remote(page, false);
  await page.reload();
  await expect(page.getByLabel('正在初始化工作空间…', { exact: true })).toBeVisible();
  await expect(page.getByText('还没有页面', { exact: true })).toHaveCount(0);
  api.release();
  await expect(page.getByText('还没有页面', { exact: true })).toBeAttached();
  await expect(page.getByLabel('正在初始化工作空间…', { exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: '新建页面', exact: true }).last()).toBeVisible();
});

test('download failure retains an error and retry instead of showing empty pages', async ({
  page,
}) => {
  await seed(page);
  const api = await remote(page, true);
  await page.reload();
  await expect(page.getByLabel('正在初始化工作空间…', { exact: true })).toBeVisible();
  api.fail();
  const retry = page.getByRole('button', { name: '重试', exact: true });
  await expect(retry).toBeVisible();
  await expect(page.getByText('还没有页面', { exact: true })).toHaveCount(0);
  api.recover();
  await retry.click();
  await expect(page.getByLabel('页面标题')).toHaveValue('下载的页面');
});

test('a missing selected page retains its unavailable state after initialization', async ({
  page,
}) => {
  await seed(page, 'missing');
  const api = await remote(page, true);
  await page.reload();
  await expect(page.getByLabel('正在初始化工作空间…', { exact: true })).toBeVisible();
  api.release();
  await expect(page.getByText('页面不可用', { exact: true })).toBeVisible();
  await expect(page.getByText('还没有页面', { exact: true })).toHaveCount(0);
});
