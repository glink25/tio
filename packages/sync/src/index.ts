import type { ObjectRegistry, SyncRepository, WorkspaceContentPort } from '@tio/core';

import { SyncCore, type SyncIssue } from './core';
export { SyncCore, type SyncIssue } from './core';
export class HostSyncRunner {
  issues: SyncIssue[] = [];
  status = 'idle';
  progress?: { loaded: number; total: number };
  onStatus = () => {};
  private running: Promise<void> | null = null;
  private debounce?: ReturnType<typeof setTimeout>;
  private rerun = false;
  private poll?: ReturnType<typeof setInterval>;
  private retry?: ReturnType<typeof setTimeout>;
  private attempts = 0;
  private retryAt = 0;
  private disposed = false;
  private unsubscribe?: () => void;
  constructor(
    readonly store: SyncRepository,
    readonly provider: WorkspaceContentPort,
    readonly endpoint: string,
    readonly workspaceId: string,
    private host: {
      types?: ObjectRegistry;
      pollMs?: number;
      beforeSync?: () => Promise<boolean>;
      onError?: (error: unknown) => void;
      isActive?: () => boolean;
      onActive?: (listener: () => void) => () => void;
      lock?: (name: string, work: () => Promise<void>) => Promise<void>;
    } = {},
  ) {
    this.core = new SyncCore(store, provider, endpoint, workspaceId, host.types);
    this.core.onDirty = () => this.schedule();
    this.core.onProgress = (loaded, total) => {
      this.progress = { loaded, total };
      this.onStatus();
    };
  }
  private core: SyncCore;
  private state(s: string) {
    this.status = s;
    this.onStatus();
  }
  start() {
    this.disposed = false;
    this.core.stopped = false;
    this.poll = setInterval(() => {
      if (this.host.isActive?.() !== false) void this.backgroundSync();
    }, this.host.pollMs ?? 10000);
    this.unsubscribe = this.host.onActive?.(() => {
      if (this.host.isActive?.() !== false) void this.backgroundSync();
    });
    void this.sync();
  }
  private async backgroundSync() {
    if (!this.debounce) await this.sync();
  }
  schedule() {
    if (this.disposed) return;
    clearTimeout(this.debounce);
    if (!this.running) this.state('pending');
    this.debounce = setTimeout(() => {
      this.debounce = undefined;
      void this.sync();
    }, 1000);
  }
  async stop() {
    this.disposed = true;
    this.core.stopped = true;
    clearTimeout(this.debounce);
    clearTimeout(this.retry);
    clearInterval(this.poll);
    this.unsubscribe?.();
    await this.running;
  }
  async sync() {
    if (this.disposed || this.retryAt > Date.now()) return;
    if (this.running) {
      this.rerun = true;
      return this.running;
    }
    clearTimeout(this.debounce);
    this.debounce = undefined;
    const work = async () => {
      this.issues = [];
      try {
        if (this.disposed || (this.host.beforeSync && !(await this.host.beforeSync()))) return;
        if (this.disposed) return;
        this.state('syncing');
        this.core.issues = [];
        await this.core.run();
        this.issues = this.core.issues;
        if (this.issues.length)
          this.state(this.issues.some((i) => i.code === 'permission') ? 'permission' : 'issues');
        else {
          this.attempts = 0;
          this.state(this.debounce || this.rerun ? 'pending' : 'synced');
        }
      } catch (e) {
        this.retryAt = (e as { retryAt?: number }).retryAt ?? 0;
        this.host.onError?.(e);
        const err = e as Error;
        this.issues.push({ path: '', code: err.name, message: err.message });
        this.state(err.name === 'NotAllowedError' ? 'permission' : 'failed');
      } finally {
        this.onStatus();
        if (
          this.issues.length &&
          !this.issues.some((i) => i.code === 'permission' || i.code === 'NotAllowedError') &&
          !this.disposed
        ) {
          clearTimeout(this.retry);
          this.retry = setTimeout(
            () => void this.backgroundSync(),
            Math.max(
              Math.min(60000, 1000 * 2 ** this.attempts++) + Math.random() * 300,
              this.retryAt - Date.now(),
            ),
          );
        }
      }
    };
    this.running = (async () => {
      if (this.host.lock) await this.host.lock('tio-sync-' + this.endpoint, work);
      else await work();
    })().finally(() => {
      this.running = null;
      if (this.rerun && !this.disposed) {
        this.rerun = false;
        if (!this.debounce) this.schedule();
      }
    });
    return this.running;
  }
  async discard(id: string) {
    if (this.running) await this.running;
    const entry = await this.store.get(id);
    if (!entry) return;
    const remote = await this.core.content.read(id);
    const baseline = remote ?? entry.sync[this.endpoint]?.base;
    if (!baseline) throw new Error('No remote baseline; export the draft before removing it');
    if ((await this.store.reconcile(baseline, entry.revision)) === null)
      throw new Error('Draft changed; retry');
    await this.store.acknowledge(id, this.endpoint, baseline, entry.revision + 1);
    this.issues = this.issues.filter((issue) => issue.id !== id);
    this.state(this.issues.length ? 'issues' : 'synced');
  }
  async restore(id: string) {
    await this.store.clearBaseline(id, this.endpoint);
    await this.sync();
  }
}
