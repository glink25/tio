import { ConnectionAccessError } from '@tio/core';
import type { ObjectRegistry, SyncRepository, WorkspaceContentPort } from '@tio/core';

import { SyncCore, syncIssue, type SyncIssue } from './core';
export { SyncCore, type SyncIssue } from './core';
export type SyncPhase =
  | 'idle'
  | 'syncing'
  | 'synced'
  | 'pending'
  | 'permission'
  | 'failed'
  | 'issues';
export interface ReplicaInitialization {
  isComplete(): boolean | Promise<boolean>;
  complete(): Promise<void>;
  targetId?(): string | undefined;
}
export interface SyncSnapshot {
  phase: SyncPhase;
  progress?: { loaded: number; total: number };
  access?: import('@tio/core').ConnectionAccessState;
}
export class HostSyncRunner {
  issues: SyncIssue[] = [];
  status: SyncPhase = 'idle';
  progress?: { loaded: number; total: number };
  onStatus = () => {};
  private running: Promise<void> | null = null;
  private currentRun?: { started: boolean; initializing: boolean };
  private debounce?: ReturnType<typeof setTimeout>;
  private rerun = false;
  private poll?: ReturnType<typeof setInterval>;
  private retry?: ReturnType<typeof setTimeout>;
  private attempts = 0;
  private retryAt = 0;
  private disposed = false;
  private started = false;
  private automatic: boolean;
  private dirty = false;
  private unsubscribe?: () => void;
  constructor(
    readonly store: SyncRepository,
    readonly provider: WorkspaceContentPort,
    readonly endpoint: string,
    readonly workspaceId: string,
    private host: {
      types?: ObjectRegistry;
      pollMs?: number;
      automatic?: boolean;
      initialization?: ReplicaInitialization;
      beforeAutomaticSync?: () => Promise<boolean>;
      beforeSync?: () => Promise<boolean>;
      onError?: (error: unknown) => void;
      normalizeError?: (error: unknown) => unknown;
      isActive?: () => boolean;
      onActive?: (listener: () => void) => () => void;
      lock?: (name: string, work: () => Promise<void>) => Promise<void>;
    } = {},
  ) {
    this.automatic = host.automatic ?? true;
    this.core = new SyncCore(store, provider, endpoint, workspaceId, host.types);
    this.core.onDirty = () => this.schedule();
    this.core.onProgress = (loaded, total) => {
      if (this.disposed || this.status !== 'syncing') return;
      this.progress = { loaded, total };
      this.onStatus();
    };
  }
  private core: SyncCore;
  private state(s: SyncPhase) {
    this.progress = undefined;
    this.status = s;
    this.onStatus();
  }
  start() {
    if (this.started) return;
    this.started = true;
    this.disposed = false;
    this.core.stopped = false;
    this.poll = setInterval(() => {
      if (this.host.isActive?.() !== false) void this.backgroundSync();
    }, this.host.pollMs ?? 10000);
    this.unsubscribe = this.host.onActive?.(() => {
      if (this.host.isActive?.() !== false) void this.backgroundSync();
    });
    void this.backgroundSync();
  }
  get automaticEnabled() {
    return this.automatic;
  }
  setAutomatic(enabled: boolean) {
    if (this.automatic === enabled) return;
    this.automatic = enabled;
    if (!enabled) {
      clearTimeout(this.debounce);
      this.debounce = undefined;
      clearTimeout(this.retry);
      this.rerun = false;
    } else if (this.started && !this.running) void this.backgroundSync();
    this.onStatus();
  }
  async backgroundSync() {
    if (!this.debounce && this.canRetry()) await this.run(true);
  }
  /** The host has confirmed restored connection access; resume only permitted background work. */
  async resume() {
    this.issues = this.issues.filter((issue) => !(issue.error instanceof ConnectionAccessError));
    this.retryAt = 0;
    if (!this.issues.length) this.state(this.dirty ? 'pending' : 'idle');
    await this.backgroundSync();
  }
  schedule() {
    if (this.disposed) return;
    this.dirty = true;
    if (!this.running && !this.issues.length) this.state('pending');
    if (!this.automatic) return;
    if (!this.canRetry()) return;
    clearTimeout(this.debounce);
    if (!this.running) this.state('pending');
    this.debounce = setTimeout(() => {
      this.debounce = undefined;
      void this.backgroundSync();
    }, 1000);
  }
  async stop() {
    this.disposed = true;
    this.started = false;
    this.core.stopped = true;
    clearTimeout(this.debounce);
    clearTimeout(this.retry);
    clearInterval(this.poll);
    this.unsubscribe?.();
    await this.running;
  }
  async sync() {
    return this.run(false);
  }
  private async run(automatic: boolean): Promise<void> {
    if (this.disposed || this.retryAt > Date.now()) return;
    if (this.running) {
      if (automatic && this.automatic) this.rerun = true;
      const request = this.currentRun;
      await this.running;
      if (
        !automatic &&
        request &&
        (!request.started || request.initializing) &&
        !this.issues.length &&
        !this.disposed
      )
        return this.run(false);
      return;
    }
    clearTimeout(this.debounce);
    this.debounce = undefined;
    const request = { started: false, initializing: false };
    this.currentRun = request;
    const work = async () => {
      try {
        const initialization = this.host.initialization;
        request.initializing = !!initialization && !(await initialization.isComplete());
        if (
          automatic &&
          !request.initializing &&
          (!this.automatic ||
            (this.host.beforeAutomaticSync && !(await this.host.beforeAutomaticSync())))
        )
          return;
        if (this.disposed || (this.host.beforeSync && !(await this.host.beforeSync()))) return;
        if (this.disposed || (automatic && !request.initializing && !this.automatic)) return;
        this.state('syncing');
        request.started = true;
        this.dirty = false;
        this.core.issues = [];
        if (request.initializing) {
          await this.core.pull(initialization?.targetId?.());
          if (this.disposed) return;
          if (!this.core.issues.length) {
            await initialization!.complete();
            // Re-read the downloaded shared policy before considering any publication.
            if (this.host.beforeAutomaticSync) await this.host.beforeAutomaticSync();
            if (this.disposed) return;
            if (!automatic || this.automatic) {
              request.initializing = false;
              await this.core.run();
            }
          }
        } else await this.core.run();
        if (this.disposed) return;
        this.issues = this.core.issues;
        if (this.issues.length)
          this.state(this.issues.some((i) => i.code === 'permission') ? 'permission' : 'issues');
        else {
          this.attempts = 0;
          this.state(this.dirty || this.debounce || this.rerun ? 'pending' : 'synced');
        }
      } catch (caught) {
        const e = this.host.normalizeError?.(caught) ?? caught;
        this.retryAt = (e as { retryAt?: number } | null)?.retryAt ?? 0;
        this.host.onError?.(e);
        const issue = syncIssue('', e);
        this.issues = [issue];
        this.state(issue.code === 'permission' ? 'permission' : 'failed');
      } finally {
        this.onStatus();
        if (
          (this.automatic || request.initializing) &&
          this.issues.length &&
          this.canRetry() &&
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
      this.currentRun = undefined;
      if (this.rerun && this.automatic && !this.disposed) {
        this.rerun = false;
        if (!this.debounce) this.schedule();
      }
    });
    return this.running;
  }
  private canRetry() {
    return !this.issues.some(
      (issue) =>
        issue.error instanceof ConnectionAccessError &&
        (issue.error.state.code === 'reauthorization-required' ||
          issue.error.state.code === 'unrecoverable'),
    );
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
