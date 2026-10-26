import { HostError, object, textBlock, type WorkspaceRepository } from '@tio/core';
import { FileRepository, FileWorkspaceContent } from '@tio/file-storage';
import { createLoopback, BridgeRepository, serveHost } from '@tio/host-protocol';
import { MemoryProvider, MemoryRepository } from '@tio/provider-memory';
import { WorkspaceRuntime, executeBasic } from '@tio/workspace';
import { describe, expect, it, vi } from 'vitest';

import type { FileJournalState } from '../packages/file-storage/src/repository';

function folder() {
  const files = new MemoryProvider();
  const content = new FileWorkspaceContent(files, 'w');
  let saved: FileJournalState | undefined;
  const journal = {
    load: async () => structuredClone(saved),
    save: async (state: FileJournalState) => {
      saved = structuredClone(state);
    },
  };
  return { files, content, journal, repository: new FileRepository(content, 'w', journal) };
}
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

it('runs filtering and sorting before record pagination', async () => {
  const host = new MemoryRepository();
  const db = object('database', 'w', {
    id: 'db',
    fields: [{ id: 'n', name: 'N', type: 'number' }],
  });
  const records = [1, 3, 2].map((n) =>
    object('record', 'w', { id: 'r' + n, databaseId: 'db', properties: { n }, blocks: [] }),
  );
  await host.commit({ id: 'seed', expectedVersion: 0, changes: [db, ...records], assetIds: [] });
  const view = object('databaseView', 'w', {
    databaseId: 'db',
    filters: [{ fieldId: 'n', op: 'gt', value: 1 }],
    sorts: [{ fieldId: 'n', direction: 'desc' }],
  });
  const first = await host.queryRecords({ databaseId: 'db', view, limit: 1 });
  expect(first.entries[0].object.id).toBe('r3');
  const second = await host.queryRecords({ databaseId: 'db', view, limit: 1, after: first.next });
  expect(second.entries[0].object.id).toBe('r2');
  expect(second.next).toBeUndefined();
});

describe('direct file repository', () => {
  it('writes files, compacts body receipts, reopens and supports headless commands', async () => {
    const f = folder();
    const runtime = await WorkspaceRuntime.open(f.repository);
    runtime.create([page('a')]);
    await runtime.flush();
    expect((await f.content.read('a'))?.title).toBe('a');
    const journal = await f.journal.load();
    expect(journal?.pending).toBeUndefined();
    expect(journal?.receipts).toEqual({});
    expect(JSON.stringify(journal)).not.toContain('blocks');
    runtime.dispose();
    f.repository.close();
    const reopened = new FileRepository(f.content, 'w', f.journal);
    await executeBasic(reopened, {
      version: 1,
      workspaceId: 'w',
      type: 'rename',
      id: 'a',
      name: 'headless',
    });
    expect((await f.content.read('a'))?.title).toBe('headless');
    reopened.close();
  });
  it('recovers an interrupted multi-object publication and never acknowledges early', async () => {
    const f = folder();
    let count = 0;
    f.files.beforeWrite = async (path) => {
      if (path.includes('/objects/') && ++count === 2) throw new Error('interrupted');
    };
    const request = {
      id: 'write',
      clientId: 'client',
      sequence: 1,
      expectedVersion: 0,
      changes: [page('a'), page('b')],
      assetIds: [],
    };
    await expect(f.repository.commit(request)).rejects.toThrow('interrupted');
    expect((await f.journal.load())?.pending?.request.id).toBe('write');
    expect((await f.journal.load())?.receipts.write).toBeUndefined();
    f.repository.close();
    f.files.beforeWrite = undefined;
    const reopened = new FileRepository(f.content, 'w', f.journal);
    expect(await reopened.getCommitResult('write')).toMatchObject({ status: 'committed' });
    expect((await reopened.readSnapshot()).entries).toHaveLength(2);
    await reopened.acknowledgeCommits('client', 1);
    expect(await reopened.commit(request)).toMatchObject({ status: 'compacted' });
    reopened.close();
  });
  it('refuses to overwrite an external edit during recovery', async () => {
    const f = folder();
    let count = 0;
    f.files.beforeWrite = async () => {
      if (++count === 2) throw new Error('interrupted');
    };
    await expect(
      f.repository.commit({
        id: 'write',
        expectedVersion: 0,
        changes: [page('a'), page('b')],
        assetIds: [],
      }),
    ).rejects.toThrow();
    f.files.beforeWrite = undefined;
    await f.content.write(page('a', 'external'));
    await expect(f.repository.getCommitResult('write')).rejects.toMatchObject({ code: 'conflict' });
    expect((await f.content.read('a'))?.title).toBe('external');
    expect((await f.journal.load())?.pending).toBeDefined();
    f.repository.close();
  });
  it('retains the journal on revoked write access and recovers after reauthorization', async () => {
    const f = folder();
    let count = 0;
    f.files.beforeWrite = async () => {
      if (++count === 2) throw new Error('interrupted');
    };
    await expect(
      f.repository.commit({
        id: 'write',
        expectedVersion: 0,
        changes: [page('a'), page('b')],
        assetIds: [],
      }),
    ).rejects.toThrow();
    f.files.beforeWrite = undefined;
    const authorize = f.content.authorize.bind(f.content);
    f.content.authorize = async () => ({ version: 'denied', allows: (_r, op) => op === 'read' });
    await expect(f.repository.getCommitResult('write')).rejects.toThrow();
    expect((await f.journal.load())?.pending).toBeDefined();
    f.content.authorize = authorize;
    expect(await f.repository.getCommitResult('write')).toMatchObject({ status: 'committed' });
    f.repository.close();
  });
  it('reports missing files rather than inventing tombstones or an incomplete export', async () => {
    const f = folder();
    await f.repository.commit({
      id: 'write',
      expectedVersion: 0,
      changes: [page('a')],
      assetIds: [],
    });
    f.files.files.delete('workspaces/w/objects/a.json');
    await expect(f.repository.readSnapshot()).rejects.toThrow('missing');
    f.repository.close();
  });
});

it('bridges partial reads, navigation, provider capabilities and record pagination', async () => {
  const host = new MemoryRepository();
  await host.commit({ id: 'seed', expectedVersion: 0, changes: [page('a')], assetIds: [] });
  const loop = createLoopback();
  const context = { workspaceId: 'w', sessionId: 's' };
  const stop = serveHost(loop.host, context, host);
  const bridge = new BridgeRepository(loop.client, context);
  await bridge.connect();
  expect(bridge.storageCapabilities?.persistence).toBe('atomic');
  expect((await bridge.queryNavigation({ limit: 10 })).items[0].blocks).toBeUndefined();
  expect((await bridge.readObjects(['a'])).entries[0].object.blocks).toHaveLength(1);
  await expect(bridge.scan({ limit: 0 })).rejects.toBeInstanceOf(HostError);
  bridge.dispose();
  stop();
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

it('reports denied and missing loads separately without failing the selected document', async () => {
  const host = new MemoryRepository({
    version: 'test',
    allows: (resource) => resource.id !== 'secret',
  });
  // Seed through the reference access policy, then use a restricted reader.
  const source = new MemoryRepository();
  await source.commit({ id: 'seed', expectedVersion: 0, changes: [page('a')], assetIds: [] });
  host.queryNavigation = (query) => source.queryNavigation(query);
  host.readObjects = async (ids) =>
    ids.includes('secret')
      ? { version: 1, entries: [], denied: ['secret'] }
      : source.readObjects(ids);
  const runtime = await WorkspaceRuntime.open(host, undefined, undefined, { targetId: 'a' });
  await runtime.ensure(['secret', 'absent']);
  expect(runtime.state.getState().loads).toMatchObject({
    a: 'ready',
    secret: 'denied',
    absent: 'missing',
  });
  expect(runtime.state.getState().error).toBeNull();
  runtime.dispose();
});

it('queries mention metadata through folder and JSON bridge without populating body caches', async () => {
  const repo = folder().repository;
  await repo.commit({
    id: 'mention-seed',
    expectedVersion: 0,
    changes: [page('a', 'Alpha'), page('b', 'Beta'), { ...page('gone'), deleted: true }],
    assetIds: [],
  });
  const pair = createLoopback();
  const context = { sessionId: 'mention-session', workspaceId: 'w' };
  const stop = serveHost(pair.host, context, repo);
  const bridge = new BridgeRepository(pair.client, context);
  await bridge.connect();
  const runtime = await WorkspaceRuntime.open(bridge, undefined, undefined, { targetId: 'a' });
  expect((await runtime.mentionCandidates('Beta')).items.map((o) => o.id)).toEqual(['b']);
  const result = await runtime.mentionMetadata(['b', 'gone', 'absent']);
  expect(result.entries.find((e) => e.object.id === 'b')?.object.blocks).toBeUndefined();
  expect(result.entries.find((e) => e.object.id === 'gone')?.object.deleted).toBe(true);
  expect(result.missing).toContain('absent');
  expect(runtime.state.getState().loads.b).toBeUndefined();
  runtime.dispose();
  bridge.dispose();
  stop();
});
