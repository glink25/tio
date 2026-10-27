import { fullAccess, object, type MentionReference } from '@tio/core';
import { queryRecords } from '@tio/database';
import { LocalStore } from '@tio/local-store';
import { MemoryRepository } from '@tio/provider-memory';
import { WorkspaceRuntime } from '@tio/workspace';
import { afterEach, expect, it, vi } from 'vitest';

import { createMentionService } from '../packages/web-editor/src/mentions';

afterEach(() => vi.useRealTimers());

const ref = (id: string): MentionReference => ({ workspaceId: 'w', kind: 'page', id });
it('batches metadata, redacts denied titles and separates tombstones, missing and foreign references', async () => {
  const repository = new MemoryRepository({
    ...fullAccess,
    allows: (r, op) => !(r.id === 'secret' && op === 'read'),
  });
  await repository.commit({
    id: 'seed',
    expectedVersion: 0,
    assetIds: [],
    changes: [
      object('page', 'w', { id: 'root', title: 'Root', blocks: [] }),
      object('page', 'w', { id: 'target', title: 'Target', blocks: [] }),
      object('page', 'w', { id: 'secret', title: 'Do not reveal', blocks: [] }),
      object('page', 'w', { id: 'gone', title: 'Gone', blocks: [], deleted: true }),
    ],
  });
  const runtime = await WorkspaceRuntime.open(repository, undefined, undefined, {
    targetId: 'root',
  });
  const read = vi.spyOn(repository, 'readMetadata');
  const navigate = vi.fn();
  const service = createMentionService(runtime, 'w', navigate);
  const [a, b] = await Promise.all([
    service.resolve([ref('target'), ref('secret')]),
    service.resolve([ref('gone'), ref('missing'), { ...ref('target'), workspaceId: 'other' }]),
  ]);
  expect(read).toHaveBeenCalledTimes(1);
  expect(a.map((v) => v.status)).toEqual(['ready', 'denied']);
  expect(JSON.stringify(a)).not.toContain('Do not reveal');
  expect(b.map((v) => v.status)).toEqual(['deleted', 'missing', 'denied']);
  expect(runtime.state.getState().loads.target).toBeUndefined();
  service.navigate({ ...ref('target'), workspaceId: 'other' });
  expect(navigate).not.toHaveBeenCalled();
  runtime.dispose();
});
it('device provider pages candidate matches and strips all bodies from metadata', async () => {
  const repository = new LocalStore('w', `mention-${crypto.randomUUID()}`);
  await repository.commit({
    id: 'seed',
    expectedVersion: 0,
    assetIds: [],
    changes: Array.from({ length: 55 }, (_, i) =>
      object('page', 'w', { id: `page-${String(i).padStart(2, '0')}`, title: 'Match', blocks: [] }),
    ),
  });
  const first = await repository.queryNavigation({ limit: 50, text: 'match', mentionsOnly: true });
  expect(first.items).toHaveLength(50);
  expect(first.next).toBeDefined();
  const second = await repository.queryNavigation({
    limit: 50,
    text: 'match',
    mentionsOnly: true,
    after: first.next,
  });
  expect(second.items).toHaveLength(5);
  expect((await repository.readMetadata(['page-00'])).entries[0].object.blocks).toBeUndefined();
  repository.close();
});
it('mention equality compares identity, sorting uses titles, and deletion preserves stored references', () => {
  const database = object('database', 'w', {
    id: 'd',
    fields: [{ id: 'm', name: 'Mention', type: 'mention' }],
  });
  const rows = ['a', 'b'].map((id) =>
    object('record', 'w', {
      id: `r-${id}`,
      databaseId: 'd',
      properties: { m: ref(id) },
      blocks: [],
    }),
  );
  const objects = [
    database,
    ...rows,
    object('page', 'w', { id: 'a', title: 'Zulu', blocks: [] }),
    object('page', 'w', { id: 'b', title: 'Alpha', blocks: [] }),
  ];
  expect(
    queryRecords(objects, database, {
      ...database,
      filters: [{ fieldId: 'm', op: 'eq', value: ref('a') }],
    }).map((r) => r.id),
  ).toEqual(['r-a']);
  expect(
    queryRecords(objects, database, {
      ...database,
      sorts: [{ fieldId: 'm', direction: 'asc' }],
    }).map((r) => r.id),
  ).toEqual(['r-b', 'r-a']);
  objects[3].deleted = true;
  expect(
    queryRecords(objects, database, { ...database, filters: [{ fieldId: 'm', op: 'notEmpty' }] }),
  ).toHaveLength(2);
  expect(rows[0].properties?.m).toEqual(ref('a'));
});
it('refreshes labels after an optimistic rename has been acknowledged by the provider', async () => {
  const repository = new MemoryRepository();
  await repository.commit({
    id: 'seed',
    expectedVersion: 0,
    changes: [object('page', 'w', { id: 'target', title: 'Before', blocks: [] })],
    assetIds: [],
  });
  const runtime = await WorkspaceRuntime.open(repository, undefined, undefined, {
    targetId: 'target',
  });
  const service = createMentionService(runtime, 'w', () => {});
  let title = '';
  let resolution = Promise.resolve();
  const stop = service.subscribe(() => {
    resolution = service.resolve([ref('target')]).then(([item]) => {
      if (item.status === 'ready') title = item.title;
    });
  });
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  runtime.patch('target', { title: 'After' });
  await runtime.flush();
  await vi.advanceTimersByTimeAsync(1000);
  await resolution;
  expect(title).toBe('After');
  stop();
  runtime.dispose();
});

it('coalesces editing notifications, bounds continuous edits and releases timers', async () => {
  const runtime = await WorkspaceRuntime.open(new MemoryRepository());
  const service = createMentionService(runtime, 'w', () => {});
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  const listener = vi.fn();
  const stop = service.subscribe(listener);
  const other = service.subscribe(vi.fn());
  for (let version = 1; version <= 10; version++) {
    runtime.state.setState({ version });
    await vi.advanceTimersByTimeAsync(500);
  }
  expect(listener).toHaveBeenCalledTimes(1);
  runtime.state.setState({ version: 11 });
  await vi.advanceTimersByTimeAsync(1000);
  expect(listener).toHaveBeenCalledTimes(2);
  runtime.state.setState({ version: 12 });
  stop();
  other();
  await vi.advanceTimersByTimeAsync(5000);
  expect(listener).toHaveBeenCalledTimes(2);
  runtime.dispose();
});

it('shares slow reads and refreshes again when invalidated during a read', async () => {
  const repository = new MemoryRepository();
  const runtime = await WorkspaceRuntime.open(repository);
  const service = createMentionService(runtime, 'w', () => {});
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  let release!: () => void;
  const read = vi.spyOn(repository, 'readMetadata').mockImplementationOnce(async () => {
    await new Promise<void>((resolve) => {
      release = resolve;
    });
    return { version: 0, entries: [] };
  });
  const first = service.resolve([ref('target')]);
  await Promise.resolve();
  const second = service.resolve([ref('target')]);
  const stop = service.subscribe(() => {
    void service.resolve([ref('target')]);
  });
  runtime.state.setState({ version: 1 });
  await vi.advanceTimersByTimeAsync(1000);
  expect(read).toHaveBeenCalledTimes(1);
  release();
  await Promise.all([first, second]);
  await vi.advanceTimersByTimeAsync(0);
  expect(read).toHaveBeenCalledTimes(2);
  stop();
  runtime.dispose();
});

it('redacts known revoked access immediately without waiting for slow metadata', async () => {
  let allowed = true;
  const repository = new MemoryRepository();
  await repository.commit({
    id: 'seed',
    expectedVersion: 0,
    assetIds: [],
    changes: [object('page', 'w', { id: 'target', title: 'Private title', blocks: [] })],
  });
  const runtime = await WorkspaceRuntime.open(
    repository,
    {
      ...fullAccess,
      allows: () => allowed,
    },
    undefined,
    { targetId: 'target' },
  );
  const service = createMentionService(runtime, 'w', () => {});
  expect((await service.resolve([ref('target')]))[0].status).toBe('ready');
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  const listener = vi.fn();
  const stop = service.subscribe(listener);
  allowed = false;
  runtime.state.setState({ version: 1 });
  expect(listener).toHaveBeenCalledTimes(1);
  expect(await service.resolve([ref('target')])).toEqual([
    { reference: ref('target'), status: 'denied' },
  ]);
  stop();
  runtime.dispose();
});
