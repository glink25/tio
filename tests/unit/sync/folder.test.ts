import { object, textBlock } from '@tio/core';
import { FileRepository, FileWorkspaceContent } from '@tio/file-storage';
import { IndexedRepositoryState } from '@tio/local-store';
import { MemoryProvider } from '@tio/provider-memory';
import { WorkspaceRuntime, executeBasic } from '@tio/workspace';
import { describe, expect, it, vi } from 'vitest';

function folder() {
  const files = new MemoryProvider();
  const content = new FileWorkspaceContent(files, 'w');
  const state = new IndexedRepositoryState(crypto.randomUUID());
  const journal = {
    read: state.read.bind(state),
    readMany: state.readMany.bind(state),
    entries: state.entries.bind(state),
    write: state.write.bind(state),
    load: async () => ({
      pending: await state.read<{ request: { id: string } }>('pending'),
      receipts: Object.fromEntries(
        (await state.entries('receipt/')).map((e) => [e.key.slice(8), e.value]),
      ),
    }),
  };
  return { files, content, journal, repository: new FileRepository(content, 'w', journal) };
}
const page = (id: string, title = id) =>
  object('page', 'w', { id, title, blocks: [textBlock(title)] });

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
  // Existing recovery cases do not cover stale derived data or a rebuild racing a confirmed edit.
  it('serves indexed queries without native scans, refreshes external edits explicitly and preserves writes during rebuilding', async () => {
    const f = folder();
    const db = object('database', 'w', {
      id: 'db',
      fields: [{ id: 'name', name: 'Name', type: 'title' }],
    });
    const record = object('record', 'w', {
      id: 'r',
      databaseId: 'db',
      properties: { name: 'Initial' },
      blocks: [textBlock('Keep body')],
      opaque: { keep: true },
    });
    await f.repository.commit({
      id: 'seed',
      expectedVersion: 0,
      changes: [db, record, page('p')],
      assetIds: [],
    });
    let releaseInitial!: () => void;
    const gate = new Promise<void>((resolve) => {
      releaseInitial = resolve;
    });
    vi.spyOn(f.content, 'list').mockImplementationOnce(async () => {
      await gate;
      return FileWorkspaceContent.prototype.list.call(f.content);
    });
    const initial = f.repository.refreshExternal();
    await expect(f.repository.scan({ limit: 100 })).rejects.toMatchObject({ code: 'pending' });
    releaseInitial();
    await initial;
    const list = vi.spyOn(f.content, 'list').mockClear();
    const read = vi.spyOn(f.content, 'read');
    const result = await f.repository.queryRecords({ databaseId: 'db', limit: 100 });
    expect(result.entries[0].projection.properties).toEqual({ name: 'Initial' });
    expect(result.entries[0].projection.blocks).toBeUndefined();
    expect(result.entries[0].projection.opaque).toBeUndefined();
    await f.repository.readChanges(result.version, ['p']);
    expect(list).not.toHaveBeenCalled();
    expect(read).not.toHaveBeenCalled();
    await f.content.write({ ...record, properties: { name: 'External' } });
    expect(
      (await f.repository.queryRecords({ databaseId: 'db', limit: 100 })).entries[0].projection
        .properties,
    ).toEqual({ name: 'Initial' });
    await f.repository.refreshExternal();
    expect(
      (await f.repository.queryRecords({ databaseId: 'db', limit: 100 })).entries[0].projection
        .properties,
    ).toEqual({ name: 'External' });
    const originalRead = FileWorkspaceContent.prototype.read.bind(f.content);
    let scanned!: () => void, continueScan!: () => void;
    const observed = new Promise<void>((resolve) => {
      scanned = resolve;
    });
    const release = new Promise<void>((resolve) => {
      continueScan = resolve;
    });
    let once = true;
    read.mockImplementation(async (id, options) => {
      const value = await originalRead(id, options);
      if (id === 'r' && once) {
        once = false;
        scanned();
        await release;
      }
      return value;
    });
    const rebuilding = f.repository.refreshExternal();
    await observed;
    const before = await f.repository.readObjects(['r']);
    await f.repository.commit({
      id: 'edit-during-build',
      expectedVersion: before.version,
      changes: [{ ...before.entries[0].object, properties: { name: 'Confirmed edit' } }],
      assetIds: [],
    });
    continueScan();
    await rebuilding;
    const reopened = new FileRepository(f.content, 'w', f.journal);
    expect(
      (await reopened.queryRecords({ databaseId: 'db', limit: 100 })).entries[0].projection
        .properties,
    ).toEqual({ name: 'Confirmed edit' });
    expect((await reopened.readObjects(['r'])).entries[0].object).toMatchObject({
      opaque: { keep: true },
      blocks: record.blocks,
    });
    f.repository.close();
    reopened.close();
  });
});

it('publishes a checked attachment and its reference together and recovers without duplicate bytes', async () => {
  const f = folder();
  const runtime = await WorkspaceRuntime.open(f.repository);
  runtime.create([page('attachment-owner')]);
  await runtime.flush();
  const before = runtime.snapshot().find((o) => o.id === 'attachment-owner')!;
  const asset = object('asset', 'w', {
    id: 'checked-file',
    filename: 'proof.bin',
    mime: 'application/octet-stream',
    byteSize: 4,
    assetPath: 'assets/checked-file.bin',
  });
  const after = {
    ...before,
    blocks: [
      ...(before.blocks ?? []),
      {
        id: 'file-block',
        type: 'file',
        props: { url: 'asset:checked-file', name: 'proof.bin' },
        content: [],
        children: [],
      },
    ],
  };
  await runtime.checked([before], [asset, after], () => {}, {
    assets: new Map([
      [
        'checked-file',
        {
          name: 'proof.bin',
          mime: 'application/octet-stream',
          bytes: new Uint8Array([0, 1, 128, 255]),
        },
      ],
    ]),
  });
  expect((await f.content.read('attachment-owner'))?.blocks?.at(-1)?.props.url).toBe(
    'asset:checked-file',
  );
  expect((await f.repository.readAsset('checked-file'))?.bytes).toEqual(
    new Uint8Array([0, 1, 128, 255]),
  );
  runtime.undo();
  await runtime.flush();
  expect((await f.content.read('attachment-owner'))?.blocks).toEqual(before.blocks);
  runtime.redo();
  await runtime.flush();
  expect((await f.repository.readAsset('checked-file'))?.bytes).toEqual(
    new Uint8Array([0, 1, 128, 255]),
  );
  runtime.dispose();
  f.repository.close();
});
