import {
  id,
  ConnectionAccessError,
  HostError,
  DomainError,
  type Connection,
  type WorkspaceSession,
  type TioObject,
  type AssetData,
  type ConnectionAccessState,
  type WorkspaceRepository,
} from '@tio/core';
import { LocalCatalog } from '@tio/local-store';
import { StorageError } from '@tio/storage';
import { HostSyncRunner, type SyncSnapshot } from '@tio/sync';
import { WorkspaceRuntime } from '@tio/workspace';

import {
  createConnectionBinding,
  type ConnectionBinding,
  type ConnectionFactory,
} from './connection-adapters';
import { credentials, clearCredentials } from './github-auth';
import { HostSaveRecovery } from './save-recovery';
import { WorkspaceLifecycle } from './workspace-lifecycle';
export class WorkspaceServices {
  constructor(private factory: ConnectionFactory = createConnectionBinding) {}
  private binding?: ConnectionBinding;
  private generation = 0;
  private syncStarted = false;
  private unsubscribeAccess?: () => void;
  private authorization?: Promise<void>;
  private recovery?: HostSaveRecovery;
  statusError?: unknown;
  reportStatusError(error: unknown) {
    this.statusError = this.active?.runtime.state.getState().error === error ? undefined : error;
    if (error instanceof ConnectionAccessError) this.setAccess(error.state);
    this.status();
  }
  private saveFailed(error: unknown) {
    if (error instanceof ConnectionAccessError) this.setAccess(error.state);
    else if (error instanceof StorageError && error.code === 'permission' && this.binding)
      this.setAccess(this.binding.adapter.classifyError(error));
  }
  private accessStates = new Map<string, ConnectionAccessState>();
  private accessFor(workspaceId?: string) {
    const connection = this.accessStates.get('');
    return connection && connection.code !== 'available'
      ? connection
      : (this.accessStates.get(workspaceId ?? '') ?? connection);
  }
  get access() {
    return this.accessFor(this.active?.session.workspaceId);
  }
  onChange = () => {};
  get identity() {
    return this.binding?.identity;
  }
  mentionPeople(workspaceId: string) {
    return this.binding?.mentionPeople?.(workspaceId) ?? Promise.resolve([]);
  }
  get supportsSync() {
    return this.binding?.adapter.supportsSync ?? false;
  }
  get hasReplicaSync() {
    return !!this.runner;
  }
  get manualSync() {
    return !!this.runner && !this.runner.automaticEnabled;
  }
  get contentReady() {
    return this.active
      ? (this.binding?.isContentReady?.(this.active.session.workspaceId) ?? true)
      : false;
  }
  get canReauthorize() {
    return !!this.binding?.adapter.reauthorize;
  }
  private setAccess(state: ConnectionAccessState) {
    if (state.scope.connectionId !== this.connection?.id) return;
    const previous = this.accessStates.get(state.scope.workspaceId ?? '');
    if (previous?.code === state.code && previous?.retryAt === state.retryAt) return;
    this.accessStates.set(state.scope.workspaceId ?? '', state);
    if (previous?.code !== 'available' && state.code === 'available') this.statusError = undefined;
    if (
      this.active &&
      this.repositories.get(this.active.session.id)?.repository.storageCapabilities?.offline ===
        false
    )
      this.active.runtime.setWritable(this.access?.code === 'available');
    this.status();
    this.onChange();
  }
  private bind() {
    this.binding = this.factory(this.connection!, this.handle);
    const generation = this.generation;
    this.unsubscribeAccess = this.binding.adapter.subscribe((state) => {
      if (generation === this.generation) this.setAccess(state);
    });
  }
  private async checkAccess(workspaceId?: string) {
    const binding = this.binding,
      generation = this.generation;
    if (!binding) return false;
    const access = this.accessFor(workspaceId);
    if (access?.code === 'reauthorization-required' || access?.code === 'unrecoverable')
      return false;
    let state: ConnectionAccessState;
    try {
      state = await binding.adapter.getAccessState(workspaceId);
    } catch (error) {
      state = binding.adapter.classifyError(error);
    }
    if (generation !== this.generation) return false;
    this.setAccess(state);
    return state.code === 'available';
  }
  private catalog = new LocalCatalog();
  private lifecycle = new WorkspaceLifecycle(this.catalog, async (id) => {
    try {
      await this.stopWorkspace(id);
    } catch (error) {
      this.reportStatusError(error);
    }
  });
  onWorkspaceClosed = (_id: string) => {};
  workspaceActions(session: WorkspaceSession) {
    if (session.connectionId !== this.connection?.id) return {};
    return this.binding?.workspaceActions?.(session.workspaceId) ?? {};
  }
  private async stopWorkspace(id: string) {
    const active = this.active?.session.id === id ? this.active : undefined;
    if (active) {
      // Detach first, so polling and recovery cannot start further work.
      this.active = undefined;
      const recovery = this.recovery;
      this.recovery = undefined;
      const closing = active.runtime.discardAndClose();
      await recovery?.stop();
      await closing;
      this.onWorkspaceClosed(id);
    }
    const entry = this.repositories.get(id);
    if (entry) {
      entry.unsubscribe?.();
      await entry.runner?.stop();
      entry.repository.close();
      this.repositories.delete(id);
    }
    this.onChange();
  }
  deleteWorkspace(session: WorkspaceSession) {
    return this.transition(async () => {
      this.assertLive();
      const action = this.workspaceActions(session).delete;
      if (action?.kind !== 'direct') throw new HostError('unsupported');
      await this.lifecycle.lock(session.id, () => this.lifecycle.mark(session.id, 'deleting'));
      await this.stopWorkspace(session.id);
      await this.lifecycle.lock(session.id, async () => {
        try {
          await action.execute();
        } catch (error) {
          if (error instanceof StorageError && error.code === 'permission' && this.binding)
            throw new ConnectionAccessError(this.binding.adapter.classifyError(error), {
              cause: error,
            });
          throw error;
        }
        await this.catalog.removeSession(session.id);
        await this.lifecycle.mark(session.id, 'deleted');
      });
      localStorage.removeItem('tio.sidebar.' + session.workspaceId);
      this.accessStates.delete(session.workspaceId);
      this.onChange();
    });
  }
  private transitions: Promise<unknown> = Promise.resolve();
  private transition<T>(work: () => Promise<T>): Promise<T> {
    const next = this.transitions.then(work);
    this.transitions = next.catch(() => {});
    return next;
  }
  connection: Connection | null = null;
  private handle?: FileSystemDirectoryHandle;
  private repositories = new Map<
    string,
    {
      repository: WorkspaceRepository & { close(): void };
      runner?: HostSyncRunner;
      unsubscribe?: () => void;
      ready?: Promise<void>;
      configureSync?: (discovered?: TioObject) => Promise<void>;
    }
  >();
  private active?: { session: WorkspaceSession; runtime: WorkspaceRuntime };
  private queue: Promise<void> = Promise.resolve();
  private status = () => {};
  private polling = false;
  private timer?: ReturnType<typeof setInterval>;
  private startPolling() {
    if (this.timer) return;
    this.timer = setInterval(
      () => {
        if (this.polling || !this.active || document.visibilityState !== 'visible') return;
        const active = this.active;
        this.polling = true;
        void this.checkAccess(active.session.workspaceId)
          .then((allowed) => {
            if (allowed && active === this.active) return active.runtime.poll();
          })
          .catch((error) => {
            if (active === this.active && this.binding)
              this.setAccess(this.binding.adapter.classifyError(error));
          })
          .finally(() => {
            this.polling = false;
          });
      },
      this.connection?.kind === 'github' ? 60000 : 5000,
    );
  }
  private assertLive() {
    if (this.abandoning) throw new Error('Connection is closed');
  }
  async initialize() {
    this.assertLive();
    const saved = await this.catalog.setting('connection');
    this.assertLive();
    if (saved) {
      this.connection = saved.connection;
      this.handle = saved.handle;
      this.bind();
      if (this.binding?.sync)
        for (const session of await this.sessions()) await this.repository(session);
    }
  }
  async connect(kind: Connection['kind'], handle?: FileSystemDirectoryHandle) {
    this.assertLive();
    await this.disconnect(kind !== 'github');
    this.assertLive();
    if (kind === 'github') {
      const auth = credentials();
      if (!auth) throw new Error('GitHub credentials missing');
      this.connection = { id: `github-${auth.userId}`, kind, name: auth.login };
      this.bind();
      await this.catalog.setting('connection', { connection: this.connection });
      return;
    }
    const previous = await this.catalog.setting('folderIdentity');
    const same = handle && previous?.handle && (await handle.isSameEntry(previous.handle));
    this.assertLive();
    this.connection = {
      id: kind === 'device' ? 'device' : same ? previous.id : id('connection'),
      kind,
      name: handle?.name ?? '本机',
    };
    if (handle) await this.catalog.setting('folderIdentity', { id: this.connection.id, handle });
    this.handle = handle;
    this.bind();
    await this.catalog.setting('connection', { connection: this.connection, handle });
  }
  async sessions(): Promise<WorkspaceSession[]> {
    if (!this.connection) return [];
    const saved = (await this.catalog.sessions()).filter(
      (s) => s.connectionId === this.connection!.id,
    );
    return saved;
  }
  async refreshRemote(strict = false) {
    const generation = this.generation,
      binding = this.binding;
    if (!this.syncStarted) {
      this.syncStarted = true;
      for (const entry of this.repositories.values()) {
        await entry.ready;
        entry.runner?.start();
      }
    }
    if (!binding || !binding.adapter.supportsSync) return;
    if (!(await this.checkAccess())) {
      if (strict) throw new ConnectionAccessError(this.accessFor()!);
      return;
    }
    let discovered: TioObject[];
    try {
      discovered = await binding.discover();
    } catch (error) {
      if (generation === this.generation) this.setAccess(binding.adapter.classifyError(error));
      if (strict) throw error;
      return;
    }
    if (generation !== this.generation) return;
    const saved = await this.sessions();
    for (const workspace of discovered) {
      if (generation !== this.generation) return;
      const existing = saved.find((s) => s.workspaceId === workspace.id);
      if (existing) {
        if (binding.sync) await this.repository(existing, workspace);
        continue;
      }
      const session = {
        id: this.connection!.id + '_' + workspace.id,
        workspaceId: workspace.id,
        connectionId: this.connection!.id,
        name: workspace.name ?? '',
      };
      if (await this.catalog.read('workspace-lifecycle/' + session.id)) continue;
      await this.catalog.saveSession(session);
      if (binding.sync) await this.repository(session, workspace);
    }
    this.onChange();
  }
  setting(key: string, ...value: [unknown?]) {
    this.assertLive();
    return value.length ? this.catalog.setting(key, value[0]) : this.catalog.setting(key);
  }
  saveSession(session: WorkspaceSession) {
    this.assertLive();
    return this.catalog.saveSession(session);
  }
  private async repository(
    session: WorkspaceSession,
    discovered?: TioObject,
    localCreation = false,
  ) {
    this.assertLive();
    let entry = this.repositories.get(session.id);
    if (!entry) {
      if (!this.binding) throw new Error('Connection is not initialized');
      const repository = this.lifecycle.guard(
        session.id,
        this.binding.repository(session.workspaceId, session.id),
      );
      entry = { repository };
      this.repositories.set(session.id, entry);
      const synchronization = this.binding?.sync?.(session.workspaceId, repository);
      const content = synchronization?.content;
      if (content && synchronization) {
        if (localCreation) await synchronization.initialization.complete();
        const runner: HostSyncRunner = new HostSyncRunner(
          synchronization.store,
          content,
          synchronization.endpoint,
          session.workspaceId,
          {
            pollMs: synchronization?.pollMs,
            automatic: false,
            initialization: {
              isComplete: () => synchronization.initialization.isComplete(),
              targetId: () =>
                this.active?.session.id === session.id
                  ? this.active.session.selectedId
                  : session.selectedId,
              complete: async () => {
                if (this.active?.session.id === session.id) await this.active.runtime.poll();
                await synchronization.initialization.complete();
                this.configureAutomation();
                this.status();
              },
            },
            beforeAutomaticSync: async () => {
              await configureSync();
              return runner.automaticEnabled;
            },
            beforeSync: async () => {
              const allowed = await this.checkAccess(session.workspaceId);
              const access = this.accessFor(session.workspaceId);
              if (!allowed && access?.code === 'unreachable')
                throw new ConnectionAccessError(access);
              return allowed;
            },
            normalizeError: (error) => {
              if (
                error instanceof HostError ||
                error instanceof DomainError ||
                (error instanceof StorageError && error.code !== 'permission') ||
                error instanceof ConnectionAccessError ||
                !this.binding
              )
                return error;
              return new ConnectionAccessError(this.binding.adapter.classifyError(error), {
                cause: error,
              });
            },
            onError: (error) => {
              if (!(error instanceof ConnectionAccessError)) return;
              if (!this.binding) return;
              const state = this.binding.adapter.classifyError(error);
              this.setAccess(
                state.code === 'forbidden'
                  ? { ...state, scope: { ...state.scope, workspaceId: session.workspaceId } }
                  : state,
              );
            },
            isActive: () => document.visibilityState === 'visible',
            onActive: (listener) => {
              document.addEventListener('visibilitychange', listener);
              globalThis.window?.addEventListener('online', listener);
              return () => {
                document.removeEventListener('visibilitychange', listener);
                globalThis.window?.removeEventListener('online', listener);
              };
            },
            lock: (_name, work) => {
              const job = this.queue.then(() =>
                navigator.locks ? navigator.locks.request('tio-' + session.id, work) : work(),
              );
              this.queue = job.catch(() => {});
              return job;
            },
          },
        );
        entry.runner = runner;
        let fallback = discovered;
        let updates = Promise.resolve();
        const configureSync = (workspace?: TioObject) => {
          if (workspace) fallback = workspace;
          const next = updates.then(async () => {
            const local = await synchronization.store.get(session.workspaceId);
            const workspace = local?.object ?? fallback;
            // An empty replica waits for discovery to supply its initial policy.
            runner.setAutomatic(!!workspace && workspace.manualSync !== true);
          });
          updates = next.catch(() => {});
          return next;
        };
        entry.configureSync = configureSync;
        runner.onStatus = () => {
          this.configureAutomation();
          this.status();
        };
        entry.unsubscribe = repository.subscribeChanges((event) => {
          void configureSync()
            .then(() => {
              if (event.origin !== 'sync') runner.schedule();
            })
            .catch((error) => this.reportStatusError(error));
        });
        entry.ready = configureSync().then(() => {
          if (this.syncStarted) runner.start();
        });
      }
    }
    await entry.ready;
    if (discovered) await entry.configureSync?.(discovered);
    return entry;
  }
  async create(
    objects: TioObject[],
    assets = new Map<string, AssetData>(),
    preserveTimestamps = false,
  ) {
    if (!this.connection) await this.connect('device');
    const workspace = objects.find((o) => o.type === 'workspace')!;
    await this.binding?.create?.(workspace.id);
    this.assertLive();
    const session: WorkspaceSession = {
      id: this.connection!.id + '_' + workspace.id,
      workspaceId: workspace.id,
      connectionId: this.connection!.id,
      name: workspace.name ?? '工作空间',
      selectedId: objects
        .filter((o) => o.type === 'page' && !o.deleted)
        .sort(
          (a, b) =>
            Number(!!a.parentId) - Number(!!b.parentId) ||
            (a.order ?? 0) - (b.order ?? 0) ||
            a.id.localeCompare(b.id),
        )[0]?.id,
    };
    const { repository } = await this.repository(session, workspace, true);
    const runtime = await WorkspaceRuntime.open(repository);
    if (this.abandoning) {
      runtime.dispose(true);
      this.assertLive();
    }
    try {
      if (preserveTimestamps) runtime.import(objects, assets);
      else runtime.create(objects, undefined, assets);
      await runtime.flush();
    } finally {
      runtime.dispose(true);
    }
    this.assertLive();
    await this.catalog.saveSession(session);
    return session;
  }
  open(session: WorkspaceSession) {
    return this.transition(async () => {
      await this.lifecycle.assertOpen(session.id);
      await this.active?.runtime.flush();
      const entry = await this.repository(session);
      if (
        entry.repository.storageCapabilities?.offline === false &&
        !(await this.checkAccess(session.workspaceId))
      )
        throw new ConnectionAccessError(this.accessFor(session.workspaceId)!);
      const runtime = await WorkspaceRuntime.open(entry.repository, undefined, undefined, {
        targetId: session.selectedId,
      });
      try {
        this.assertLive();
        await this.closeActive();
        this.assertLive();
        return await this.lifecycle.lock(session.id, async () => {
          await this.lifecycle.assertOpen(session.id);
          this.active = { session, runtime };
          this.configureAutomation();
          this.statusError = undefined;
          this.recovery = new HostSaveRecovery(runtime, {
            checkAccess: () => this.checkAccess(session.workspaceId),
            onError: (error) => this.saveFailed(error),
          });
          this.startPolling();
          return runtime;
        });
      } catch (error) {
        runtime.dispose(true);
        throw error;
      }
    });
  }
  private configureAutomation() {
    if (!this.active || !this.contentReady || this.active.runtime.automation) return;
    const { runtime, session } = this.active;
    runtime.automation =
      this.repositories.get(session.id)?.repository.automation ??
      this.binding?.automation?.(runtime, session.workspaceId);
  }
  startSync(onStatus: (status: SyncSnapshot) => void) {
    this.status = () =>
      onStatus({
        phase: this.runner?.status ?? 'idle',
        progress: this.runner?.progress,
        access: this.access,
      });
    this.status();
  }
  private get runner() {
    return this.active
      ? this.repositories.get(this.active.session.id)?.runner
      : [...this.repositories.values()].find((entry) => entry.runner?.status === 'syncing')?.runner;
  }
  get issues() {
    return this.runner?.issues ?? [];
  }
  async credentialsChanged() {
    this.accessStates.clear();
    if (await this.checkAccess()) {
      await this.refreshRemote();
      await Promise.all(
        [...this.repositories.values()].flatMap((entry) =>
          entry.runner ? [entry.runner.resume()] : [],
        ),
      );
    }
  }
  authorize() {
    if (this.authorization) return this.authorization;
    const binding = this.binding,
      generation = this.generation;
    if (!binding?.adapter.reauthorize) return Promise.resolve();
    // Do not await flush/checkAccess before invoking the adapter's user-gesture API.
    const workspaceId = this.access?.scope.workspaceId;
    const result = binding.adapter.reauthorize(workspaceId);
    const work = result
      .then(async (outcome) => {
        if (generation !== this.generation || outcome !== 'success') return;
        const state = await binding.adapter.getAccessState(workspaceId);
        if (generation !== this.generation) return;
        this.setAccess(state);
        this.statusError = undefined;
        await this.refreshRemote();
        if (generation !== this.generation) return;
        if (this.active?.runtime.state.getState().error) await this.active.runtime.retry();
        else await this.active?.runtime.flush();
        await Promise.all(
          [...this.repositories.values()].flatMap((entry) =>
            entry.runner ? [entry.runner.resume()] : [],
          ),
        );
      })
      .finally(() => {
        if (this.authorization === work) this.authorization = undefined;
      });
    this.authorization = work;
    return work;
  }
  private syncing?: Promise<void>;
  sync() {
    if (this.syncing) return this.syncing;
    const active = this.active;
    this.syncing = (async () => {
      await active?.runtime.flush();
      await this.refreshRemote();
      if (active !== this.active) return;
      await this.runner?.sync();
      if (!this.runner && active) await active.runtime.poll();
    })().finally(() => {
      this.syncing = undefined;
    });
    return this.syncing;
  }
  async discard(id: string) {
    await this.active?.runtime.flush();
    await this.runner?.discard(id);
  }
  async restore(id: string) {
    await this.runner?.restore(id);
  }
  private async closeActive() {
    const active = this.active;
    if (!active) return;
    await this.recovery?.stop();
    this.recovery = undefined;
    try {
      await active.runtime.close();
      this.active = undefined;
    } catch (error) {
      this.recovery = new HostSaveRecovery(active.runtime, {
        checkAccess: () => this.checkAccess(active.session.workspaceId),
        onError: (failure) => this.saveFailed(failure),
      });
      throw error;
    }
  }

  close() {
    return this.transition(() => this.closeActive());
  }
  private invalidateConnection() {
    this.generation++;
    void this.recovery?.stop();
    clearInterval(this.timer);
    this.timer = undefined;
    this.unsubscribeAccess?.();
    this.unsubscribeAccess = undefined;
    this.authorization = undefined;
  }
  disconnect(clearAuth = true) {
    this.invalidateConnection();
    return this.transition(async () => {
      await this.closeActive();
      await Promise.all(
        [...this.repositories.values()].map(async (e) => {
          e.unsubscribe?.();
          await e.runner?.stop();
          e.repository.close();
        }),
      );
      this.repositories.clear();
      if (clearAuth && this.connection?.kind === 'github') clearCredentials();
      this.connection = null;
      this.binding = undefined;
      this.accessStates.clear();
      this.syncStarted = false;
      this.handle = undefined;
      await this.catalog.setting('connection', null);
    });
  }
  private abandoning?: Promise<void>;
  abandon() {
    if (this.abandoning) return this.abandoning;
    this.invalidateConnection();
    this.onChange = () => {};
    this.status = () => {};
    this.binding?.dispose?.();
    clearCredentials();
    const active = this.active;
    const recovery = this.recovery;
    this.recovery = undefined;
    this.active = undefined;
    this.lifecycle.close();
    this.abandoning = this.transition(async () => {
      await recovery?.stop();
      active?.runtime.dispose(true);
      this.active?.runtime.dispose(true);
      this.active = undefined;
      await Promise.all(
        [...this.repositories.values()].map(async (entry) => {
          entry.unsubscribe?.();
          await entry.runner?.stop();
          entry.repository.close();
        }),
      );
      this.repositories.clear();
      await this.catalog.close();
      this.binding = undefined;
      this.connection = null;
    });
    return this.abandoning;
  }
  dispose() {
    this.lifecycle.close();
    if (this.abandoning) return this.abandoning;
    this.invalidateConnection();
    return this.transition(async () => {
      await this.closeActive();
      await Promise.all(
        [...this.repositories.values()].map(async (e) => {
          e.unsubscribe?.();
          await e.runner?.stop();
          e.repository.close();
        }),
      );
      this.repositories.clear();
      await this.catalog.close();
    });
  }
}
