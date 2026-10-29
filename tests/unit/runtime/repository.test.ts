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
    attachmentPolicy: host.attachmentPolicy,
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

it('enforces provider attachment limits before runtime edits and across the host bridge', async () => {
  const { GitHubClient, GitHubProvider } = await import('@tio/provider-github');
  const provider = new GitHubProvider(new GitHubClient(async () => 'unused'), {
    repositoryId: 1,
    fullName: 'owner/repo',
    branch: 'main',
    workspaceId: 'w',
  });
  class Replica extends LocalStore {
    override readonly attachmentPolicy = provider.attachmentPolicy;
  }
  const repository = new Replica('attachment-limits', crypto.randomUUID());
  const pair = createLoopback();
  const context = { sessionId: 'limits', workspaceId: 'w' };
  const stop = serveHost(pair.host, context, repository);
  const bridge = new BridgeRepository(pair.client, context);
  let runtime: WorkspaceRuntime | undefined;
  try {
    await bridge.connect();
    expect(bridge.attachmentPolicy).toEqual({
      maxFileBytes: 10 * 1024 * 1024,
      maxImageBytes: 10 * 1024 * 1024,
    });
    runtime = await WorkspaceRuntime.open(bridge);
    const maxBytes = provider.attachmentPolicy.maxFileBytes;
    const oversize = {
      name: 'large.bin',
      mime: 'application/octet-stream',
      bytes: new Uint8Array(maxBytes + 1),
    };
    const expected = { code: 'asset-size', details: { maxBytes } };
    expect(() => runtime!.upload('w', oversize)).toThrow(expect.objectContaining(expected));
    expect(() => runtime!.create([], undefined, new Map([['large', oversize]]))).toThrow(
      expect.objectContaining(expected),
    );
    expect(() => runtime!.import([], new Map([['large', oversize]]))).toThrow(
      expect.objectContaining(expected),
    );
    await expect(repository.stageAsset('large', oversize)).rejects.toMatchObject(expected);
    await expect(bridge.stageAsset('large', oversize)).rejects.toMatchObject(expected);
    expect(runtime.snapshot()).toEqual([]);
    expect(runtime.attachmentPolicy).toEqual(provider.attachmentPolicy);
    const exact = { ...oversize, bytes: new Uint8Array(maxBytes) };
    await bridge.stageAsset('exact', exact);
    await bridge.releaseAsset('exact');
    runtime.upload('w', exact);
    await runtime.flush();
    expect((await repository.readSnapshot()).entries).toHaveLength(1);
    const local = new MemoryRepository();
    expect(local.attachmentPolicy).toEqual({
      maxFileBytes: 20 * 1024 * 1024,
      maxImageBytes: 10 * 1024 * 1024,
    });
    await local.stageAsset('local-exact', {
      ...exact,
      bytes: new Uint8Array(local.attachmentPolicy.maxFileBytes),
    });
    await expect(
      local.stageAsset('local-large', {
        ...exact,
        bytes: new Uint8Array(local.attachmentPolicy.maxFileBytes + 1),
      }),
    ).rejects.toMatchObject({
      code: 'asset-size',
      details: { maxBytes: local.attachmentPolicy.maxFileBytes },
    });
  } finally {
    runtime?.dispose();
    bridge.dispose();
    stop();
    repository.close();
  }
});

// Relationship queries introduce a new provider read boundary: existing object-read tests do
// not cover derived counts, occurrence excerpts or graph edges leaking denied content.
it('relationship queries preserve workspace and access boundaries across the bridge', async () => {
  const { textBlock } = await import('@tio/core');
  const denied = new Set(['secret']);
  const policy = {
    version: '1',
    allows: (resource: { id: string }, operation: string) =>
      operation !== 'read' || !denied.has(resource.id),
  };
  const repository = new MemoryRepository(policy);
  const mention = {
    type: 'mention',
    props: { workspaceId: 'w', kind: 'page', id: 'b', anchor: { type: 'block', blockId: 'body' } },
  };
  const a = object('page', 'w', {
    id: 'a',
    title: 'A',
    blocks: [
      {
        ...textBlock(''),
        id: 'source',
        content: [
          mention,
          mention,
          { type: 'mention', props: { workspaceId: 'other', kind: 'page', id: 'b' } },
        ],
      },
    ],
  });
  const b = object('page', 'w', {
    id: 'b',
    title: 'B',
    blocks: [{ ...textBlock('target'), id: 'body' }],
  });
  const secret = object('page', 'w', { id: 'secret', title: 'Do not expose', blocks: a.blocks });
  await repository.commit({
    id: 'seed',
    expectedVersion: 0,
    changes: [a, b, secret],
    assetIds: [],
  });
  const transport = createLoopback();
  const context = { sessionId: 'relationships', workspaceId: 'w' };
  const stop = serveHost(transport.host, context, repository);
  const bridge = new BridgeRepository(transport.client, context);
  await bridge.connect();
  try {
    const incoming = await bridge.relations!.queryReferences({
      id: 'b',
      direction: 'in',
      limit: 50,
    });
    expect(incoming.total).toBe(1);
    expect(incoming.items).toMatchObject([{ node: { target: { id: 'a' } }, count: 2 }]);
    const occurrences = await bridge.relations!.queryReferenceOccurrences({
      sourceId: 'a',
      targetId: 'b',
      limit: 20,
    });
    expect(occurrences.items).toHaveLength(2);
    expect(occurrences.items[0].source.anchor).toEqual({ type: 'block', blockId: 'source' });
    const graph = await bridge.relations!.queryGraph({ limit: 1000 });
    expect(graph.items.filter((i) => i.type === 'edge')).toEqual([
      { type: 'edge', edge: { source: 'a', target: 'b', count: 2 } },
    ]);
    expect(JSON.stringify(graph)).not.toContain('secret');
    const paged = await bridge.relations!.queryGraph({ limit: 1 });
    denied.add('a');
    repository.relations.invalidate('access');
    await expect(
      bridge.relations!.queryGraph({ limit: 1, after: paged.next }),
    ).rejects.toMatchObject({ code: 'conflict' });
    expect(
      (await bridge.relations!.queryReferences({ id: 'b', direction: 'in', limit: 50 })).total,
    ).toBe(0);
    await expect(
      bridge.relations!.queryReferenceOccurrences({ sourceId: 'a', targetId: 'b', limit: 20 }),
    ).rejects.toMatchObject({ code: 'permission' });
  } finally {
    bridge.dispose();
    stop();
    repository.relations.close();
  }
});
