import { test, expect } from '@playwright/test';

import { object, textBlock } from '../../packages/core/src/index';

test('PAT discovery opens a replica and retains it offline without exposing repository input', async ({
  page,
}) => {
  const objects = [
    object('workspace', 'github-w', { id: 'github-w', name: 'GitHub test space' }),
    object('page', 'github-w', {
      id: 'github-p',
      title: 'Remote page',
      blocks: [textBlock('Remote body')],
    }),
  ];
  const files = objects.map((value) => ({
    path: `workspaces/github-w/objects/${value.id}.json`,
    sha: value.id,
    type: 'blob',
  }));
  let failDiscovery = true;
  let expired = false;
  await page.route('https://api.github.com/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    let json: unknown;
    if (expired)
      return route.fulfill({ status: 401, json: { message: 'changed diagnostic prose' } });
    if (path === '/user')
      json = { id: 71, login: 'tester', avatar_url: 'https://avatars.githubusercontent.com/u/71' };
    else if (path === '/user/repos' && failDiscovery) {
      failDiscovery = false;
      return route.fulfill({ status: 503, json: { message: 'Unavailable' } });
    } else if (path === '/user/repos')
      json = [
        {
          id: 7,
          name: 'tio-test',
          full_name: 'tester/tio-test',
          default_branch: 'notes',
          owner: { login: 'tester' },
          permissions: { push: true },
        },
      ];
    else if (path === '/repositories/7') json = { id: 7, permissions: { push: true } };
    else if (path.includes('/git/ref/')) json = { object: { sha: 'head' } };
    else if (path.endsWith('/git/commits/head')) json = { tree: { sha: 'tree' } };
    else if (path.includes('/git/trees/')) json = { tree: files };
    else if (path.includes('/git/blobs/'))
      json = {
        encoding: 'base64',
        content: Buffer.from(
          JSON.stringify(objects.find((value) => value.id === path.split('/').at(-1))),
        ).toString('base64'),
      };
    else return route.fulfill({ status: 404, json: { message: 'unexpected ' + path } });
    await route.fulfill({ json });
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'GitHub Token 登录', exact: true }).click();
  await expect(page.getByRole('dialog').locator('input')).toHaveCount(1);
  await expect(page.locator('#github-token')).toHaveAttribute('type', 'password');
  await page.locator('#github-token').fill('test-pat');
  await page.getByRole('button', { name: 'GitHub Token 登录' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0, { timeout: 10000 });
  await expect(page.getByRole('button', { name: '发现仓库', exact: true })).toHaveCount(0);
  await expect(page.getByRole('alert')).toContainText('503');
  await expect(page.getByRole('button', { name: '新建工作空间', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: '重试', exact: true }).click();
  await page.getByRole('button', { name: 'GitHub test space', exact: true }).click();
  await expect(page.getByText('Remote body', { exact: true })).toBeVisible();
  await expect(
    page.getByRole('button', { name: '设置', exact: true }).locator('img'),
  ).toHaveAttribute('src', 'https://avatars.githubusercontent.com/u/71');
  await expect
    .poll(() =>
      page.evaluate(() =>
        Object.keys(localStorage).some((key) => key.startsWith('tio.github.complete.')),
      ),
    )
    .toBe(true);
  // Missing remote objects retain local content and route the status button to issue handling.
  const removed = files.splice(
    files.findIndex((file) => file.sha === 'github-p'),
    1,
  )[0];
  await page
    .locator('header')
    .getByRole('button', { name: /^已保存本地/ })
    .click();
  const issues = page.locator('header').getByRole('button', { name: /查看问题/ });
  await expect(issues).toBeVisible();
  await issues.click();
  await expect(page.getByRole('dialog', { name: '同步问题', exact: true })).toContainText(
    '已同步文件被移除',
  );
  await expect(page.getByRole('button', { name: '恢复文件', exact: true })).toBeVisible();
  await page.keyboard.press('Escape');
  files.push(removed);
  // Use the existing explicit sync action to clear the resolved issue.
  await page.getByRole('button', { name: '设置', exact: true }).click();
  await page.getByRole('button', { name: '同步', exact: true }).click();
  await page.getByRole('button', { name: '立即同步', exact: true }).click();
  await page.keyboard.press('Escape');
  await expect(issues).toHaveCount(0);

  expired = true;
  // Trigger the real background connectivity handler before clicking its resulting action.
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  const reauthorize = page.locator('header').getByRole('button', { name: /需要重新授权/ });
  await expect(reauthorize).toBeVisible();
  await expect(page.getByLabel('页面标题')).toHaveValue('Remote page');
  await reauthorize.click();
  await expect(page.getByRole('dialog', { name: 'GitHub', exact: true })).toBeVisible();
  expired = false;
  await page.locator('#github-token').fill('replacement-pat');
  await page.getByRole('button', { name: 'GitHub Token 登录', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(reauthorize).toHaveCount(0);
  await expect(page.getByLabel('页面标题')).toHaveValue('Remote page');
  await page.unroute('https://api.github.com/**');
  await page.route('https://api.github.com/**', (route) => route.abort('internetdisconnected'));
  await page.reload();
  await expect(page.getByText('Remote body', { exact: true })).toBeVisible();
});
