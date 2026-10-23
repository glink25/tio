import { FolderConnectionAdapter } from '@tio/adapter-local-folder';
import { object, type ConnectionAccessState, type ConnectionAdapter } from '@tio/core';
import { MemoryProvider } from '@tio/provider-memory';
import { FileWorkspaceContent } from '@tio/sync';
import { beforeEach, afterEach, expect, it, vi } from 'vitest';

import { WorkspaceServices } from '../apps/web/src/services/workspace-services';
const services: WorkspaceServices[] = [];
beforeEach(() => {
  vi.stubGlobal('document', {
    visibilityState: 'visible',
    addEventListener() {},
    removeEventListener() {},
  });
  vi.stubGlobal('navigator', {});
});
afterEach(async () => {
  for (const service of services.splice(0)) await service.dispose();
  vi.unstubAllGlobals();
});
function fixture() {
  const files = new MemoryProvider();
  let code: ConnectionAccessState['code'] = 'reauthorization-required';
  let listener: ((state: ConnectionAccessState) => void) | undefined;
  const state = () => ({ code, scope: { connectionId: 'device' } });
  const adapter: ConnectionAdapter = {
    supportsSync: true,
    getAccessState: vi.fn(async () => state()),
    reauthorize: vi.fn(async () => {
      code = 'available';
      return 'success' as const;
    }),
    subscribe: (fn) => {
      listener = fn;
      return () => {
        listener = undefined;
      };
    },
    classifyError: () => state(),
  };
  const discover = vi.fn(async () => []);
  const service = new WorkspaceServices(() => ({
    adapter,
    discover,
    content: (id) => new FileWorkspaceContent(files, id),
  }));
  services.push(service);
  return {
    service,
    adapter,
    discover,
    files,
    set: (codeValue: typeof code) => {
      code = codeValue;
      listener?.(state());
    },
  };
}
it('restores local sessions without endpoint access and resumes all spaces through a non-folder adapter', async () => {
  const { service, adapter, discover, files } = fixture();
  await service.connect('device');
  const space = crypto.randomUUID();
  const a = await service.create([
    object('workspace', space, { id: space }),
    object('page', space, { id: 'p', title: 'A', blocks: [] }),
  ]);
  const bId = crypto.randomUUID();
  const b = await service.create([
    object('workspace', bId, { id: bId }),
    object('page', bId, { id: 'p', title: 'B', blocks: [] }),
  ]);
  await service.sessions();
  expect(adapter.getAccessState).not.toHaveBeenCalled();
  const runtimeA = await service.open(a);
  runtimeA.patch('p', { title: 'Offline A' });
  const runtimeB = await service.open(b);
  runtimeB.patch('p', { title: 'Offline B' });
  await service.refreshRemote();
  expect(discover).not.toHaveBeenCalled();
  expect(adapter.reauthorize).not.toHaveBeenCalled();
  expect(service.access?.code).toBe('reauthorization-required');
  const first = service.authorize();
  expect(adapter.reauthorize).toHaveBeenCalledTimes(1);
  expect(service.authorize()).toBe(first);
  await first;
  expect(service.access?.code).toBe('available');
  for (const [id, title] of [
    [space, 'Offline A'],
    [bId, 'Offline B'],
  ]) {
    const bytes = await files.read(`workspaces/${id}/pages/p.json`);
    expect(JSON.parse(new TextDecoder().decode(bytes!)).title).toBe(title);
  }
  expect(runtimeB.snapshot().find((o) => o.id === 'p')?.title).toBe('Offline B');
});
it('ignores late authorization after disconnect', async () => {
  const { service, adapter, discover } = fixture();
  await service.connect('device');
  let finish!: (result: 'success') => void;
  adapter.reauthorize = vi.fn(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const work = service.authorize();
  await service.disconnect();
  finish('success');
  await work;
  expect(service.connection).toBeNull();
  expect(service.access).toBeUndefined();
  expect(discover).not.toHaveBeenCalled();
});
it('folder reauthorization calls the gesture API immediately, keeps cancellation recoverable', async () => {
  const requestPermission = vi.fn(async () => 'denied');
  const adapter = new FolderConnectionAdapter('folder', {
    queryPermission: async () => 'prompt',
    requestPermission,
  } as unknown as FileSystemDirectoryHandle);
  expect((await adapter.getAccessState()).code).toBe('reauthorization-required');
  expect(requestPermission).not.toHaveBeenCalled();
  const work = adapter.reauthorize();
  expect(requestPermission).toHaveBeenCalledTimes(1);
  expect(await work).toBe('cancelled');
  requestPermission.mockResolvedValue('granted');
  expect(await adapter.reauthorize()).toBe('success');
});
it('discovery failures and transient access-check failures preserve the active local session', async () => {
  const { service, adapter, discover, set } = fixture();
  await service.connect('device');
  const id = crypto.randomUUID();
  const session = await service.create([
    object('workspace', id, { id }),
    object('page', id, { id: 'p', title: 'Local', blocks: [] }),
  ]);
  const runtime = await service.open(session);
  set('available');
  discover.mockRejectedValueOnce(new Error('network'));
  adapter.classifyError = () => ({ code: 'unreachable', scope: { connectionId: 'device' } });
  await service.refreshRemote();
  expect(service.access?.code).toBe('unreachable');
  runtime.patch('p', { title: 'Still editable' });
  await runtime.flush();
  vi.mocked(adapter.getAccessState).mockRejectedValueOnce(new Error('network'));
  await service.refreshRemote();
  expect(runtime.snapshot().find((o) => o.id === 'p')?.title).toBe('Still editable');
  expect(adapter.reauthorize).not.toHaveBeenCalled();
});
it('a local flush failure remains distinct from connection authorization', async () => {
  const { service, adapter, set } = fixture();
  await service.connect('device');
  const id = crypto.randomUUID();
  const session = await service.create([object('workspace', id, { id })]);
  const runtime = await service.open(session);
  set('available');
  const flush = vi.spyOn(runtime, 'flush').mockRejectedValueOnce(new Error('local disk full'));
  await expect(service.sync()).rejects.toThrow('local disk full');
  expect(adapter.reauthorize).not.toHaveBeenCalled();
  expect(service.access?.code).toBe('available');
  flush.mockRestore();
});

it('keeps the current workspace usable when switching cannot flush pending changes', async () => {
  const { service } = fixture();
  await service.connect('device');
  const aId = crypto.randomUUID(),
    bId = crypto.randomUUID();
  const a = await service.create([
    object('workspace', aId, { id: aId }),
    object('page', aId, { id: 'a-page', title: 'A', blocks: [] }),
  ]);
  const b = await service.create([
    object('workspace', bId, { id: bId }),
    object('page', bId, { id: 'b-page', title: 'B', blocks: [] }),
  ]);
  const runtime = await service.open(a);
  const failure = vi.spyOn(runtime, 'flush').mockRejectedValueOnce(new Error('disk full'));
  await expect(service.open(b)).rejects.toThrow('disk full');
  expect(runtime.state.getState().lifecycle).not.toBe('closed');
  failure.mockRestore();
  runtime.patch('a-page', { title: 'Still editing A' });
  await runtime.flush();
  const next = await service.open(b);
  expect(next.snapshot().find((o) => o.id === 'b-page')?.title).toBe('B');
  const restored = await service.open(a);
  expect(restored.snapshot().find((o) => o.id === 'a-page')?.title).toBe('Still editing A');
});
