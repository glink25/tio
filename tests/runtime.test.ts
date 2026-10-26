import { object, textBlock, type WorkspaceRepository } from '@tio/core';
import { LocalStore } from '@tio/local-store';
import { WorkspaceRuntime } from '@tio/workspace';
import { afterEach, describe, expect, it, vi } from 'vitest';

const cleanup: (() => void)[] = [];
afterEach(() => {
  cleanup.splice(0).forEach((fn) => fn());
});
async function setup() {
  const store = new LocalStore('runtime', `runtime-${crypto.randomUUID()}`);
  const page = object('page', 'workspace', {
    blocks: [textBlock('Original')],
    title: 'Original',
    future: { retained: true },
  });
  await store.batch([page]);
  const runtime = await WorkspaceRuntime.open(store);
  cleanup.push(() => {
    runtime.dispose();
    store.close();
  });
  return { store, page, runtime };
}
describe('workspace command persistence', () => {
  it('publishes every keystroke immediately and retains the final title after reopening', async () => {
    const { store, page, runtime } = await setup();
    for (let i = 1; i <= 30; i++) {
      runtime.patch(page.id, { title: `Title ${i}` });
      expect(runtime.snapshot()[0].title).toBe(`Title ${i}`);
    }
    await runtime.flush();
    expect(runtime.state.getState().status).toBe('saved');
    const reopened = await WorkspaceRuntime.open(store);
    cleanup.push(() => reopened.dispose());
    expect(reopened.snapshot()[0]).toMatchObject({ title: 'Title 30', future: { retained: true } });
  });
  it('keeps a failed draft visible and retries all pending commands', async () => {
    const { store, page, runtime } = await setup();
    vi.spyOn(store, 'commit').mockRejectedValueOnce(new Error('Disk full'));
    runtime.patch(page.id, { title: 'Unsaved' });
    await expect(runtime.flush()).rejects.toThrow('Disk full');
    runtime.patch(page.id, { title: 'Latest draft' });
    expect(runtime.snapshot()[0].title).toBe('Latest draft');
    expect((await store.get(page.id))?.object.title).toBe('Original');
    await runtime.retry();
    expect((await store.get(page.id))?.object.title).toBe('Latest draft');
    expect(runtime.state.getState().pending).toBe(0);
  });
  it('replays queued edits against external fields without erasing them', async () => {
    const { store, page } = await setup();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const repository: WorkspaceRepository = {
      readSnapshot: () => store.readSnapshot(),
      subscribeChanges: (listener) => store.subscribeChanges(listener),
      getCommitResult: (id) => store.getCommitResult(id),
      readAsset: (id) => store.readAsset(id),
      stageAsset: (id, asset) => store.stageAsset(id, asset),
      releaseAsset: (id) => store.releaseAsset(id),
      commit: async (request) => {
        await gate;
        return store.commit(request);
      },
    };
    const runtime = await WorkspaceRuntime.open(repository);
    cleanup.push(() => runtime.dispose());
    runtime.patch(page.id, { title: 'Local rename' });
    await store.change(page.id, (current) => ({
      ...current!,
      icon: 'X',
      future: { external: true },
    }));
    release();
    await runtime.flush();
    expect(runtime.snapshot()[0]).toMatchObject({
      title: 'Local rename',
      icon: 'X',
      future: { external: true },
    });
  });
  it('rejects invalid field commands synchronously without changing state or pending writes', async () => {
    const { runtime } = await setup();
    const db = object('database', 'workspace', {
      id: 'numbers',
      fields: [{ id: 'n', name: 'Number', type: 'number' }],
    });
    const record = object('record', 'workspace', {
      id: 'row',
      databaseId: db.id,
      properties: { n: 12 },
      blocks: [],
    });
    runtime.create([db, record]);
    await runtime.flush();
    const before = runtime.state.getState();
    expect(() => runtime.cell(record.id, 'n', Infinity)).toThrow();
    expect(runtime.state.getState()).toBe(before);
    expect(runtime.state.getState().pending).toBe(0);
    runtime.cell(record.id, 'n', -2.5);
    expect(runtime.snapshot().find((o) => o.id === record.id)?.properties?.n).toBe(-2.5);
    await runtime.flush();
  });
  it('rejects cyclic moves and preserves reference IDs across rename and move', async () => {
    const { store, page, runtime } = await setup();
    const child = object('page', 'workspace', { parentId: page.id, blocks: [], title: 'Child' });
    runtime.create([child]);
    runtime.append(page.id, {
      id: 'reference',
      type: 'pageReference',
      props: { pageId: child.id },
      content: [],
      children: [],
    });
    expect(() => runtime.move(page.id, child.id)).toThrow('不能移动');
    runtime.patch(child.id, { title: 'Renamed' });
    runtime.move(child.id, null);
    await runtime.flush();
    expect((await store.get(page.id))?.object.blocks?.at(-1)?.props.pageId).toBe(child.id);
    expect((await store.get(child.id))?.object).toMatchObject({ title: 'Renamed', parentId: null });
  });
  it('preserves newer formats and unknown block payloads during ordinary edits', async () => {
    const { store, page, runtime } = await setup();
    const future = object('page', 'workspace', {
      schemaVersion: 8,
      title: 'Future',
      payload: { version: 8 },
    });
    expect(() => runtime.create([future])).toThrow('Unsupported schema');
    const opaque = {
      id: 'opaque',
      type: 'futureBlock',
      props: { formula: 'future' },
      content: { arbitrary: [1, 2] },
      children: [],
    };
    runtime.append(page.id, opaque);
    runtime.patch(page.id, { title: 'Current format rename' });
    await runtime.flush();
    expect(await store.get(future.id)).toBeUndefined();
    expect((await store.get(page.id))?.object.blocks?.at(-1)).toEqual(opaque);
  });
});
it('closing rejects new edits, coalesces callers and permits retry after flush failure', async () => {
  const host = new LocalStore('closing', crypto.randomUUID());
  const runtime = await WorkspaceRuntime.open(host);
  runtime.create([object('page', 'w', { id: 'p', blocks: [] })]);
  await runtime.flush();
  const commit = vi.spyOn(host, 'commit').mockRejectedValueOnce(new Error('disk full'));
  runtime.patch('p', { title: 'Keep draft' });
  const closing = runtime.close();
  expect(runtime.close()).toBe(closing);
  expect(() => runtime.patch('p', { title: 'Late' })).toThrow('closed');
  await expect(closing).rejects.toThrow('disk full');
  expect(runtime.snapshot()[0].title).toBe('Keep draft');
  commit.mockRestore();
  await runtime.retry();
  await runtime.close();
  expect(runtime.state.getState().lifecycle).toBe('closed');
  expect((await host.get('p'))?.object.title).toBe('Keep draft');
  host.close();
});

it('automatically resolves concurrent body edits, durably records recovery, and drains later edits', async () => {
  const { MemoryRepository } = await import('@tio/provider-memory');
  const host = new MemoryRepository();
  const page = object('page', 'w', { id: 'p', blocks: [textBlock('original')] });
  await host.commit({ id: 'seed', expectedVersion: 0, changes: [page], assetIds: [] });
  const runtime = await WorkspaceRuntime.open(host);
  let release!: () => void, started!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const entered = new Promise<void>((resolve) => {
    started = resolve;
  });
  const commit = host.commit.bind(host);
  vi.spyOn(host, 'commit').mockImplementationOnce(async (request) => {
    started();
    await gate;
    return commit(request);
  });
  const block = page.blocks![0];
  runtime.blocks(
    'p',
    [{ ...block, content: [{ type: 'text', text: 'local', styles: {} }] }],
    page.blocks!,
  );
  await entered;
  await commit({
    id: 'other',
    expectedVersion: 1,
    changes: [
      { ...page, blocks: [{ ...block, content: [{ type: 'text', text: 'remote', styles: {} }] }] },
    ],
    assetIds: [],
  });
  runtime.patch('p', { title: 'After conflict' });
  release();
  await runtime.flush();
  expect(runtime.state.getState().status).toBe('saved');
  expect(host.recovery.length).toBeGreaterThan(0);
  expect((await host.readSnapshot()).entries[0].object.title).toBe('After conflict');
  await runtime.close();
});
