import { GitHubAdapter } from '@tio/adapter-github';
import { object } from '@tio/core';
import { LocalCatalog, LocalStore, RecoveryJournal, deleteLocalWorkspace } from '@tio/local-store';
import { GitHubClient } from '@tio/provider-github';
import { MemoryRepository } from '@tio/provider-memory';
import { WorkspaceRuntime } from '@tio/workspace';
import { afterEach, expect, it, vi } from 'vitest';

import { WorkspaceLifecycle } from '../../../apps/web/src/services/workspace-lifecycle';
import { LocalFolderProvider } from '../../../packages/provider-local-folder/src/index';

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
afterEach(() => vi.unstubAllGlobals());

it('permanently removes only one instance and rejects stale commits and catalog saves', async () => {
  const id = crypto.randomUUID(),
    otherId = crypto.randomUUID();
  const catalog = new LocalCatalog(),
    store = new LocalStore(id),
    other = new LocalStore(otherId);
  const lifecycle = new WorkspaceLifecycle(catalog, async () => {});
  const session = {
    id,
    workspaceId: 'w',
    connectionId: 'device',
    name: 'Delete me',
    favorites: ['p'],
  };
  try {
    await catalog.saveSession(session);
    await catalog.saveSession({ ...session, id: otherId });
    await catalog.write('active', id);
    await store.batch([object('page', 'w', { id: 'p', title: 'Target', blocks: [] })]);
    await other.batch([object('page', 'w', { id: 'p', title: 'Keep', blocks: [] })]);
    const asset = { name: 'a', mime: 'text/plain', bytes: new Uint8Array([1]) };
    await store.stageAsset('a', asset);
    await store.cacheAsset('a', asset);
    await store.recover(['recovery']);
    await lifecycle.mark(id, 'deleting');
    await deleteLocalWorkspace(id);
    await catalog.removeSession(id);
    await lifecycle.mark(id, 'deleted');
    expect(await store.entries()).toEqual([]);
    expect(await store.blob('a')).toBeUndefined();
    expect(
      (await (await store.db).getAllKeys('settings')).filter(
        (key) => typeof key === 'string' && key.startsWith(id + '/'),
      ),
    ).toEqual([]);
    expect(await (await store.db).getAllFromIndex('recovery', 'instance', id)).toEqual([]);
    expect(await catalog.read('preferences/' + id)).toBeUndefined();
    expect(await catalog.read('active')).toBeUndefined();
    expect((await catalog.list()).some((s) => s.id === id)).toBe(false);
    expect((await other.get('p'))?.object.title).toBe('Keep');
    await expect(catalog.saveSession(session)).rejects.toMatchObject({ code: 'closed' });
    await expect(
      store.commit({
        id: 'stale',
        expectedVersion: 0,
        changes: [object('page', 'w', { id: 'p', blocks: [] })],
        assetIds: [],
      }),
    ).rejects.toMatchObject({ code: 'closed' });
  } finally {
    lifecycle.close();
    store.close();
    other.close();
    await catalog.close();
  }
});

it('waits for in-flight work and blocks queued calls after deletion starts', async () => {
  const catalog = new LocalCatalog();
  const lifecycle = new WorkspaceLifecycle(catalog, async () => {});
  const gate = deferred(),
    started = deferred();
  const id = crypto.randomUUID();
  const mutate = vi.fn(async () => {
    started.resolve();
    await gate.promise;
  });
  const repository = lifecycle.guard(id, { mutate });
  try {
    const write = repository.mutate();
    await started.promise;
    let marked = false;
    const remove = lifecycle.lock(id, async () => {
      await lifecycle.mark(id, 'deleting');
      marked = true;
    });
    expect(marked).toBe(false);
    gate.resolve();
    await write;
    await remove;
    await expect(repository.mutate()).rejects.toMatchObject({ code: 'closed' });
    expect(mutate).toHaveBeenCalledTimes(1);
  } finally {
    lifecycle.close();
    await catalog.close();
  }
});

it('notifies another window to stop its old session', async () => {
  const catalog = new LocalCatalog(),
    remoteCatalog = new LocalCatalog();
  const stopped = vi.fn(async () => {});
  const first = new WorkspaceLifecycle(catalog, async () => {});
  const second = new WorkspaceLifecycle(remoteCatalog, stopped);
  const id = crypto.randomUUID();
  try {
    await first.mark(id, 'deleting');
    await vi.waitFor(() => expect(stopped).toHaveBeenCalledWith(id));
    await expect(second.guard(id, { write: async () => {} }).write()).rejects.toMatchObject({
      code: 'closed',
    });
  } finally {
    first.close();
    second.close();
    await catalog.close();
    await remoteCatalog.close();
  }
});

it('discard closes pending input while awaiting an already-started commit', async () => {
  const repository = new MemoryRepository();
  const runtime = await WorkspaceRuntime.open(repository);
  runtime.create([
    object('workspace', 'w', { id: 'w', name: 'Test' }),
    object('page', 'w', { id: 'p', blocks: [] }),
  ]);
  await runtime.flush();
  const commit = repository.commit.bind(repository),
    gate = deferred(),
    started = deferred();
  const spy = vi.spyOn(repository, 'commit').mockImplementation(async (request) => {
    started.resolve();
    await gate.promise;
    return commit(request);
  });
  runtime.patch('p', { title: 'In flight' });
  await started.promise;
  runtime.patch('p', { title: 'Discarded' });
  let closed = false;
  const closing = runtime.discardAndClose().then(() => {
    closed = true;
  });
  expect(closed).toBe(false);
  gate.resolve();
  await closing;
  expect(spy).toHaveBeenCalledTimes(1);
  expect((await repository.readObjects(['p'])).entries[0].object.title).toBe('In flight');
  expect(() => runtime.patch('p', { title: 'Old session' })).toThrow();
});

it('folder deletion is recursive and limited to a validated workspace directory', async () => {
  const removeEntry = vi.fn(async () => {}),
    getDirectoryHandle = vi.fn(async () => ({ removeEntry }));
  const provider = new LocalFolderProvider({
    getDirectoryHandle,
  } as unknown as FileSystemDirectoryHandle);
  await provider.deleteWorkspace('space_1');
  expect(getDirectoryHandle).toHaveBeenCalledWith('workspaces');
  expect(removeEntry).toHaveBeenCalledWith('space_1', { recursive: true });
  for (const id of ['', '..', '../other', 'a/b', 'a\\b'])
    await expect(provider.deleteWorkspace(id)).rejects.toMatchObject({ code: 'invalid' });
  expect(removeEntry).toHaveBeenCalledTimes(1);
  removeEntry.mockRejectedValueOnce(new DOMException('missing', 'NotFoundError'));
  await provider.deleteWorkspace('space_1');
  removeEntry.mockRejectedValueOnce(new DOMException('denied', 'NotAllowedError'));
  await expect(provider.deleteWorkspace('space_1')).rejects.toMatchObject({ code: 'permission' });
  await provider.deleteWorkspace('space_1');
});

it('removes only the target folder recovery journal', async () => {
  const target = new RecoveryJournal(crypto.randomUUID()),
    other = new RecoveryJournal(crypto.randomUUID());
  try {
    await target.save({ pending: true });
    await other.save({ keep: true });
    await target.delete();
    await target.delete();
    expect(await target.load()).toBeUndefined();
    expect(await other.load()).toEqual({ keep: true });
  } finally {
    target.close();
    other.close();
  }
});

it('GitHub management supplies repository web links without invoking mutation APIs', () => {
  const transport = vi.fn();
  const adapter = new GitHubAdapter(
    'github-1',
    1,
    new GitHubClient(async () => 't', transport),
    'pat',
    new Map([
      ['w', { repositoryId: 1, fullName: 'owner/tio-w', branch: 'main', workspaceId: 'w' }],
    ]),
  );
  expect(adapter.workspaceLinks('w')).toEqual({
    repository: 'owner/tio-w',
    delete: 'https://github.com/owner/tio-w/settings',
    share: 'https://github.com/owner/tio-w/settings/access',
  });
  expect(transport).not.toHaveBeenCalled();
});

it('host deletion discards the active session, preserves retry after failure, and removes its catalog entry only on success', async () => {
  const values = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
  });
  const { WorkspaceServices } = await import('../../../apps/web/src/services/workspace-services');
  const repository = Object.assign(new MemoryRepository(), { close: vi.fn() });
  const execute = vi
    .fn()
    .mockRejectedValueOnce(new Error('Deletion interrupted'))
    .mockResolvedValue(undefined);
  const services = new WorkspaceServices(() => ({
    identity: { provider: 'test', name: 'Test', icon: '', details: [] },
    adapter: {
      supportsSync: false,
      getAccessState: async () => ({ code: 'available', scope: { connectionId: 'device' } }),
      subscribe: () => () => {},
      classifyError: () => ({ code: 'unreachable', scope: { connectionId: 'device' } }),
    },
    repository: () => repository,
    discover: async () => [],
    content: () => undefined,
    workspaceActions: () => ({
      delete: {
        kind: 'direct',
        title: 'Delete',
        description: 'Permanent',
        confirmLabel: 'Delete',
        execute,
      },
    }),
  }));
  const closed = vi.fn();
  services.onWorkspaceClosed = closed;
  try {
    await services.connect('device');
    const workspaceId = crypto.randomUUID();
    const session = await services.create([
      object('workspace', workspaceId, { id: workspaceId, name: 'Target' }),
      object('page', workspaceId, { id: 'p', blocks: [] }),
    ]);
    await services.open(session);
    await expect(services.deleteWorkspace(session)).rejects.toThrow('Deletion interrupted');
    expect(closed).toHaveBeenCalledWith(session.id);
    expect((await services.sessions()).some((s) => s.id === session.id)).toBe(true);
    await expect(services.open(session)).rejects.toMatchObject({ code: 'closed' });
    await services.deleteWorkspace(session);
    expect(execute).toHaveBeenCalledTimes(2);
    expect((await services.sessions()).some((s) => s.id === session.id)).toBe(false);
  } finally {
    await services.dispose();
  }
});

it('connection integrations declare only supported actions and GitHub supplies external instructions', async () => {
  const values = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
  });
  const { createConnectionBinding } =
    await import('../../../apps/web/src/services/connection-adapters');
  const device = createConnectionBinding({ id: 'device', kind: 'device', name: 'Device' });
  expect(device.workspaceActions?.('w').delete?.kind).toBe('direct');
  expect(device.workspaceActions?.('w').share).toBeUndefined();
  values.set(
    'tio.github.endpoints.github-1',
    JSON.stringify([
      ['w', { repositoryId: 1, fullName: 'owner/tio-w', branch: 'main', workspaceId: 'w' }],
    ]),
  );
  const github = createConnectionBinding({ id: 'github-1', kind: 'github', name: 'owner' });
  try {
    const actions = github.workspaceActions!('w');
    expect(actions.delete).toMatchObject({
      kind: 'external',
      url: 'https://github.com/owner/tio-w/settings',
    });
    expect(actions.share).toMatchObject({
      kind: 'external',
      url: 'https://github.com/owner/tio-w/settings/access',
    });
    expect(actions.delete?.description).toContain('owner/tio-w');
    expect(actions.share?.description).toContain('owner/tio-w');
    expect(actions.delete).not.toHaveProperty('execute');
    expect(actions.share).not.toHaveProperty('execute');
  } finally {
    github.dispose?.();
  }
});

it('allows decorating a guarded method and still observes provider method replacements', async () => {
  const catalog = new LocalCatalog();
  const lifecycle = new WorkspaceLifecycle(catalog, async () => {});
  const provider: { commit: () => Promise<string> } = { commit: vi.fn(async () => 'saved') };
  const repository = lifecycle.guard(crypto.randomUUID(), provider);
  const original = repository.commit.bind(repository);
  repository.commit = async () => original();
  try {
    expect(await repository.commit()).toBe('saved');
    provider.commit = vi.fn(async () => 'replacement');
    expect(await repository.commit()).toBe('replacement');
    expect(provider.commit).toHaveBeenCalledTimes(1);
  } finally {
    lifecycle.close();
    await catalog.close();
  }
});
