import { object, textBlock, type WorkspaceRepository } from '@tio/core';
import { MemoryRepository } from '@tio/provider-memory';
import { WorkspaceRuntime } from '@tio/workspace';
import { expect, it, vi } from 'vitest';

const page = (id: string, title = id) =>
  object('page', 'w', { id, title, blocks: [textBlock(title)] });

it('opens a targeted body without reading a snapshot or unrelated bodies; export traverses explicitly', async () => {
  const memory = new MemoryRepository();
  await memory.commit({
    id: 'seed',
    expectedVersion: 0,
    changes: [page('a'), page('b')],
    assetIds: [],
  });
  const reads: string[][] = [];
  const repo: WorkspaceRepository = {
    readSnapshot: vi.fn(async () => {
      throw new Error('Full snapshot forbidden');
    }),
    queryNavigation: async () => ({
      version: 1,
      items: [page('a'), page('b')].map(({ blocks: _blocks, ...o }) => o),
      complete: true,
    }),
    readObjects: async (ids) => {
      reads.push(ids);
      return memory.readObjects(ids);
    },
    readChanges: (since) => memory.readChanges(since),
    scan: (query) => memory.scan(query),
    commit: (request) => memory.commit(request),
    getCommitResult: (id) => memory.getCommitResult(id),
    subscribeChanges: (listener) => memory.subscribeChanges(listener),
    stageAsset: (id, data) => memory.stageAsset(id, data),
    readAsset: (id) => memory.readAsset(id),
    releaseAsset: (id) => memory.releaseAsset(id),
  };
  const runtime = await WorkspaceRuntime.open(repo, undefined, undefined, { targetId: 'a' });
  expect(reads).toEqual([['a']]);
  expect(runtime.state.getState().loads.b).toBeUndefined();
  expect(runtime.snapshot().find((o) => o.id === 'b')?.blocks).toBeUndefined();
  await Promise.all([runtime.ensure(['b']), runtime.ensure(['b'])]);
  expect(reads.filter((ids) => ids.includes('b'))).toHaveLength(1);
  expect((await runtime.exportObjects()).map((o) => o.id)).toEqual(['a', 'b']);
  runtime.dispose();
});

it('partial body reads do not consume changes to other loaded objects', async () => {
  const host = new MemoryRepository();
  await host.commit({
    id: 'seed',
    expectedVersion: 0,
    changes: [page('a'), page('b')],
    assetIds: [],
  });
  const runtime = await WorkspaceRuntime.open(host, undefined, undefined, { targetId: 'a' });
  await host.commit({
    id: 'outside',
    expectedVersion: 1,
    changes: [page('a', 'new')],
    assetIds: [],
  });
  await runtime.ensure(['b']);
  await runtime.poll();
  expect(runtime.snapshot().find((o) => o.id === 'a')?.title).toBe('new');
  runtime.dispose();
});

it('queues writes to unloaded records and retains the complete object', async () => {
  const host = new MemoryRepository();
  const db = object('database', 'w', {
    id: 'db',
    fields: [{ id: 'name', name: 'Name', type: 'text' }],
  });
  const record = object('record', 'w', {
    id: 'r',
    databaseId: 'db',
    properties: { name: 'old' },
    blocks: [textBlock('retain body')],
  });
  await host.commit({ id: 'seed', expectedVersion: 0, changes: [db, record], assetIds: [] });
  const runtime = await WorkspaceRuntime.open(host);
  runtime.cell('r', 'name', 'new');
  runtime.append('r', textBlock('append'));
  await runtime.flush();
  const result = (await host.readObjects(['r'])).entries[0].object;
  expect(result.properties?.name).toBe('new');
  expect(result.blocks).toHaveLength(2);
  runtime.undo();
  await runtime.flush();
  expect((await host.readObjects(['r'])).entries[0].object.blocks).toHaveLength(1);
  runtime.dispose();
});

it('keeps a failed dependency load pending and retries the original command', async () => {
  const host = new MemoryRepository();
  await host.commit({
    id: 'seed',
    expectedVersion: 0,
    changes: [page('a'), page('b')],
    assetIds: [],
  });
  const runtime = await WorkspaceRuntime.open(host, undefined, undefined, { targetId: 'a' });
  const read = host.readObjects.bind(host);
  let fail = true;
  host.readObjects = async (ids) => {
    if (fail && ids.includes('b')) throw new Error('network');
    return read(ids);
  };
  runtime.patch('b', { title: 'retry original' });
  await expect(runtime.flush()).rejects.toThrow('network');
  expect(runtime.state.getState().pending).toBe(1);
  expect(() => runtime.dispose()).toThrow();
  fail = false;
  await runtime.retry();
  expect((await read(['b'])).entries[0].object.title).toBe('retry original');
  expect(runtime.state.getState().pending).toBe(0);
  runtime.dispose();
});

it('captures edit time before dependency reads and keeps it through load failure and retry', async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  const created = '2020-01-01T00:00:00.000Z';
  const intended = '2030-01-01T00:00:00.000Z';
  const repository = new MemoryRepository();
  await repository.commit({
    id: 'timestamp-seed',
    expectedVersion: 0,
    changes: [
      object('page', 'w', {
        id: 'a',
        title: 'a',
        blocks: [],
        createdAt: created,
        updatedAt: created,
      }),
      object('page', 'w', {
        id: 'b',
        title: 'b',
        blocks: [],
        createdAt: created,
        updatedAt: created,
      }),
    ],
    assetIds: [],
  });
  const runtime = await WorkspaceRuntime.open(repository, undefined, undefined, { targetId: 'a' });
  try {
    const read = repository.readObjects.bind(repository);
    let fail = true;
    repository.readObjects = async (ids) => {
      if (fail && ids.includes('b')) throw new Error('Dependency unavailable');
      return read(ids);
    };
    vi.setSystemTime(new Date(intended));
    runtime.patch('b', { title: 'Edited once' });
    await expect(runtime.flush()).rejects.toThrow('Dependency unavailable');
    vi.setSystemTime(new Date('2040-01-01T00:00:00.000Z'));
    fail = false;
    await runtime.retry();
    expect((await read(['b'])).entries[0].object).toMatchObject({
      createdAt: created,
      updatedAt: intended,
    });
    const reopened = await WorkspaceRuntime.open(repository, undefined, undefined, {
      targetId: 'b',
    });
    expect(reopened.snapshot().find((o) => o.id === 'b')?.updatedAt).toBe(intended);
    reopened.dispose();
  } finally {
    runtime.dispose(true);
    vi.useRealTimers();
  }
});
