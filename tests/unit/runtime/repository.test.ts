import { object, type WorkspaceRepository } from '@tio/core';
import { BridgeRepository, createLoopback, serveHost } from '@tio/host-protocol';
import { LocalStore } from '@tio/local-store';
import { MemoryRepository } from '@tio/provider-memory';
import { executeBasic, WorkspaceRuntime } from '@tio/workspace';
import { describe, expect, it } from 'vitest';
it('host and sync writes retain bounded changes instead of accumulating confirmed receipts', async () => {
  const store = new LocalStore('compact-host', crypto.randomUUID());
  try {
    await store.batch([object('page', 'w', { id: 'p', title: 'Initial', blocks: [] })]);
    for (let i = 0; i < 20; i++) {
      const entry = (await store.get('p'))!;
      await store.reconcile({ ...entry.object, title: `Remote ${i}` }, entry.revision);
      await store.change('p', (page) => ({ ...page!, title: `Host ${i}` }));
    }
    const keys = (await (await store.db).getAllKeys('settings')).map(String);
    expect(keys.filter((key) => key.includes('/$commit/'))).toHaveLength(0);
    expect(keys.filter((key) => key.includes('/$changes/'))).toHaveLength(0);
    expect(keys.filter((key) => key.includes('/$watermark/'))).toHaveLength(1);
    expect((await store.readChanges(0)).entries[0].object.title).toBe('Host 19');
  } finally {
    store.close();
  }
});
for (const kind of ['memory', 'indexeddb'])
  describe(`${kind} host contract`, () => {
    it('commits atomically, rejects stale versions and deduplicates receipts', async () => {
      const repository: WorkspaceRepository =
        kind === 'memory' ? new MemoryRepository() : new LocalStore('test', crypto.randomUUID());
      try {
        const page = object('page', 'workspace', {
          id: 'page',
          title: 'old',
          blocks: [],
          extension: { retained: true },
        });
        const request = { id: 'first', expectedVersion: 0, changes: [page], assetIds: [] };
        const first = await repository.commit(request);
        expect(await repository.commit(request)).toEqual(first);
        expect(await repository.getCommitResult('first')).toEqual(first);
        expect(await repository.commit({ ...request, id: 'stale' })).toMatchObject({
          status: 'conflict',
        });
        await expect(
          repository.commit({ ...request, changes: [{ ...page, title: 'different' }] }),
        ).rejects.toThrow('Commit ID reused');
        await expect(
          repository.commit({
            id: 'invalid',
            expectedVersion: 1,
            changes: [
              { ...page, title: 'partial' },
              object('asset', 'workspace', {
                id: 'missing',
                filename: 'x',
                mime: 'text/plain',
                byteSize: 1,
                assetPath: 'assets/missing.txt',
              }),
            ],
            assetIds: ['missing'],
          }),
        ).rejects.toThrow();
        expect((await repository.readSnapshot()).entries[0].object.title).toBe('old');
        await executeBasic(repository, {
          version: 1,
          workspaceId: 'workspace',
          type: 'appendText',
          id: 'page',
          blockId: 'append',
          text: 'Native text',
        });
        const snapshot = await repository.readSnapshot();
        expect(snapshot.entries[0].object.extension).toEqual({ retained: true });
        expect(snapshot.entries[0].object.blocks).toHaveLength(1);
      } finally {
        if (repository instanceof LocalStore) repository.close();
      }
    });
  });
it('recovers a committed request with a lost response without applying it twice', async () => {
  const repository = new MemoryRepository();
  const pair = createLoopback();
  let drop = true;
  const transport = {
    ...pair.host,
    send: (message: Parameters<typeof pair.host.send>[0]) => {
      if (drop && message.kind === 'response' && message.payload?.status === 'committed') {
        drop = false;
        return;
      }
      pair.host.send(message);
    },
  };
  const context = { sessionId: 'session', workspaceId: 'workspace' };
  const stop = serveHost(transport, context, repository);
  const bridge = new BridgeRepository(pair.client, context, 30);
  await bridge.connect();
  const runtime = await WorkspaceRuntime.open(bridge);
  runtime.create([object('page', 'workspace', { id: 'page', blocks: [], title: 'Saved' })]);
  await expect(runtime.flush()).rejects.toThrow('timeout');
  expect(runtime.snapshot()[0].title).toBe('Saved');
  await runtime.retry();
  expect((await repository.readSnapshot()).version).toBe(1);
  await bridge.stageAsset('attachment', {
    name: 'x',
    mime: 'text/plain',
    bytes: new TextEncoder().encode('binary'),
  });
  expect(await bridge.readAsset('attachment')).toBeUndefined();
  const snap = await bridge.readSnapshot();
  await bridge.commit({
    id: 'promote',
    expectedVersion: snap.version,
    changes: [],
    assetIds: ['attachment'],
  });
  expect(new TextDecoder().decode((await bridge.readAsset('attachment'))?.bytes)).toBe('binary');
  await bridge.releaseAsset('attachment');
  expect(await bridge.readAsset('attachment')).toBeDefined();
  runtime.dispose();
  bridge.dispose();
  stop();
});
it('replays local edits against an external update even if change notification was lost', async () => {
  const host = new MemoryRepository();
  await host.commit({
    id: 'seed',
    expectedVersion: 0,
    changes: [object('page', 'workspace', { id: 'page', title: 'Original', blocks: [] })],
    assetIds: [],
  });
  const repository: WorkspaceRepository = {
    readSnapshot: () => host.readSnapshot(),
    commit: (request) => host.commit(request),
    getCommitResult: (id) => host.getCommitResult(id),
    subscribeChanges: () => () => {},
    stageAsset: (id, asset) => host.stageAsset(id, asset),
    readAsset: (id) => host.readAsset(id),
    releaseAsset: (id) => host.releaseAsset(id),
  };
  const runtime = await WorkspaceRuntime.open(repository);
  await executeBasic(host, {
    version: 1,
    workspaceId: 'workspace',
    type: 'appendText',
    id: 'page',
    blockId: 'external',
    text: 'Outside',
  });
  runtime.patch('page', { title: 'Local title' });
  await runtime.flush();
  const page = (await host.readSnapshot()).entries[0].object;
  expect(page.title).toBe('Local title');
  expect(page.blocks?.[0].id).toBe('external');
  runtime.dispose();
});

for (const kind of ['memory', 'indexeddb']) {
  it(`${kind}: compact receipts, preserve concurrent fields, undo deletion and emit causal events`, async () => {
    const store =
      kind === 'memory' ? new MemoryRepository() : new LocalStore('audit', crypto.randomUUID());
    const runtime = await WorkspaceRuntime.open(store);
    try {
      const db = object('database', 'w', {
        id: 'db',
        fields: [{ id: 'a', name: 'A', type: 'text' }],
      });
      runtime.create([db]);
      await runtime.flush();
      const second = await WorkspaceRuntime.open(store);
      // Both sessions start from the same schema, before either pending edit is committed.
      runtime.fields('db', [{ id: 'a', name: 'renamed A', type: 'text' }]);
      second.fields('db', [...db.fields!, { id: 'b', name: 'B', type: 'text' }]);
      await Promise.all([runtime.flush(), second.flush()]);
      expect((await store.readSnapshot()).entries[0].object.fields).toEqual([
        { id: 'a', name: 'renamed A', type: 'text' },
        { id: 'b', name: 'B', type: 'text' },
      ]);
      second.dispose();
      runtime.patch('db', { deleted: true }, true);
      await runtime.flush();
      runtime.undo();
      await runtime.flush();
      expect((await store.readSnapshot()).entries[0].object.deleted).not.toBe(true);
      const events: any[] = [];
      const stop = store.subscribeChanges((event) => events.push(event));
      const snap = await store.readSnapshot();
      const request = {
        id: 'receipt',
        clientId: 'client',
        sequence: 1,
        origin: 'native',
        expectedVersion: snap.version,
        changes: [{ ...snap.entries[0].object, name: 'N' }],
        assetIds: [],
      };
      const result = await store.commit(request);
      expect(events[0]).toMatchObject({
        commitId: 'receipt',
        origin: 'native',
        changedIds: ['db'],
      });
      expect(result.status).toBe('committed');
      await store.acknowledgeCommits('client', 1);
      expect(await store.getCommitResult('receipt')).toBeUndefined();
      expect((await store.commit(request)).status).toBe('compacted');
      stop();
    } finally {
      await runtime.flush();
      runtime.dispose();
      if (store instanceof LocalStore) store.close();
    }
  });
}
