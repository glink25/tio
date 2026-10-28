import { ConnectionAccessError, HostError } from '@tio/core';
import { FileWorkspaceContent } from '@tio/file-storage';
import type { LocalStore } from '@tio/local-store';
import { MemoryProvider } from '@tio/provider-memory';
import { HostSyncRunner, SyncCore } from '@tio/sync';
import { afterEach, describe, expect, it, vi } from 'vitest';
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
    await e.stop();
    await vi.advanceTimersByTimeAsync(10000);
    expect(run).toHaveBeenCalledTimes(2);
  });
});

it('keeps the current issue while recovering resource permissions automatically', async () => {
  vi.useFakeTimers();
  let release!: () => void;
  const run = vi
    .fn()
    .mockRejectedValueOnce(new HostError('permission'))
    .mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          release = resolve;
        }),
    );
  const runner = engine(run);
  runner.start();
  await vi.advanceTimersByTimeAsync(0);
  expect(runner.status).toBe('permission');
  const issue = runner.issues[0];
  await vi.advanceTimersByTimeAsync(1300);
  expect(run).toHaveBeenCalledTimes(2);
  expect(runner.issues).toEqual([issue]);
  release();
  await vi.advanceTimersByTimeAsync(0);
  expect(runner.status).toBe('synced');
  expect(runner.issues).toEqual([]);
});

it('pauses background publishing until connection authorization is restored', async () => {
  vi.useFakeTimers();
  const run = vi
    .fn()
    .mockRejectedValueOnce(
      new ConnectionAccessError({
        code: 'reauthorization-required',
        scope: { connectionId: 'c' },
      }),
    )
    .mockResolvedValue(undefined);
  const runner = engine(run);
  runner.start();
  await vi.advanceTimersByTimeAsync(60000);
  expect(run).toHaveBeenCalledTimes(1);
  // Successful host authorization resumes the runner internally.
  await runner.sync();
  expect(run).toHaveBeenCalledTimes(2);
  expect(runner.issues).toEqual([]);
});
