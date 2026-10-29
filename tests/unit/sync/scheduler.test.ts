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
function engine(
  run: () => Promise<void>,
  host: ConstructorParameters<typeof HostSyncRunner>[4] = {},
) {
  const e = new HostSyncRunner(
    {} as LocalStore,
    new FileWorkspaceContent(new MemoryProvider(), 'workspace'),
    'timer-test',
    'workspace',
    host,
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

// Initialization is a host scheduling rule; these tests use no GitHub provider.
it('automatically acquires a manual replica once and publishes only on user request', async () => {
  vi.useFakeTimers();
  let complete = false;
  const publish = vi.fn(async () => {});
  const markComplete = vi.fn(async () => {
    complete = true;
  });
  const runner = engine(publish, {
    automatic: false,
    initialization: { isComplete: () => complete, complete: markComplete },
  });
  const pull = vi
    .spyOn((runner as unknown as { core: SyncCore }).core, 'pull')
    .mockResolvedValue(undefined);
  runner.start();
  await vi.advanceTimersByTimeAsync(0);
  expect(pull).toHaveBeenCalledTimes(1);
  expect(markComplete).toHaveBeenCalledTimes(1);
  expect(publish).not.toHaveBeenCalled();
  expect(runner.automaticEnabled).toBe(false);
  runner.schedule();
  await runner.backgroundSync();
  await vi.advanceTimersByTimeAsync(120000);
  expect(pull).toHaveBeenCalledTimes(1);
  expect(publish).not.toHaveBeenCalled();
  await runner.stop();
  runner.start();
  await vi.advanceTimersByTimeAsync(0);
  expect(pull).toHaveBeenCalledTimes(1);
  await runner.sync();
  expect(publish).toHaveBeenCalledTimes(1);
});

it('retries interrupted initialization even in manual mode without enabling later automatic sync', async () => {
  vi.useFakeTimers();
  let complete = false;
  const runner = engine(
    vi.fn(async () => {}),
    {
      automatic: false,
      initialization: {
        isComplete: () => complete,
        complete: async () => {
          complete = true;
        },
      },
    },
  );
  const pull = vi
    .spyOn((runner as unknown as { core: SyncCore }).core, 'pull')
    .mockRejectedValueOnce(new Error('Interrupted'))
    .mockResolvedValue(undefined);
  runner.start();
  await vi.advanceTimersByTimeAsync(0);
  expect(runner.status).toBe('failed');
  expect(complete).toBe(false);
  await vi.advanceTimersByTimeAsync(1400);
  expect(pull).toHaveBeenCalledTimes(2);
  expect(complete).toBe(true);
  expect(runner.status).toBe('synced');
  await vi.advanceTimersByTimeAsync(120000);
  expect(pull).toHaveBeenCalledTimes(2);
});

it('waits for an in-flight initial pull before honoring an explicit sync request', async () => {
  vi.useFakeTimers();
  let release!: () => void;
  let complete = false;
  const publish = vi.fn(async () => {});
  const runner = engine(publish, {
    automatic: false,
    initialization: {
      isComplete: () => complete,
      complete: async () => {
        complete = true;
      },
    },
  });
  const pull = vi.spyOn((runner as unknown as { core: SyncCore }).core, 'pull').mockImplementation(
    async () =>
      new Promise<void>((done) => {
        release = done;
      }),
  );
  runner.start();
  await vi.advanceTimersByTimeAsync(0);
  const explicit = runner.sync();
  expect(publish).not.toHaveBeenCalled();
  release();
  await explicit;
  expect(pull).toHaveBeenCalledTimes(1);
  expect(publish).toHaveBeenCalledTimes(1);
});

it('rechecks initialization under the host lock after another window finishes acquisition', async () => {
  vi.useFakeTimers();
  let release!: () => void;
  let complete = false;
  const publish = vi.fn(async () => {});
  const runner = engine(publish, {
    automatic: false,
    initialization: { isComplete: () => complete, complete: vi.fn(async () => {}) },
    lock: async (_name, work) => {
      await new Promise<void>((done) => {
        release = done;
      });
      await work();
    },
  });
  const pull = vi.spyOn((runner as unknown as { core: SyncCore }).core, 'pull');
  runner.start();
  await vi.advanceTimersByTimeAsync(0);
  complete = true;
  release();
  await vi.advanceTimersByTimeAsync(0);
  expect(pull).not.toHaveBeenCalled();
  expect(publish).not.toHaveBeenCalled();
});

it('resumes incomplete manual acquisition after host-confirmed authorization recovery', async () => {
  vi.useFakeTimers();
  let complete = false;
  const publish = vi.fn(async () => {});
  const runner = engine(publish, {
    automatic: false,
    initialization: {
      isComplete: () => complete,
      complete: async () => {
        complete = true;
      },
    },
  });
  const pull = vi
    .spyOn((runner as unknown as { core: SyncCore }).core, 'pull')
    .mockRejectedValueOnce(
      new ConnectionAccessError({
        code: 'reauthorization-required',
        scope: { connectionId: 'test' },
      }),
    )
    .mockResolvedValue(undefined);
  runner.start();
  await vi.advanceTimersByTimeAsync(120000);
  expect(pull).toHaveBeenCalledTimes(1);
  await runner.resume();
  expect(complete).toBe(true);
  expect(pull).toHaveBeenCalledTimes(2);
  expect(publish).not.toHaveBeenCalled();
  await runner.resume();
  expect(publish).not.toHaveBeenCalled();
});
