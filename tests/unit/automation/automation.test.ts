import {
  AutomationRunner,
  sessionAutomationCapabilities,
  eventKinds,
  renderTemplate,
  matchesCondition,
  reference,
} from '@tio/automation';
import {
  object,
  textBlock,
  fullAccess,
  HostError,
  validate,
  type AutomationRule,
  type AutomationAction,
  type AutomationCondition,
  type CommittedMutation,
  type TioObject,
  type AccessPolicy,
} from '@tio/core';
import { BridgeRepository, createLoopback, serveHost } from '@tio/host-protocol';
import { MemoryRepository } from '@tio/provider-memory';
import { exportZip, importZip } from '@tio/serialization';
import { WorkspaceRuntime } from '@tio/workspace';
import { afterEach, describe, expect, it, vi } from 'vitest';
const cleanup: (() => void)[] = [];
afterEach(() => {
  cleanup
    .splice(0)
    .reverse()
    .forEach((fn) => fn());
});
const literal = (value: string | number | boolean) => ({ kind: 'literal' as const, value });
const ref = (path: string) => ({ kind: 'reference' as const, path });
function rule(
  id: string,
  trigger: AutomationRule['trigger'],
  actions: AutomationAction[],
  condition?: AutomationCondition,
) {
  return object('automation', 'w', {
    id,
    name: id,
    enabled: true,
    trigger,
    actions,
    ...(condition ? { condition } : {}),
  }) as AutomationRule;
}
function createAction(
  properties: AutomationAction['properties'] = { title: ref('trigger.id') },
  databaseId = 'db',
): AutomationAction {
  return { id: 'create', kind: 'record.create', databaseId, properties };
}
function updateAction(value: string, databaseId = 'db'): AutomationAction {
  return {
    id: 'update',
    kind: 'record.update',
    databaseId,
    target: { kind: 'trigger' },
    properties: { title: literal(value) },
  };
}
const page = (id: string, title = id) =>
  object('page', 'w', { id, title, parentId: null, blocks: [] });
const record = (id: string, properties: Record<string, unknown> = {}, databaseId = 'db') =>
  object('record', 'w', {
    id,
    databaseId,
    properties: { title: id, ...properties },
    blocks: [],
    future: { preserved: true },
  });
async function setup(
  rules: AutomationRule[] = [],
  records: TioObject[] = [],
  access: AccessPolicy = fullAccess,
  capabilities = sessionAutomationCapabilities,
) {
  const repository = new MemoryRepository(access);
  const fields = [
    { id: 'title', name: 'Title', type: 'title' },
    { id: 'count', name: 'Count', type: 'number' },
    { id: 'done', name: 'Done', type: 'boolean' },
  ];
  await repository.commit({
    id: 'seed',
    expectedVersion: 0,
    assetIds: [],
    changes: [
      object('workspace', 'w', { id: 'w', name: 'Workspace' }),
      object('database', 'w', { id: 'db', name: 'Database', fields }),
      object('database', 'w', { id: 'other', name: 'Other', fields }),
      page('home'),
      ...rules,
      ...records,
    ],
  });
  const runtime = await WorkspaceRuntime.open(repository, access, undefined, { targetId: 'home' });
  const runner = new AutomationRunner(runtime, 'w', { capabilities });
  runtime.automation = runner;
  cleanup.push(() => runtime.dispose(true));
  const all = async () => (await repository.readSnapshot()).entries.map((e) => e.object);
  const settle = async () => {
    await runtime.flush();
    await runner.idle();
  };
  return { repository, runtime, runner, all, settle };
}
describe('automation event and command boundaries', () => {
  it('loads a database which has never been displayed and creates records with plain body templates', async () => {
    const action = {
      ...createAction({ title: ref('trigger.title') }),
      body: { mode: 'replace' as const, template: 'Page {{trigger.id}}\n{{trigger.title}}' },
    };
    const { runtime, all, settle, runner } = await setup([
      rule('rule', { kind: 'page.created' }, [action]),
    ]);
    expect(runtime.state.getState().loads.db).toBeUndefined();
    runtime.create([page('new', '<script>text</script>')]);
    await settle();
    const created = (await all()).find((o) => o.type === 'record')!;
    expect(created.properties?.title).toBe('<script>text</script>');
    expect(created.blocks?.map((b) => b.content)).toEqual([
      [{ type: 'text', text: 'Page new', styles: {} }],
      [{ type: 'text', text: '<script>text</script>', styles: {} }],
    ]);
    expect(runner.getRuns()[0].status).toBe('success');
  });
  it('uses deletion snapshots and only emits explicit parent deletion', async () => {
    const { runtime, all, settle } = await setup([
      rule('rule', { kind: 'page.deleted' }, [createAction({ title: ref('before.title') })]),
    ]);
    runtime.create([page('parent'), { ...page('child'), parentId: 'parent' }]);
    await settle();
    runtime.patch('parent', { deleted: true });
    await settle();
    expect(
      (await all()).filter((o) => o.type === 'record').map((o) => o.properties?.title),
    ).toEqual(['parent']);
    runtime.restoreObject('parent');
    await settle();
    expect((await all()).filter((o) => o.type === 'record')).toHaveLength(1);
  });
  it('does not trigger on load, initial records, imports, sync ingress, enabling a rule or no-op edits', async () => {
    const r = rule('rule', { kind: 'page.created' }, [createAction()]);
    const { runtime, repository, runner, settle } = await setup([r]);
    expect(runner.getRuns()).toHaveLength(0);
    runtime.import([page('imported')]);
    await settle();
    const snapshot = await repository.readSnapshot();
    await repository.commit({
      id: 'sync',
      source: { kind: 'sync' },
      origin: 'sync',
      expectedVersion: snapshot.version,
      changes: [page('remote')],
      assetIds: [],
    });
    await runtime.poll();
    runtime.patch('home', { title: 'home' });
    runtime.patch('rule', { enabled: false });
    await settle();
    runtime.patch('rule', { enabled: true });
    await settle();
    expect(runner.getRuns()).toHaveLength(0);
  });
  it('delivers one semantic event after recovery of a lost ACK, including original before state', async () => {
    const { runtime, repository, settle } = await setup();
    const events: CommittedMutation[] = [];
    runtime.subscribeCommits((event) => events.push(event));
    const commit = repository.commit.bind(repository);
    vi.spyOn(repository, 'commit').mockImplementationOnce(async (request) => {
      await commit(request);
      throw new HostError('timeout');
    });
    runtime.patch('home', { title: 'Saved' });
    await expect(runtime.flush()).rejects.toThrow();
    expect(events).toHaveLength(0);
    await runtime.retry();
    await settle();
    expect(events).toHaveLength(1);
    expect(events[0].changes[0]).toMatchObject({
      before: { title: 'home' },
      after: { title: 'Saved' },
    });
  });
  it('uses undo and redo as real mutations without putting automation in user history', async () => {
    const { runtime, runner, settle } = await setup([
      rule('rule', { kind: 'page.deleted' }, [createAction()]),
    ]);
    runtime.patch('home', { deleted: true });
    await settle();
    expect(runner.getRuns()).toHaveLength(1);
    runtime.undo();
    await settle();
    expect(runtime.snapshot().find((o) => o.id === 'home')?.deleted).toBeFalsy();
    runtime.redo();
    await settle();
    expect(runner.getRuns()).toHaveLength(2);
  });
  it('fails permissions without bypassing access policy', async () => {
    const access: AccessPolicy = {
      version: 'denied',
      allows: (resource, operation) => !(resource.type === 'record' && operation === 'create'),
    };
    const { runtime, all, runner, settle } = await setup(
      [rule('rule', { kind: 'page.created' }, [createAction()])],
      [],
      access,
    );
    runtime.create([page('new')]);
    await settle();
    expect(runner.getRuns()[0]).toMatchObject({ status: 'failed', error: 'permission' });
    expect((await all()).some((o) => o.type === 'record')).toBe(false);
  });
  it('rejects automation over unconfirmed drafts and leaves user text intact', async () => {
    const { runtime, runner, all, settle } = await setup([
      rule('rule', { kind: 'page.created' }, [createAction()]),
    ]);
    const owner = Symbol('draft');
    runtime.recordDraft(owner, '', 'Unsaved', () => {});
    runtime.create([page('new')]);
    await settle();
    expect(runner.getRuns()[0]).toMatchObject({ error: 'conflict' });
    expect((await all()).some((o) => o.type === 'record')).toBe(false);
    runtime.discardDraft(owner);
  });
});
describe('automation conditions, actions and execution chains', () => {
  it('triggers only selected editable fields and enters a condition once per transition', async () => {
    const condition: AutomationCondition = {
      mode: 'all',
      filters: [{ fieldId: 'done', op: 'eq', value: literal(true) }],
    };
    const { runtime, runner, settle } = await setup(
      [
        rule('selected', { kind: 'record.properties', databaseId: 'db', fieldIds: ['count'] }, [
          createAction({}, 'other'),
        ]),
        rule(
          'enters',
          { kind: 'record.entersCondition', databaseId: 'db' },
          [createAction({}, 'other')],
          condition,
        ),
      ],
      [record('row', { done: false })],
    );
    runtime.cell('row', 'done', true);
    await settle();
    expect(
      runner.getRuns().filter((r) => r.ruleId === 'enters' && r.status === 'success'),
    ).toHaveLength(1);
    runtime.cell('row', 'title', 'New title');
    await settle();
    expect(
      runner.getRuns().filter((r) => r.ruleId === 'enters' && r.status === 'success'),
    ).toHaveLength(1);
    runtime.cell('row', 'count', 4);
    await settle();
    expect(
      runner.getRuns().filter((r) => r.ruleId === 'selected' && r.status === 'success'),
    ).toHaveLength(1);
    runtime.cell('row', 'done', false);
    await settle();
    runtime.cell('row', 'done', true);
    await settle();
    expect(
      runner.getRuns().filter((r) => r.ruleId === 'enters' && r.status === 'success'),
    ).toHaveLength(2);
  });
  it('passes prior step IDs to following actions and preserves unknown content during append', async () => {
    const first = {
      ...createAction({ title: ref('trigger.title') }),
      body: { mode: 'replace' as const, template: 'First' },
    };
    const second: AutomationAction = {
      id: 'append',
      kind: 'record.update',
      databaseId: 'db',
      target: { kind: 'record', id: ref('steps.create.ids') },
      properties: { count: literal(3) },
      body: { mode: 'append', template: 'Second' },
    };
    const { runtime, runner, all, settle } = await setup([
      rule('rule', { kind: 'page.created' }, [first, second]),
    ]);
    runtime.create([page('new', 'Hello')]);
    await settle();
    const row = (await all()).find((o) => o.type === 'record')!;
    expect(row.properties).toEqual({ title: 'Hello', count: 3 });
    expect(row.blocks).toHaveLength(2);
    expect(runner.getRuns()[0].steps[0].recordIds).toEqual(runner.getRuns()[0].steps[1].recordIds);
  });
  it('updates trigger properties and appends body without dropping opaque fields', async () => {
    const r = record('row');
    r.blocks = [{ ...textBlock('opaque'), type: 'future', payload: { keep: true } }];
    const action = {
      ...updateAction('After'),
      body: { mode: 'append' as const, template: 'Plain' },
    };
    const { runtime, all, settle } = await setup(
      [rule('rule', { kind: 'record.body', databaseId: 'db' }, [action])],
      [r],
    );
    await runtime.ensure(['row']);
    runtime.blocks('row', [...r.blocks, textBlock('User')], r.blocks);
    await settle();
    const result = (await all()).find((o) => o.id === 'row')!;
    expect(result.future).toEqual({ preserved: true });
    expect(result.blocks?.[0]).toEqual(r.blocks[0]);
    expect(result.blocks).toHaveLength(3);
  });
  it('captures all matching IDs before deleting more than one query page', async () => {
    const action: AutomationAction = {
      id: 'delete',
      kind: 'record.delete',
      databaseId: 'db',
      target: {
        kind: 'matching',
        condition: { mode: 'all', filters: [{ fieldId: 'done', op: 'eq', value: literal(true) }] },
      },
    };
    const { runtime, runner, all, settle } = await setup(
      [rule('rule', { kind: 'page.created' }, [action])],
      Array.from({ length: 105 }, (_, i) => record(`row_${i}`, { done: true })),
    );
    runtime.create([page('new')]);
    await settle();
    expect((await all()).filter((o) => o.type === 'record' && o.deleted)).toHaveLength(105);
    expect(runner.getRuns()[0].status).toBe('success');
  });
  it('does not treat database views as records when matching all targets', async () => {
    const action: AutomationAction = {
      id: 'delete',
      kind: 'record.delete',
      databaseId: 'db',
      target: { kind: 'matching', condition: { mode: 'all', filters: [] } },
    };
    const view = object('databaseView', 'w', {
      id: 'view',
      databaseId: 'db',
      name: 'Table',
      layout: 'table',
      visibleFieldIds: ['title'],
      filters: [],
      sorts: [],
    });
    const { runtime, runner, all, settle } = await setup(
      [rule('rule', { kind: 'page.created' }, [action])],
      [record('row'), view],
    );
    runtime.create([page('new')]);
    await settle();
    expect(runner.getRuns()[0].status).toBe('success');
    expect((await all()).find((o) => o.id === 'view')?.deleted).toBeUndefined();
    expect((await all()).find((o) => o.id === 'row')?.deleted).toBe(true);
  });
  it('allows cross-database chains and stops a repeated rule before another write', async () => {
    const { runtime, runner, all, settle } = await setup([
      rule('a', { kind: 'record.created', databaseId: 'db' }, [createAction({}, 'other')]),
      rule('b', { kind: 'record.created', databaseId: 'other' }, [createAction({}, 'db')]),
    ]);
    runtime.create([record('new')]);
    await settle();
    expect((await all()).filter((o) => o.type === 'record')).toHaveLength(3);
    expect(runner.getRuns()[0]).toMatchObject({ ruleId: 'a', status: 'skipped', error: 'cycle' });
    expect(new Set(runner.getRuns().map((r) => r.rootEventId)).size).toBe(1);
  });
  it('enforces shared write budgets and reports partial completion', async () => {
    const limits = { ...sessionAutomationCapabilities, limits: { depth: 8, runs: 100, writes: 2 } };
    const action: AutomationAction = {
      id: 'delete',
      kind: 'record.delete',
      databaseId: 'db',
      target: { kind: 'matching', condition: { mode: 'all', filters: [] } },
    };
    const { runtime, runner, all, settle } = await setup(
      [rule('rule', { kind: 'page.created' }, [action])],
      [record('one'), record('two'), record('three')],
      fullAccess,
      limits,
    );
    runtime.create([page('new')]);
    await settle();
    expect((await all()).filter((o) => o.type === 'record' && o.deleted)).toHaveLength(2);
    expect(runner.getRuns()[0]).toMatchObject({
      status: 'skipped',
      error: 'limit',
      steps: [{ recordIds: expect.any(Array) }],
    });
  });
  it('stops later steps after unavailable variables without rolling back prior writes', async () => {
    const { runtime, runner, all, settle } = await setup([
      rule('rule', { kind: 'page.created' }, [
        createAction(),
        { ...createAction({ title: ref('before.title') }), id: 'bad' },
        { ...createAction(), id: 'never' },
      ]),
    ]);
    runtime.create([page('new')]);
    await settle();
    expect((await all()).filter((o) => o.type === 'record')).toHaveLength(1);
    expect(runner.getRuns()[0]).toMatchObject({ status: 'failed', error: 'variable' });
    expect(runner.getRuns()[0].steps).toHaveLength(2);
  });
  it('abandons asynchronous reads on close and does not replay on reopening', async () => {
    const { runtime, runner, repository, all } = await setup([
      rule('rule', { kind: 'page.created' }, [createAction()]),
    ]);
    const query = repository.queryObjects.bind(repository);
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    vi.spyOn(repository, 'queryObjects').mockImplementation(async (q) => {
      await gate;
      return query(q);
    });
    runtime.create([page('new')]);
    await runtime.flush();
    runner.dispose();
    release();
    await runner.idle();
    expect((await all()).some((o) => o.type === 'record')).toBe(false);
    const reopened = await WorkspaceRuntime.open(repository);
    const fresh = new AutomationRunner(reopened, 'w');
    await fresh.idle();
    expect(fresh.getRuns()).toHaveLength(0);
    fresh.dispose();
    reopened.dispose();
  });
});
describe('dynamic page mentions', () => {
  it.each([false, true])(
    'maintains a parent-scoped page map with multiple=%s, including deletion after title changes',
    async (multiple) => {
      const created = rule('page-create', { kind: 'page.created', parentId: 'post' }, [
        {
          id: 'add',
          kind: 'record.create',
          databaseId: 'db',
          properties: { post: ref(multiple ? 'trigger.mentions' : 'trigger.mention') },
        },
      ]);
      const deleted = rule('page-delete', { kind: 'page.deleted', parentId: 'post' }, [
        {
          id: 'remove',
          kind: 'record.delete',
          databaseId: 'db',
          target: {
            kind: 'matching',
            condition: {
              mode: 'all',
              filters: [{ fieldId: 'post', op: 'eq', value: ref('trigger.mention') }],
            },
          },
        },
      ]);
      const { runtime, runner, all, settle } = await setup(
        [created, deleted],
        [page('post'), page('other-parent')],
      );
      await runtime.ensure(['db', 'post', 'other-parent']);
      const database = runtime.snapshot().find((o) => o.id === 'db')!;
      runtime.fields('db', [
        ...database.fields!,
        { id: 'post', name: 'post', type: 'mention', multiple },
      ]);
      await settle();
      runtime.create([
        { ...page('article', 'Same title'), parentId: 'post' },
        { ...page('outside', 'Same title'), parentId: 'other-parent' },
      ]);
      await settle();
      const first = (await all()).find((o) => o.type === 'record')!;
      const mention = { workspaceId: 'w', kind: 'page', id: 'article' };
      expect(first.properties?.post).toEqual(multiple ? [mention] : mention);
      expect((await all()).filter((o) => o.type === 'record')).toHaveLength(1);
      // A same-title page is a different identity and must not be removed by the deletion rule.
      const other = { workspaceId: 'w', kind: 'page', id: 'outside' };
      runtime.create([record('keep', { post: multiple ? [other] : other })]);
      await settle();
      runtime.patch('article', { title: 'Renamed before deletion' });
      await settle();
      runtime.patch('article', { deleted: true });
      await settle();
      expect((await all()).find((o) => o.id === first.id)?.deleted).toBe(true);
      expect((await all()).find((o) => o.id === 'keep')?.deleted).toBeFalsy();
      expect(runner.getRuns().some((run) => run.status === 'failed')).toBe(false);
    },
  );
  it('constructs references from snapshots and rejects record objects as page mentions', () => {
    const p = page('deleted');
    const context = {
      id: 'event',
      mutation: {
        commitId: 'commit',
        timestamp: p.createdAt!,
        source: { kind: 'editor' as const },
        changes: [],
      },
      before: p,
      after: { ...p, deleted: true },
      steps: new Map<string, string[]>(),
    };
    const mention = { workspaceId: 'w', kind: 'page', id: p.id };
    expect(reference('trigger.mention', context)).toEqual(mention);
    expect(reference('before.mentions', context)).toEqual([mention]);
    expect(reference('after.mention', context)).toEqual(mention);
    expect(() =>
      reference('trigger.mention', { ...context, before: undefined, after: record('row') }),
    ).toThrow('variable');
  });
});
describe('automation failure and budget boundaries', () => {
  it('reports a provider rejection without blocking following user commits', async () => {
    const { runtime, repository, runner, settle } = await setup([
      rule('rule', { kind: 'page.created' }, [createAction()]),
    ]);
    const commit = repository.commit.bind(repository);
    vi.spyOn(repository, 'commit').mockImplementation((request) =>
      request.source?.kind === 'automation'
        ? Promise.reject(new HostError('permission'))
        : commit(request),
    );
    runtime.create([page('new')]);
    await settle();
    expect(runner.getRuns()[0]).toMatchObject({ status: 'failed', error: 'permission' });
    runtime.patch('home', { title: 'Still editable' });
    await settle();
    expect(runtime.state.getState().status).toBe('saved');
  });
  it('reports an uncertain write failure and leaves submitted-command recovery to the repository', async () => {
    const { runtime, repository, runner } = await setup([
      rule('rule', { kind: 'page.created' }, [createAction()]),
    ]);
    const commit = repository.commit.bind(repository);
    let rejected = false;
    vi.spyOn(repository, 'commit').mockImplementation((request) => {
      if (request.source?.kind === 'automation' && !rejected) {
        rejected = true;
        return Promise.reject(new HostError('timeout'));
      }
      return commit(request);
    });
    runtime.create([page('new')]);
    await runtime.flush();
    await runner.idle();
    expect(runner.getRuns()[0]).toMatchObject({ status: 'failed', error: 'timeout' });
    expect(runtime.state.getState().pending).toBe(1);
    await runtime.retry();
    expect(runtime.state.getState().pending).toBe(0);
  });
  it('fails asynchronous rule loading explicitly and does not retry on the next edit', async () => {
    const { runtime, repository, runner, settle } = await setup([
      rule('rule', { kind: 'page.created' }, [createAction()]),
    ]);
    vi.spyOn(repository, 'queryObjects').mockRejectedValueOnce(new HostError('unavailable'));
    runtime.create([page('new')]);
    await settle();
    expect(runner.getRuns()[0]).toMatchObject({ status: 'failed', error: 'unavailable' });
    runtime.patch('home', { title: 'Next edit' });
    await settle();
    expect(runner.getRuns()).toHaveLength(1);
  });
  it('deduplicates semantic delivery and includes delete and AI sources', async () => {
    const { runtime, runner, all, settle } = await setup(
      [
        rule('rule', { kind: 'record.deleted', databaseId: 'db' }, [
          createAction({ title: ref('before.properties.title') }, 'other'),
        ]),
      ],
      [record('row')],
    );
    await runtime.ensure(['row']);
    const previous = runtime.snapshot().find((o) => o.id === 'row')!;
    const events: CommittedMutation[] = [];
    runtime.subscribeCommits((event) => events.push(event));
    await runtime.checked([previous], [{ ...previous, deleted: true }], () => {}, {
      source: { kind: 'ai' },
    });
    await settle();
    runner.accept(events[0]);
    await runner.idle();
    expect((await all()).filter((o) => o.databaseId === 'other')).toHaveLength(1);
    expect(events[0].source.kind).toBe('ai');
  });
  it('enforces chain depth independently from cycle detection', async () => {
    const capabilities = {
      ...sessionAutomationCapabilities,
      limits: { depth: 1, runs: 100, writes: 1000 },
    };
    const { runtime, runner, all, settle } = await setup(
      [
        rule('a', { kind: 'page.created' }, [createAction()]),
        rule('b', { kind: 'record.created', databaseId: 'db' }, [createAction({}, 'other')]),
      ],
      [],
      fullAccess,
      capabilities,
    );
    runtime.create([page('new')]);
    await settle();
    expect((await all()).filter((o) => o.type === 'record')).toHaveLength(1);
    expect(runner.getRuns()[0]).toMatchObject({ ruleId: 'b', status: 'skipped', error: 'limit' });
  });
  it('enforces shared run limits across sibling rules', async () => {
    const capabilities = {
      ...sessionAutomationCapabilities,
      limits: { depth: 8, runs: 1, writes: 1000 },
    };
    const { runtime, runner, all, settle } = await setup(
      [
        rule('a', { kind: 'page.created' }, [createAction()]),
        rule('b', { kind: 'page.created' }, [createAction()]),
      ],
      [],
      fullAccess,
      capabilities,
    );
    runtime.create([page('new')]);
    await settle();
    expect((await all()).filter((o) => o.type === 'record')).toHaveLength(1);
    expect(runner.getRuns()[0]).toMatchObject({ ruleId: 'b', error: 'limit' });
  });
});
describe('automation provider and persistence contracts', () => {
  it('preserves rules in JSON backups and validates malformed definitions', async () => {
    const r = rule('rule', { kind: 'page.created' }, [createAction()]);
    expect(validate(r)).toEqual(r);
    expect(() => validate({ ...r, actions: [] })).toThrow();
    expect(() =>
      validate({
        ...r,
        actions: [{ ...createAction(), body: { mode: 'append', template: '{{process.env}}' } }],
      }),
    ).toThrow();
    const archive = await exportZip(
      [object('workspace', 'w', { id: 'w', name: 'W' }), r],
      async () => undefined,
    );
    expect((await importZip(archive)).objects.find((o) => o.id === r.id)).toEqual(r);
  });
  it('reports unsupported rules without executing a fallback', async () => {
    const { runtime, runner, all, settle } = await setup(
      [rule('rule', { kind: 'page.created' }, [createAction()])],
      [],
      fullAccess,
      { ...sessionAutomationCapabilities, actions: [] },
    );
    runtime.create([page('new')]);
    await settle();
    expect(runner.getRuns()[0].error).toBe('unsupported');
    expect((await all()).some((o) => o.type === 'record')).toBe(false);
  });
  it('exposes server-owned execution over the bridge and replaces untrusted provenance', async () => {
    const { repository, runtime, runner, all } = await setup([
      rule('server-rule', { kind: 'page.created' }, [createAction()]),
    ]);
    runner.dispose();
    const server = new AutomationRunner(runtime, 'w', {
      capabilities: { ...sessionAutomationCapabilities, execution: 'server' },
      observe: false,
    });
    repository.automation = server;
    const { client: clientTransport, host: hostTransport } = createLoopback();
    const stop = serveHost(hostTransport, { sessionId: 's', workspaceId: 'w' }, repository);
    const bridge = new BridgeRepository(clientTransport, { sessionId: 's', workspaceId: 'w' });
    await bridge.connect();
    cleanup.push(() => {
      bridge.dispose();
      stop();
      server.dispose();
    });
    expect(bridge.automation?.capabilities.execution).toBe('server');
    const request = vi.spyOn(repository, 'commit');
    const snapshot = await repository.readSnapshot();
    await bridge.commit({
      id: 'client',
      expectedVersion: snapshot.version,
      changes: [page('new')],
      assetIds: [],
      source: {
        kind: 'automation',
        actionId: 'forged',
        chain: { rootEventId: 'forged', parentRunId: 'forged', rulePath: [] },
      },
    });
    expect(request.mock.calls[0][0].source).toEqual({ kind: 'editor' });
    server.accept({
      commitId: 'server-event',
      source: { kind: 'editor' },
      timestamp: new Date().toISOString(),
      changes: [{ after: page('new') }],
    });
    await server.idle();
    await Promise.resolve();
    expect(bridge.automation?.getRuns()).toEqual(server.getRuns());
    expect((await all()).filter((o) => o.type === 'record')).toHaveLength(1);
    expect(server.getRuns()[0].status).toBe('success');
  });
  it('does not synthesize create events for restored or already deleted content', () => {
    expect(eventKinds({ ...page('p'), deleted: true }, page('p'))).toEqual([]);
    expect(eventKinds(undefined, { ...page('p'), deleted: true })).toEqual([]);
  });
  it('uses the table filter semantics for any conditions and treats interpolated text literally', () => {
    const p = page('p', '{{untrusted}}');
    const context = {
      id: 'event',
      mutation: {
        commitId: 'commit',
        timestamp: p.createdAt!,
        source: { kind: 'editor' as const },
        changes: [],
      },
      after: p,
      steps: new Map(),
    };
    expect(
      matchesCondition(
        {
          mode: 'any',
          filters: [
            { fieldId: 'title', op: 'eq', value: literal('no') },
            { fieldId: 'id', op: 'eq', value: literal('p') },
          ],
        },
        p,
        undefined,
        context,
      ),
    ).toBe(true);
    expect(renderTemplate('{{trigger.title}}', context)).toBe('{{untrusted}}');
  });
});
