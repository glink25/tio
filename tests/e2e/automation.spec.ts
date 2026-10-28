import { expect, test, type Page } from '@playwright/test';

import { repoRoot } from '../paths';

async function select(page: Page, label: string, option: string) {
  await page.getByRole('combobox', { name: label, exact: true }).last().click();
  await page.getByRole('option', { name: option, exact: true }).click();
}
test('workspace automation configuration persists and creates content from a real page action', async ({
  page,
}) => {
  await page.goto('/');
  await page.evaluate(async (root) => {
    const { WorkspaceRuntime } = await import(root + '/packages/workspace/src/index.ts');
    const open = WorkspaceRuntime.open;
    WorkspaceRuntime.open = async function (...args: Parameters<typeof open>) {
      const runtime = await open.apply(this, args);
      (window as any).automationRuntime = runtime;
      return runtime;
    };
  }, '/@fs' + repoRoot);
  await page.getByRole('button', { name: '仅此浏览器', exact: true }).click();
  await page.getByRole('button', { name: '创建工作空间', exact: true }).click();
  const create = page.getByRole('dialog', { name: '新建工作空间', exact: true });
  await create.getByRole('textbox').fill('自动化测试');
  await create.getByRole('button', { name: '新建', exact: true }).click();
  await expect(page.getByLabel('页面标题')).toHaveValue('开始');
  await page.getByRole('button', { name: '新建页面', exact: true }).first().click();
  await page.getByRole('menuitem', { name: '新建数据库', exact: true }).click();
  await expect(page.getByLabel('页面标题')).toHaveValue('新建数据库');
  await page.getByRole('button', { name: '设置', exact: true }).click();
  await page.getByRole('button', { name: '自动化', exact: true }).click();
  await expect(page.getByRole('dialog', { name: '设置', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: '新建自动化', exact: true }).first().click();
  await page.getByLabel('名称', { exact: true }).fill('页面索引');
  await expect(page.getByRole('button', { name: '保存并启用', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: '页面创建时', exact: true }).click();
  await page.getByRole('button', { name: '选择要执行的操作', exact: true }).click();
  await page.getByRole('button', { name: '新增记录', exact: true }).click();
  await select(page, '选择数据表', '新建数据库');
  await select(page, '添加属性', '名称');
  await page.getByRole('textbox', { name: '名称', exact: true }).last().fill('直接输入的属性');
  await select(page, '记录正文', '替换正文');
  await page.getByRole('textbox', { name: '正文模板', exact: true }).fill('页面索引 ');
  await page.getByRole('button', { name: '插入变量', exact: true }).click();
  await page.getByRole('option', { name: 'ID 文本', exact: true }).first().click();
  await expect(page.getByRole('textbox', { name: '正文模板' })).toContainText('触发对象');
  await page.getByRole('button', { name: '仅保存', exact: true }).click();
  await expect(page.getByRole('button', { name: '页面索引', exact: false }).first()).toBeVisible();
  const toggle = page.getByRole('switch', { name: '启停「页面索引」' });
  await expect(toggle).toHaveAttribute('aria-checked', 'false');
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-checked', 'true');
  await page.getByRole('button', { name: '运行日志', exact: true }).click();
  await expect(page.getByText('仅保留当前工作空间会话内的运行记录。')).toBeVisible();
  await page.getByRole('button', { name: '返回', exact: true }).click();
  await page.reload();
  await page.getByRole('button', { name: '设置', exact: true }).click();
  await page.getByRole('button', { name: '自动化', exact: true }).click();
  await page.getByRole('button', { name: '页面索引', exact: false }).first().click();
  await expect(page.getByRole('textbox', { name: '正文模板' })).toContainText('页面索引');
  await expect(page.getByRole('textbox', { name: '名称', exact: true }).last()).toHaveValue(
    '直接输入的属性',
  );
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog', { name: '设置', exact: true })).toBeVisible();
  await page.keyboard.press('Escape');
  // Opening a new page through the host must trigger without displaying the database first.
  await page.evaluate(async (root) => {
    const { WorkspaceRuntime } = await import(root + '/packages/workspace/src/index.ts');
    const create = WorkspaceRuntime.prototype.create;
    WorkspaceRuntime.prototype.create = function (...args: Parameters<typeof create>) {
      (window as any).automationRuntime = this;
      return create.apply(this, args);
    };
  }, '/@fs' + repoRoot);
  await page.getByRole('button', { name: '新建页面', exact: true }).last().click();
  await expect
    .poll(async () =>
      page.evaluate(async () => {
        const f = (window as any).automationRuntime;
        const db = (await f.queryObjects({ type: 'database' }))[0];
        const rows = await f.queryObjects({ databaseId: db.id });
        return rows.filter(
          (o: any) =>
            o.type === 'record' && !o.deleted && JSON.stringify(o.blocks).includes('页面索引'),
        ).length;
      }),
    )
    .toBe(1);
});

async function openWorkspace(page: Page) {
  await page.goto('/');
  await page.evaluate(async (root) => {
    const { WorkspaceRuntime } = await import(root + '/packages/workspace/src/index.ts');
    const create = WorkspaceRuntime.prototype.create;
    WorkspaceRuntime.prototype.create = function (...args: Parameters<typeof create>) {
      (window as any).automationRuntime = this;
      return create.apply(this, args);
    };
  }, '/@fs' + repoRoot);
  await page.getByRole('button', { name: '仅此浏览器', exact: true }).click();
  await page.getByRole('button', { name: '创建工作空间', exact: true }).click();
  const create = page.getByRole('dialog', { name: '新建工作空间', exact: true });
  await create.getByRole('textbox').fill('流程交互');
  await create.getByRole('button', { name: '新建', exact: true }).click();
  await expect(page.getByLabel('页面标题')).toHaveValue('开始');
  await page.getByRole('button', { name: '新建页面', exact: true }).first().click();
  await page.getByRole('menuitem', { name: '新建数据库', exact: true }).click();
  await expect(page.getByLabel('页面标题')).toHaveValue('新建数据库');
}
async function openCenter(page: Page) {
  await page.getByRole('button', { name: '设置', exact: true }).click();
  await page.getByRole('button', { name: '自动化', exact: true }).click();
}

test('reordering referenced steps shows errors and incomplete drafts can be discarded', async ({
  page,
}) => {
  await openWorkspace(page);
  await page.evaluate(async (root) => {
    const { object } = await import(root + '/packages/core/src/index.ts');
    const runtime = (window as any).automationRuntime;
    const database = (await runtime.queryObjects({ type: 'database' }))[0];
    runtime.create([
      object('automation', database.workspaceId, {
        id: 'referenced',
        name: '多步流程',
        enabled: false,
        trigger: { kind: 'page.created' },
        actions: [
          { id: 'first', kind: 'record.create', databaseId: database.id, properties: {} },
          {
            id: 'second',
            kind: 'record.update',
            databaseId: database.id,
            target: { kind: 'record', id: { kind: 'reference', path: 'steps.first.ids' } },
            body: { mode: 'append', template: 'Follow up' },
          },
        ],
      }),
    ]);
    await runtime.flush();
  }, '/@fs' + repoRoot);
  await openCenter(page);
  await page.getByRole('button', { name: /^多步流程/ }).click();
  await page.getByRole('button', { name: '操作选项', exact: true }).nth(1).click();
  await page.getByRole('menuitem', { name: '上移', exact: true }).click();
  await expect(page.getByRole('alert').first()).toHaveText('变量已失效或类型不匹配。');
  await page.getByRole('button', { name: '保存并启用', exact: true }).click();
  await expect(page.getByRole('textbox', { name: '名称', exact: true })).toHaveValue('多步流程');
  await page.keyboard.press('Escape');
  const leave = page.getByRole('dialog', { name: '是否保存修改？', exact: true });
  await expect(leave).toBeVisible();
  await leave.getByRole('button', { name: '继续编辑' }).click();
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: '放弃修改' }).click();
  await expect(page.getByRole('dialog', { name: '设置', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '自动化', exact: true }).click();
  await page.getByRole('button', { name: /^多步流程/ }).click();
  await expect(page.getByRole('alert')).toHaveCount(0);
  await page.getByRole('button', { name: '操作选项', exact: true }).first().click();
  await page.getByRole('menuitem', { name: '删除操作', exact: true }).click();
  await page.getByRole('button', { name: '确认更改', exact: true }).click();
  await expect(page.getByRole('alert').first()).toHaveText('变量已失效或类型不匹配。');
});

test('failed saving preserves direct field input and retries without duplicating rules', async ({
  page,
}) => {
  await openWorkspace(page);
  await openCenter(page);
  await page.getByRole('button', { name: '新建自动化', exact: true }).first().click();
  await page.getByRole('textbox', { name: '名称', exact: true }).fill('恢复保存');
  await page.getByRole('button', { name: '记录新增时', exact: true }).click();
  await select(page, '选择数据表', '新建数据库');
  await page.getByRole('button', { name: '选择要执行的操作', exact: true }).click();
  await page.getByRole('button', { name: '新增记录', exact: true }).click();
  await select(page, '选择数据表', '新建数据库');
  await select(page, '添加属性', '名称');
  await page.getByRole('textbox', { name: '名称', exact: true }).last().fill('无需单独确认');
  await page.evaluate(async (root) => {
    const { HostError } = await import(root + '/packages/core/src/index.ts');
    const repository = (window as any).automationRuntime.repository;
    const commit = repository.commit.bind(repository);
    const failure = { blocked: true };
    (window as any).automationSaveFailure = failure;
    repository.commit = (request: any) =>
      failure.blocked ? Promise.reject(new HostError('timeout')) : commit(request);
  }, '/@fs' + repoRoot);
  await page.getByRole('button', { name: '仅保存', exact: true }).click();
  await expect(page.getByRole('alert').first()).toBeVisible();
  await expect(page.getByRole('textbox', { name: '名称', exact: true }).last()).toHaveValue(
    '无需单独确认',
  );
  await page.evaluate(() => {
    (window as any).automationSaveFailure.blocked = false;
  });
  await page.getByRole('button', { name: '保存并启用', exact: true }).click();
  await expect(page.getByRole('switch', { name: '启停「恢复保存」' })).toHaveAttribute(
    'aria-checked',
    'true',
  );
  await expect(page.getByText('1 个流程，1 个已启用')).toBeVisible();
  await page.getByRole('button', { name: '「恢复保存」的选项', exact: true }).click();
  await page.getByRole('menuitem', { name: '删除', exact: true }).click();
  await page
    .getByRole('dialog', { name: '删除自动化', exact: true })
    .getByRole('button', { name: '删除', exact: true })
    .click();
  await expect(page.getByText('尚无自动化规则。')).toBeVisible();
});

test('loading retries, field conditions and live read-only changes preserve a flow draft', async ({
  page,
}) => {
  await openWorkspace(page);
  await page.evaluate(async (root) => {
    const { HostError } = await import(root + '/packages/core/src/index.ts');
    const runtime = (window as any).automationRuntime;
    const query = runtime.queryObjects.bind(runtime);
    let first = true;
    runtime.queryObjects = (scope: any) => {
      if (scope.type === 'automation' && first) {
        first = false;
        return Promise.reject(new HostError('unavailable'));
      }
      return query(scope);
    };
  }, '/@fs' + repoRoot);
  await openCenter(page);
  await expect(page.getByRole('alert')).toBeVisible();
  await expect(page.getByText('尚无自动化规则。')).toHaveCount(0);
  await page.getByRole('button', { name: '重试', exact: true }).click();
  await page.getByRole('button', { name: '新建自动化', exact: true }).first().click();
  await page.getByRole('textbox', { name: '名称', exact: true }).fill('条件修改');
  await page.getByRole('button', { name: '记录新增时', exact: true }).click();
  await select(page, '选择数据表', '新建数据库');
  await page.getByRole('button', { name: '设置触发限制条件', exact: true }).click();
  await page.getByRole('button', { name: '添加条件', exact: true }).click();
  await select(page, '比较方式', '包含');
  await page
    .getByRole('region', { name: '第 1 步', exact: true })
    .getByRole('textbox', { name: '名称', exact: true })
    .fill('待办');
  await page.getByRole('button', { name: '选择要执行的操作', exact: true }).click();
  await page.getByRole('button', { name: '更新记录', exact: true }).click();
  await select(page, '选择数据表', '新建数据库');
  await select(page, '选择记录', '触发记录');
  await select(page, '添加属性', '名称');
  await page
    .getByRole('region', { name: '第 2 步', exact: true })
    .getByRole('textbox', { name: '名称', exact: true })
    .fill('已归档');
  await page
    .getByRole('region', { name: '第 2 步', exact: true })
    .getByRole('button', { name: '为「名称」插入变量', exact: true })
    .click();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog', { name: '是否保存修改？', exact: true })).toHaveCount(0);
  await page.evaluate(() => (window as any).automationRuntime.setWritable(false));
  await expect(page.getByRole('button', { name: '保存并启用', exact: true })).toBeDisabled();
  await page.evaluate(() => (window as any).automationRuntime.setWritable(true));
  await expect(page.getByRole('textbox', { name: '名称', exact: true }).last()).toHaveValue(
    '已归档',
  );
  await page.getByRole('button', { name: '保存并启用', exact: true }).click();
  await expect(page.getByRole('switch', { name: '启停「条件修改」' })).toHaveAttribute(
    'aria-checked',
    'true',
  );
});

for (const multiple of [false, true]) {
  test(`dynamic page mentions maintain PageMap on create and delete (multiple=${multiple})`, async ({
    page,
  }) => {
    await openWorkspace(page);
    await page.evaluate(
      async ({ root, multiple }) => {
        const { object } = await import(root + '/packages/core/src/index.ts');
        const runtime = (window as any).automationRuntime;
        const database = (await runtime.queryObjects({ type: 'database' }))[0];
        await runtime.ensure([database.id]);
        runtime.patch(database.id, { name: 'PageMap' });
        runtime.fields(database.id, [
          ...database.fields,
          { id: 'post', name: 'post', type: 'mention', multiple },
        ]);
        runtime.create([
          object('page', database.workspaceId, { id: 'post', title: 'post', blocks: [] }),
        ]);
        await runtime.flush();
        (window as any).pageMapFixture = {
          databaseId: database.id,
          workspaceId: database.workspaceId,
        };
      },
      { root: '/@fs' + repoRoot, multiple },
    );
    await openCenter(page);
    await page.getByRole('button', { name: '新建自动化', exact: true }).first().click();
    await page.getByRole('textbox', { name: '名称', exact: true }).fill('索引新增');
    await page.getByRole('button', { name: '页面创建时', exact: true }).click();
    await select(page, '页面范围', 'post');
    await page.getByRole('button', { name: '选择要执行的操作', exact: true }).click();
    await page.getByRole('button', { name: '新增记录', exact: true }).click();
    await select(page, '选择数据表', 'PageMap');
    await select(page, '添加属性', 'post');
    await page.getByRole('button', { name: '为「post」插入变量', exact: true }).click();
    await page.getByRole('option', { name: '触发页面 提及', exact: true }).first().click();
    await expect(page.getByRole('region', { name: '第 2 步', exact: true })).toContainText(
      '触发页面',
    );
    await page.getByRole('button', { name: '保存并启用', exact: true }).click();
    await expect(page.getByRole('switch', { name: '启停「索引新增」' })).toHaveAttribute(
      'aria-checked',
      'true',
    );
    await page.getByRole('button', { name: '新建自动化', exact: true }).first().click();
    await page.getByRole('textbox', { name: '名称', exact: true }).fill('索引删除');
    await page.getByRole('button', { name: '页面删除时', exact: true }).click();
    await select(page, '页面范围', 'post');
    await page.getByRole('button', { name: '选择要执行的操作', exact: true }).click();
    await page.getByRole('button', { name: '删除记录', exact: true }).click();
    await select(page, '选择数据表', 'PageMap');
    await select(page, '选择记录', '满足条件的记录');
    await page.getByRole('button', { name: '添加条件', exact: true }).click();
    await select(page, '字段', 'post');
    await page.getByRole('button', { name: '为「post」插入变量', exact: true }).click();
    await page.getByRole('option', { name: '触发页面 提及', exact: true }).first().click();
    await page.getByRole('button', { name: '保存并启用', exact: true }).click();
    await expect(page.getByRole('switch', { name: '启停「索引删除」' })).toHaveAttribute(
      'aria-checked',
      'true',
    );
    await page.keyboard.press('Escape');
    await page.keyboard.press('Escape');
    const result = await page.evaluate(async (root) => {
      const { object } = await import(root + '/packages/core/src/index.ts');
      const runtime = (window as any).automationRuntime;
      const { workspaceId, databaseId } = (window as any).pageMapFixture;
      await runtime.ensure(['post']);
      runtime.create(
        ['article1', 'article2', 'outside'].map((id) =>
          object('page', workspaceId, {
            id,
            title: 'Same title',
            parentId: id === 'outside' ? null : 'post',
            blocks: [],
          }),
        ),
      );
      await runtime.flush();
      await runtime.automation.idle();
      const before = await runtime.queryObjects({ type: 'record' });
      runtime.patch('article1', { title: 'Renamed' });
      await runtime.flush();
      runtime.patch('article1', { deleted: true });
      await runtime.flush();
      await runtime.automation.idle();
      const after = await runtime.queryObjects({ type: 'record' });
      return {
        workspaceId,
        before: before.filter((r: any) => r.databaseId === databaseId),
        after: after.filter((r: any) => r.databaseId === databaseId),
        errors: runtime.automation.getRuns().filter((r: any) => r.status === 'failed'),
      };
    }, '/@fs' + repoRoot);
    expect(result.before).toHaveLength(2);
    for (const row of result.before) {
      const mention = {
        workspaceId: result.workspaceId,
        kind: 'page',
        id: Array.isArray(row.properties!.post)
          ? (row.properties!.post as any)[0].id
          : (row.properties!.post as any).id,
      };
      expect(row.properties!.post).toEqual(multiple ? [mention] : mention);
    }
    const references = (row: any) =>
      Array.isArray(row.properties.post) ? row.properties.post : [row.properties.post];
    expect(result.after.find((row: any) => references(row)[0].id === 'article1')?.deleted).toBe(
      true,
    );
    expect(
      result.after.find((row: any) => references(row)[0].id === 'article2')?.deleted,
    ).toBeFalsy();
    expect(result.errors).toEqual([]);
  });
}

test('browser runtime handles delete snapshots, cross-database changes, body writes and interrupted reads', async ({
  page,
}) => {
  await page.goto('/@fs' + repoRoot + '/packages/web-editor/dist/index.html');
  await page.waitForFunction(() => !!(window as any).TioEditor);
  const result = await page.evaluate(async (root) => {
    const { object, textBlock } = await import(root + '/packages/core/src/index.ts');
    const { MemoryRepository } = await import(root + '/packages/provider-memory/src/index.ts');
    const { WorkspaceRuntime } = await import(root + '/packages/workspace/src/index.ts');
    const { AutomationRunner } = await import(root + '/packages/automation/src/index.ts');
    const repository = new MemoryRepository();
    const ref = (path: string) => ({ kind: 'reference', path });
    const rule = (id: string, trigger: unknown, actions: unknown[]) =>
      object('automation', 'browser', { id, name: id, enabled: true, trigger, actions });
    await repository.commit({
      id: 'seed',
      expectedVersion: 0,
      assetIds: [],
      changes: [
        object('workspace', 'browser', { id: 'browser', name: 'Browser' }),
        ...['index', 'log'].map((id) =>
          object('database', 'browser', {
            id,
            name: id,
            fields: [{ id: 'title', name: 'Title', type: 'title' }],
          }),
        ),
        object('page', 'browser', { id: 'parent', title: 'Parent', blocks: [] }),
        rule('create', { kind: 'page.created' }, [
          {
            id: 'add',
            kind: 'record.create',
            databaseId: 'index',
            properties: { title: ref('trigger.id') },
            body: { mode: 'replace', template: '{{trigger.title}}' },
          },
        ]),
        rule('delete', { kind: 'page.deleted' }, [
          {
            id: 'remove',
            kind: 'record.delete',
            databaseId: 'index',
            target: {
              kind: 'matching',
              condition: {
                mode: 'all',
                filters: [{ fieldId: 'title', op: 'eq', value: ref('before.id') }],
              },
            },
          },
        ]),
        rule('change', { kind: 'record.properties', databaseId: 'index' }, [
          {
            id: 'add',
            kind: 'record.create',
            databaseId: 'log',
            properties: { title: ref('after.properties.title') },
            body: { mode: 'append', template: 'Changed' },
          },
        ]),
      ],
    });
    const runtime = await WorkspaceRuntime.open(repository);
    const runner = new AutomationRunner(runtime, 'browser');
    runtime.automation = runner;
    const settle = async () => {
      await runtime.flush();
      await runner.idle();
    };
    runtime.create([
      object('page', 'browser', { id: 'new', title: 'New', blocks: [textBlock('Body')] }),
    ]);
    await settle();
    const row = (await runtime.queryObjects({ databaseId: 'index' }))[0];
    runtime.cell(row.id, 'title', 'Edited');
    await settle();
    const logs = await runtime.queryObjects({ databaseId: 'log' });
    runtime.cell(row.id, 'title', 'new');
    await settle();
    runtime.patch('new', { deleted: true });
    await settle();
    const deleted = (await runtime.queryObjects({ databaseId: 'index' }))[0].deleted;
    const query = repository.queryObjects.bind(repository);
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    repository.queryObjects = async (request: any) => {
      await gate;
      return query(request);
    };
    runtime.create([
      object('page', 'browser', { id: 'interrupted', title: 'Interrupted', blocks: [] }),
    ]);
    await runtime.flush();
    runner.dispose();
    release();
    await runner.idle();
    runtime.dispose();
    const reopened = await WorkspaceRuntime.open(repository);
    const fresh = new AutomationRunner(reopened, 'browser');
    await fresh.idle();
    const activeRows = (await reopened.queryObjects({ databaseId: 'index' })).filter(
      (o: any) => !o.deleted,
    ).length;
    const runs = fresh.getRuns().length;
    fresh.dispose();
    reopened.dispose();
    return {
      deleted,
      originalBody: row.blocks,
      logBody: logs[0].blocks,
      logTitle: logs[0].properties.title,
      activeRows,
      runs,
    };
  }, '/@fs' + repoRoot);
  expect(result.deleted).toBe(true);
  expect(JSON.stringify(result.originalBody)).toContain('New');
  expect(JSON.stringify(result.logBody)).toContain('Changed');
  expect(result.logTitle).toBe('Edited');
  expect(result.activeRows).toBe(0);
  expect(result.runs).toBe(0);
});
