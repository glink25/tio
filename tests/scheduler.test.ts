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
  const e = new HostSyncRunner({} as LocalStore, new MemoryProvider(), 'timer-test', 'workspace');
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
