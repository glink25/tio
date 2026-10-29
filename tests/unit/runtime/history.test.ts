import { HostError, object, textBlock } from '@tio/core';
import { MemoryRepository } from '@tio/provider-memory';
import { WorkspaceRuntime } from '@tio/workspace';
import { afterEach, expect, it, vi } from 'vitest';

const sessions: WorkspaceRuntime[] = [];
afterEach(() => {
  sessions.splice(0).forEach((session) => session.dispose(true));
  vi.restoreAllMocks();
});
async function setup() {
  const repository = new MemoryRepository();
  const page = object('page', 'w', {
    id: 'p',
    title: 'Original',
    blocks: [textBlock('Body')],
    opaque: { preserved: true },
  });
  const database = object('database', 'w', {
    id: 'db',
    fields: [{ id: 'name', name: 'Name', type: 'text' }],
  });
  const record = object('record', 'w', {
    id: 'r',
    databaseId: 'db',
    properties: { name: 'First' },
    blocks: [],
  });
  await repository.commit({
    id: 'seed',
    expectedVersion: 0,
    changes: [page, database, record],
    assetIds: [],
  });
  const runtime = await WorkspaceRuntime.open(repository, undefined, undefined, {
    targetId: page.id,
  });
  sessions.push(runtime);
  await runtime.ensure(['db', 'r']);
  return { repository, runtime, page, database, record };
}
const title = (runtime: WorkspaceRuntime) => runtime.snapshot().find((o) => o.id === 'p')!.title;

it('orders title, rich text and cells together, including undo before persistence finishes', async () => {
  const { runtime, page, repository } = await setup();
  runtime.patch('p', { title: 'Renamed' });
  runtime.blocks('p', [textBlock('Changed')], page.blocks!);
  runtime.cell('r', 'name', 'Second');
  runtime.undo();
  runtime.undo();
  runtime.undo();
  expect(title(runtime)).toBe('Original');
  expect(runtime.state.getState()).toMatchObject({ canUndo: false, canRedo: true });
  runtime.redo();
  runtime.redo();
  runtime.redo();
  await runtime.flush();
  expect(title(runtime)).toBe('Renamed');
  const stored = (await repository.readObjects(['p', 'r'])).entries.map((e) => e.object);
  expect(stored.find((o) => o.id === 'p')).toMatchObject({
    title: 'Renamed',
    opaque: { preserved: true },
  });
  expect(stored.find((o) => o.id === 'r')?.properties?.name).toBe('Second');
  expect(runtime.state.getState()).toMatchObject({ canUndo: true, canRedo: false });
});

it('groups continuous input, breaks after 500ms or an explicit boundary and clears redo on a real edit', async () => {
  const { runtime } = await setup();
  const now = vi.spyOn(Date, 'now').mockReturnValue(1000);
  runtime.patch('p', { title: 'A' });
  now.mockReturnValue(1100);
  runtime.patch('p', { title: 'AB' });
  now.mockReturnValue(1700);
  runtime.patch('p', { title: 'ABC' });
  runtime.undo();
  expect(title(runtime)).toBe('AB');
  runtime.undo();
  expect(title(runtime)).toBe('Original');
  runtime.redo();
  expect(title(runtime)).toBe('AB');
  runtime.patch('p', { title: 'AB' }); // A no-op must not destroy redo.
  expect(runtime.state.getState().canRedo).toBe(true);
  runtime.breakHistoryGroup();
  runtime.patch('p', { title: 'New branch' });
  expect(runtime.state.getState().canRedo).toBe(false);
  runtime.undo();
  expect(title(runtime)).toBe('AB');
  await runtime.flush();
});

it('keeps external edits out of grouped history and out of redo', async () => {
  const { runtime, repository } = await setup();
  runtime.patch('p', { title: 'A' });
  await runtime.flush();
  const snapshot = await repository.readObjects(['p']);
  await repository.commit({
    id: 'external',
    expectedVersion: (await repository.readSnapshot()).version,
    changes: [{ ...snapshot.entries[0].object, icon: 'external', opaque: { remote: true } }],
    assetIds: [],
  });
  await runtime.poll();
  runtime.patch('p', { title: 'AB' });
  await runtime.flush();
  runtime.undo();
  await runtime.flush();
  expect(runtime.snapshot().find((o) => o.id === 'p')).toMatchObject({
    title: 'Original',
    icon: 'external',
    opaque: { remote: true },
  });
  runtime.redo();
  await runtime.flush();
  expect(runtime.snapshot().find((o) => o.id === 'p')).toMatchObject({
    title: 'AB',
    icon: 'external',
    opaque: { remote: true },
  });
});

it('places draft edits in the same chronology without persisting them and discards them on confirmation', async () => {
  const { runtime, repository } = await setup();
  const owner = Symbol();
  let draft = 'First';
  runtime.recordDraft(owner, draft, 'Draft', (value) => {
    draft = value;
  });
  draft = 'Draft';
  runtime.patch('p', { title: 'Later' });
  runtime.undo();
  expect(title(runtime)).toBe('Original');
  expect(draft).toBe('Draft');
  runtime.undo();
  expect(draft).toBe('First');
  runtime.redo();
  expect(draft).toBe('Draft');
  await runtime.flush();
  expect((await repository.readObjects(['r'])).entries[0].object.properties?.name).toBe('First');
  runtime.cell('r', 'name', draft);
  runtime.discardDraft(owner);
  runtime.undo();
  await runtime.flush();
  expect((await repository.readObjects(['r'])).entries[0].object.properties?.name).toBe('First');
  expect(runtime.state.getState().canUndo).toBe(false);
  runtime.redo();
  await runtime.flush();
  expect((await repository.readObjects(['r'])).entries[0].object.properties?.name).toBe('Draft');
});

it('retains history on denied undo and retries a failed undo with its original receipt', async () => {
  const { runtime, repository } = await setup();
  runtime.patch('p', { title: 'Saved' });
  await runtime.flush();
  runtime.setWritable(false);
  expect(() => runtime.undo()).toThrow();
  expect(runtime.state.getState().canUndo).toBe(true);
  runtime.setWritable(true);
  vi.spyOn(repository, 'commit').mockRejectedValueOnce(new Error('offline'));
  runtime.undo();
  await expect(runtime.flush()).rejects.toThrow('offline');
  expect(title(runtime)).toBe('Original');
  await runtime.retry();
  runtime.redo();
  await runtime.flush();
  expect(title(runtime)).toBe('Saved');
});

it('can redo creation and a batch deletion while preserving opaque content', async () => {
  const { runtime } = await setup();
  runtime.create([
    object('page', 'w', {
      id: 'new',
      title: 'Created',
      blocks: [],
      deleted: false,
      future: ['opaque'],
    }),
  ]);
  runtime.undo();
  runtime.redo();
  await runtime.flush();
  expect(runtime.snapshot().find((o) => o.id === 'new')).toMatchObject({
    deleted: false,
    future: ['opaque'],
  });
  const expected = runtime.snapshot().filter((o) => o.id === 'p' || o.id === 'new');
  await runtime.checked(
    expected,
    expected.map((o) => ({ ...o, deleted: true })),
    () => {},
  );
  runtime.undo();
  runtime.redo();
  await runtime.flush();
  expect(
    runtime
      .snapshot()
      .filter((o) => expected.some((e) => e.id === o.id))
      .every((o) => o.deleted),
  ).toBe(true);
});

it('groups a newly entered paragraph with the text typed into it', async () => {
  const { runtime, page } = await setup();
  const paragraph = textBlock('');
  const inserted = [...page.blocks!, paragraph];
  runtime.blocks('p', inserted, page.blocks!);
  runtime.blocks(
    'p',
    [...page.blocks!, { ...paragraph, content: [{ type: 'text', text: 'Typed', styles: {} }] }],
    inserted,
  );
  runtime.undo();
  expect(runtime.snapshot().find((o) => o.id === 'p')?.blocks).toEqual(page.blocks);
  await runtime.flush();
});

it('acknowledges no-op checked writes without adding history or hanging the receipt', async () => {
  const { runtime } = await setup();
  const expected = runtime.snapshot().filter((o) => o.id === 'p');
  await runtime.checked(expected, expected, () => {});
  expect(runtime.state.getState()).toMatchObject({ pending: 0, canUndo: false, canRedo: false });
});

it('removes cancelled draft history from both directions without erasing saved edits', async () => {
  const { runtime } = await setup();
  const owner = Symbol();
  runtime.patch('p', { title: 'Saved' });
  runtime.recordDraft(owner, 'before', 'after', () => {});
  runtime.undo();
  expect(runtime.state.getState().canRedo).toBe(true);
  runtime.discardDraft(owner);
  expect(runtime.state.getState()).toMatchObject({ canUndo: true, canRedo: false });
  runtime.undo();
  await runtime.flush();
  expect(title(runtime)).toBe('Original');
});

it('reloads evicted bodies before undo and preserves external fields', async () => {
  const { runtime, repository } = await setup();
  runtime.patch('p', { title: 'Local' });
  await runtime.flush();
  const others = Array.from({ length: 260 }, (_, i) =>
    object('page', 'w', { id: `other-${i}`, title: 'Other', blocks: [] }),
  );
  await repository.commit({
    id: 'others',
    expectedVersion: (await repository.readSnapshot()).version,
    changes: others,
    assetIds: [],
  });
  await runtime.poll();
  await runtime.ensure(others.map((o) => o.id));
  runtime.retain([])();
  expect(runtime.state.getState().loads.p).toBeUndefined();
  const current = (await repository.readObjects(['p'])).entries[0].object;
  await repository.commit({
    id: 'external',
    expectedVersion: (await repository.readSnapshot()).version,
    changes: [{ ...current, icon: 'external' }],
    assetIds: [],
  });
  await runtime.poll();
  runtime.undo();
  await runtime.flush();
  expect(runtime.snapshot().find((o) => o.id === 'p')).toMatchObject({
    title: 'Original',
    icon: 'external',
    opaque: { preserved: true },
  });
});

// Core risk: a second public entry must preserve the same undo/input boundary and opaque data.
it('shares external operations with live undo history and rejects stale versions and drafts', async () => {
  const { WorkspaceOperations } = await import('@tio/operations');
  const { runtime, repository } = await setup();
  const service = new WorkspaceOperations({ runtime, workspaceId: 'w' });
  const check = () => {};
  const read = await service.invoke('objects.get', { id: 'p' }, undefined, check);
  expect(read.status).toBe('completed');
  const version = (read as { value: { version: string } }).value.version;
  const input = { id: 'p', version, changes: { title: 'AI edit' } };
  const first = await service.invoke('pages.update', input, 'same-request', check);
  expect(first.status).toBe('completed');
  expect(await service.invoke('pages.update', input, 'same-request', check)).toEqual(first);
  expect(
    await service.invoke(
      'pages.update',
      { ...input, changes: { title: 'other' } },
      'same-request',
      check,
    ),
  ).toMatchObject({ status: 'failed', error: { code: 'invalid' } });
  expect((await repository.readObjects(['p'])).entries[0].object).toMatchObject({
    title: 'AI edit',
    opaque: { preserved: true },
  });
  runtime.undo();
  await runtime.flush();
  expect(title(runtime)).toBe('Original');
  runtime.redo();
  await runtime.flush();
  expect(title(runtime)).toBe('AI edit');
  expect(await service.invoke('pages.update', input, 'stale', check)).toMatchObject({
    status: 'failed',
    error: { code: 'conflict' },
  });
  const fresh = await service.invoke('objects.get', { id: 'p' }, undefined, check);
  const draft = Symbol('input');
  runtime.recordDraft(draft, 'before', 'unfinished', () => {});
  expect(
    await service.invoke(
      'pages.update',
      { ...input, version: (fresh as { value: { version: string } }).value.version },
      'draft',
      check,
    ),
  ).toMatchObject({ status: 'failed', error: { code: 'conflict' } });
  runtime.discardDraft(draft);
  service.dispose();
});

it('keeps uncertain external writes on the original request', async () => {
  const { WorkspaceOperations } = await import('@tio/operations');
  const { runtime, repository } = await setup();
  const service = new WorkspaceOperations({ runtime, workspaceId: 'w' });
  const check = () => {};
  const savedCommit = repository.commit.bind(repository);
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const commit = vi.spyOn(repository, 'commit').mockImplementation(async (request) => {
    await gate;
    return savedCommit(request);
  });
  vi.useFakeTimers();
  try {
    const pending = service.invoke(
      'pages.create',
      { title: 'One page', blocks: [] },
      'creation',
      check,
    );
    await vi.advanceTimersByTimeAsync(12001);
    expect(await pending).toEqual({ status: 'pending', requestId: 'creation' });
    expect(await service.result('creation', check)).toEqual({
      status: 'pending',
      requestId: 'creation',
    });
    release();
    await runtime.flush();
    expect(
      await service.invoke('pages.create', { title: 'One page', blocks: [] }, 'creation', check),
    ).toMatchObject({ status: 'completed' });
    expect(commit).toHaveBeenCalledTimes(1);
    expect(
      (await repository.readSnapshot()).entries.filter((e) => e.object.title === 'One page'),
    ).toHaveLength(1);
  } finally {
    vi.useRealTimers();
    service.dispose();
  }
});

// The existing editor tests do not exercise host authorization changing during an external async request.
it('rechecks external authorization before writing and isolates workspace identities', async () => {
  const { WorkspaceOperations } = await import('@tio/operations');
  const { runtime, repository } = await setup();
  const service = new WorkspaceOperations({ runtime, workspaceId: 'w' });
  let permitted = true;
  const check = () => {
    if (!permitted) throw new HostError('permission');
  };
  const read = await service.invoke('objects.get', { id: 'p' }, undefined, check);
  const original = repository.readChanges.bind(repository);
  vi.spyOn(repository, 'readChanges').mockImplementation(async (since) => {
    const result = await original(since);
    permitted = false;
    return result;
  });
  expect(
    await service.invoke(
      'pages.update',
      {
        id: 'p',
        version: (read as { value: { version: string } }).value.version,
        changes: { title: 'Forbidden' },
      },
      'revoked',
      check,
    ),
  ).toMatchObject({ status: 'failed', error: { code: 'permission' } });
  expect((await repository.readObjects(['p'])).entries[0].object.title).toBe('Original');
  const other = new WorkspaceOperations({ runtime, workspaceId: 'other' });
  expect(await other.invoke('objects.get', { id: 'p' }, undefined, () => {})).toMatchObject({
    status: 'failed',
  });
  other.dispose();
  service.dispose();
});

// Query-wide field validation needs a repository baseline, including the just-confirmed prior write.
it('checks schema query baselines without rejecting consecutive confirmed operations', async () => {
  const { WorkspaceOperations } = await import('@tio/operations');
  const { runtime, repository } = await setup();
  const service = new WorkspaceOperations({ runtime, workspaceId: 'w' });
  const check = () => {};
  const db = (await service.invoke('objects.get', { id: 'db' }, undefined, check)) as {
    value: { version: string };
  };
  const added = await service.invoke(
    'fields.create',
    { id: 'db', version: db.value.version, field: { id: 'extra', name: 'Extra', type: 'number' } },
    'add-field',
    check,
  );
  expect(added.status).toBe('completed');
  const version = (added as { value: { objects: { version: string }[] } }).value.objects[0].version;
  expect(
    await service.invoke(
      'fields.update',
      { id: 'db', version, fieldId: 'extra', changes: { name: 'Renamed' } },
      'rename-field',
      check,
    ),
  ).toMatchObject({ status: 'completed' });
  await runtime.flush();
  const snapshot = await repository.readSnapshot();
  await repository.commit({
    id: 'other-write',
    expectedVersion: snapshot.version,
    changes: [object('page', 'w', { title: 'Concurrent', blocks: [] })],
    assetIds: [],
  });
  await expect(
    runtime.externalWrite(
      [],
      [object('page', 'w', { title: 'Stale validation', blocks: [] })],
      check,
      snapshot.version,
    ),
  ).rejects.toMatchObject({ code: 'conflict' });
  expect(runtime.state.getState().error).toBeNull();
  service.dispose();
});
