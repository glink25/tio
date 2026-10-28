import { ConnectionAccessError, HostError, object } from '@tio/core';
import { MemoryRepository } from '@tio/provider-memory';
import { WorkspaceRuntime } from '@tio/workspace';
import { afterEach, expect, it, vi } from 'vitest';

import { HostSaveRecovery } from '../../../apps/web/src/services/save-recovery';

const cleanup: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const close of cleanup.splice(0)) await close();
  vi.useRealTimers();
});
async function setup(checkAccess = vi.fn(async () => true)) {
  const repository = new MemoryRepository();
  await repository.commit({
    id: 'seed',
    expectedVersion: 0,
    assetIds: [],
    changes: [object('page', 'w', { id: 'p', title: 'Original', blocks: [] })],
  });
  const runtime = await WorkspaceRuntime.open(repository);
  const onError = vi.fn();
  const recovery = new HostSaveRecovery(runtime, { checkAccess, onError });
  cleanup.push(async () => {
    await recovery.stop();
    runtime.dispose(true);
  });
  return { runtime, repository, recovery, checkAccess, onError };
}

it('automatically persists the latest input after a transient failure', async () => {
  const { runtime, repository } = await setup();
  vi.useFakeTimers();
  const commit = vi.spyOn(repository, 'commit').mockRejectedValueOnce(new HostError('unavailable'));
  runtime.patch('p', { title: 'Failed draft' });
  await expect(runtime.flush()).rejects.toThrow('unavailable');
  runtime.patch('p', { title: 'Latest draft' });
  expect(runtime.snapshot()[0].title).toBe('Latest draft');
  await vi.advanceTimersByTimeAsync(1000);
  expect(runtime.state.getState()).toMatchObject({ pending: 0, error: null, status: 'saved' });
  expect((await repository.readSnapshot()).entries[0].object.title).toBe('Latest draft');
  await vi.advanceTimersByTimeAsync(60000);
  expect(commit).toHaveBeenCalledTimes(3);
});

it('backs off and retains receipt lookup failures until they recover', async () => {
  const { runtime, repository } = await setup();
  vi.useFakeTimers();
  vi.spyOn(repository, 'commit').mockRejectedValueOnce(new HostError('timeout'));
  const lookup = vi
    .spyOn(repository, 'getCommitResult')
    .mockRejectedValueOnce(new HostError('unavailable'));
  runtime.patch('p', { title: 'Latest draft' });
  await expect(runtime.flush()).rejects.toThrow('timeout');
  await vi.advanceTimersByTimeAsync(1000);
  expect(runtime.state.getState().error).toMatchObject({ code: 'unavailable' });
  expect(lookup).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(1999);
  expect(lookup).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(1);
  expect(runtime.state.getState()).toMatchObject({ pending: 0, error: null });
});

it('recovers a lost ACK without applying the old commit twice or losing newer input', async () => {
  const { runtime, repository } = await setup();
  vi.useFakeTimers();
  const original = repository.commit.bind(repository);
  const commit = vi.spyOn(repository, 'commit').mockImplementationOnce(async (request) => {
    await original(request);
    throw new HostError('timeout');
  });
  runtime.patch('p', { title: 'Committed without ACK' });
  await expect(runtime.flush()).rejects.toThrow('timeout');
  runtime.patch('p', { title: 'Newer input' });
  await vi.advanceTimersByTimeAsync(1000);
  expect(commit).toHaveBeenCalledTimes(2);
  expect((await repository.readSnapshot()).entries[0].object.title).toBe('Newer input');
  expect(runtime.state.getState()).toMatchObject({ pending: 0, error: null });
});

it('pauses permission failures without opening authorization or discarding input', async () => {
  const { runtime, repository, checkAccess } = await setup();
  vi.useFakeTimers();
  const denied = new ConnectionAccessError({
    code: 'reauthorization-required',
    scope: { connectionId: 'c' },
  });
  const commit = vi.spyOn(repository, 'commit').mockRejectedValueOnce(denied);
  runtime.patch('p', { title: 'Preserved' });
  await expect(runtime.flush()).rejects.toThrow();
  await vi.advanceTimersByTimeAsync(60000);
  expect(commit).toHaveBeenCalledTimes(1);
  expect(checkAccess).not.toHaveBeenCalled();
  expect(runtime.snapshot()[0].title).toBe('Preserved');
  // The host calls retry only after a successful user-initiated authorization.
  await runtime.retry();
  expect(runtime.state.getState()).toMatchObject({ pending: 0, error: null });
});

it('respects provider retryAt and coalesces concurrent recovery calls', async () => {
  const { runtime, repository } = await setup();
  vi.useFakeTimers();
  vi.spyOn(repository, 'commit').mockRejectedValueOnce(
    new ConnectionAccessError({
      code: 'unreachable',
      retryAt: Date.now() + 10000,
      scope: { connectionId: 'c' },
    }),
  );
  const lookup = vi.spyOn(repository, 'getCommitResult');
  runtime.patch('p', { title: 'Preserved' });
  await expect(runtime.flush()).rejects.toThrow();
  await vi.advanceTimersByTimeAsync(9999);
  expect(lookup).not.toHaveBeenCalled();
  const first = runtime.retry();
  expect(runtime.retry()).toBe(first);
  await first;
  expect(runtime.state.getState()).toMatchObject({ pending: 0, error: null });
});

it('does not touch a previous runtime after stopping while access is being checked', async () => {
  let release!: (allowed: boolean) => void;
  const checkAccess = vi.fn(
    () =>
      new Promise<boolean>((resolve) => {
        release = resolve;
      }),
  );
  const { runtime, repository, recovery } = await setup(checkAccess);
  vi.useFakeTimers();
  const commit = vi.spyOn(repository, 'commit').mockRejectedValueOnce(new HostError('unavailable'));
  runtime.patch('p', { title: 'Old workspace draft' });
  await expect(runtime.flush()).rejects.toThrow();
  await vi.advanceTimersByTimeAsync(1000);
  const stopped = recovery.stop();
  release(true);
  await stopped;
  await vi.advanceTimersByTimeAsync(60000);
  expect(commit).toHaveBeenCalledTimes(1);
  expect(runtime.snapshot()[0].title).toBe('Old workspace draft');
});
