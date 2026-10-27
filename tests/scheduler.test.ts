import { FileWorkspaceContent } from '@tio/file-storage';
import type { LocalStore } from '@tio/local-store';
import { MemoryProvider } from '@tio/provider-memory';
import { HostSyncRunner, SyncCore } from '@tio/sync';
import { describe, it, expect, vi, afterEach } from 'vitest';
const engines: HostSyncRunner[] = [];
afterEach(() => {
  engines.forEach((e) => e.stop());
  vi.useRealTimers();
});
function engine(run: () => Promise<void>) {
  const e = new HostSyncRunner(
    {} as LocalStore,
    new FileWorkspaceContent(new MemoryProvider(), 'workspace'),
    'timer-test',
    'workspace',
  );
  // Isolate scheduling from IndexedDB; integration tests exercise real sync work.
  vi.spyOn((e as unknown as { core: SyncCore }).core, 'run').mockImplementation(run);
  engines.push(e);
  return e;
}
describe('trailing synchronization', () => {
  it('coalesces continuous changes past both the old deadline and foreground polls', async () => {
    vi.useFakeTimers();
    const run = vi.fn(async () => {});
    const e = engine(run);
    e.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(run).toHaveBeenCalledTimes(1);
    for (let i = 0; i < 30; i++) {
      e.schedule();
      await vi.advanceTimersByTimeAsync(500);
    }
    expect(run).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(499);
    expect(run).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(run).toHaveBeenCalledTimes(2);
  });
  it('does not lose a trailing request that expires during an in-flight write', async () => {
    vi.useFakeTimers();
    let release!: () => void;
    const run = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise<void>((r) => {
            release = r;
          }),
      )
      .mockResolvedValue(undefined);
    const e = engine(run);
    const active = e.sync();
    e.schedule();
    await vi.advanceTimersByTimeAsync(1000);
    expect(run).toHaveBeenCalledTimes(1);
    release();
    await active;
    await vi.advanceTimersByTimeAsync(1000);
    expect(run).toHaveBeenCalledTimes(2);
    e.schedule();
    e.stop();
    await vi.advanceTimersByTimeAsync(10000);
    expect(run).toHaveBeenCalledTimes(2);
  });
});

it('clears progress between runs and after both success and failure', async () => {
  let release!: () => void;
  const e = engine(
    () =>
      new Promise<void>((resolve) => {
        release = resolve;
      }),
  );
  const core = (e as unknown as { core: SyncCore }).core;
  const first = e.sync();
  core.onProgress(2, 3);
  expect(e.progress).toEqual({ loaded: 2, total: 3 });
  release();
  await first;
  expect(e.status).toBe('synced');
  expect(e.progress).toBeUndefined();
  vi.spyOn(core, 'run').mockImplementation(async () => {
    expect(e.progress).toBeUndefined();
    core.onProgress(1, 2);
    throw new Error('different failure message');
  });
  await e.sync();
  expect(e.status).toBe('failed');
  expect(e.progress).toBeUndefined();
});

it('does not automatically retry resource denial but allows explicit retry', async () => {
  const { HostError } = await import('@tio/core');
  vi.useFakeTimers();
  const run = vi.fn(async () => {
    throw new HostError('permission', 'arbitrary text');
  });
  const e = engine(run);
  e.start();
  await vi.advanceTimersByTimeAsync(120000);
  expect(run).toHaveBeenCalledTimes(1);
  expect(e.status).toBe('permission');
  e.schedule();
  await vi.advanceTimersByTimeAsync(10000);
  expect(run).toHaveBeenCalledTimes(1);
  await e.sync();
  expect(run).toHaveBeenCalledTimes(2);
});
