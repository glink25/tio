import { ConnectionAccessError, DomainError, HostError } from '@tio/core';
import { StorageError } from '@tio/storage';
import type { WorkspaceRuntime } from '@tio/workspace';

/** Host scheduling only: the runtime retains the commands and recovers their receipts. */
export class HostSaveRecovery {
  private timer?: ReturnType<typeof setTimeout>;
  private unsubscribe: () => void;
  private running?: Promise<void>;
  private stopped = false;
  private attempts = 0;
  constructor(
    private runtime: WorkspaceRuntime,
    private host: {
      checkAccess: () => Promise<boolean>;
      onError: (error: unknown) => void;
    },
  ) {
    this.unsubscribe = runtime.state.subscribe(() => this.schedule());
    this.schedule();
  }
  private schedule() {
    if (this.stopped || this.running) return;
    const error = this.runtime.state.getState().error;
    if (!error) {
      clearTimeout(this.timer);
      this.timer = undefined;
      this.attempts = 0;
      return;
    }
    this.host.onError(error);
    if (!recoverable(error)) {
      clearTimeout(this.timer);
      this.timer = undefined;
      return;
    }
    if (this.timer) return;
    const retryAt = error instanceof ConnectionAccessError ? (error.retryAt ?? 0) : 0;
    this.timer = setTimeout(
      () => {
        this.timer = undefined;
        this.running = this.recover().finally(() => {
          this.running = undefined;
          this.schedule();
        });
      },
      Math.max(Math.min(60000, 1000 * 2 ** Math.min(this.attempts++, 6)), retryAt - Date.now()),
    );
  }
  private async recover() {
    try {
      if (!(await this.host.checkAccess()) || this.stopped) return;
      await this.runtime.retry();
    } catch (error) {
      this.host.onError(error);
    }
  }
  async stop() {
    this.stopped = true;
    this.unsubscribe();
    clearTimeout(this.timer);
    await this.running;
  }
}
function recoverable(error: Error) {
  if (error instanceof DomainError) return false;
  if (error instanceof HostError)
    return ['unavailable', 'timeout', 'pending', 'conflict'].includes(error.code);
  if (error instanceof StorageError) return error.code === 'io';
  if (error instanceof ConnectionAccessError) return error.state.code === 'unreachable';
  return true;
}
