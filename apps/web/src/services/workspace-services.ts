import {
  id,
  ConnectionAccessError,
  type Connection,
  type WorkspaceSession,
  type TioObject,
  type AssetData,
  type ConnectionAccessState,
  type WorkspaceRepository,
} from '@tio/core';
import { LocalStore, LocalCatalog } from '@tio/local-store';
import { HostSyncRunner } from '@tio/sync';
import { WorkspaceRuntime } from '@tio/workspace';

import {
  createConnectionBinding,
  type ConnectionBinding,
  type ConnectionFactory,
} from './connection-adapters';
export class WorkspaceServices {
  constructor(private factory: ConnectionFactory = createConnectionBinding) {}
  private binding?: ConnectionBinding;
  private generation = 0;
  private syncStarted = false;
  private unsubscribeAccess?: () => void;
  private authorization?: Promise<void>;
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
  get supportsSync() {
    return this.binding?.adapter.supportsSync ?? false;
  }
  get canReauthorize() {
    return !!this.binding?.adapter.reauthorize;
  }
  private setAccess(state: ConnectionAccessState) {
    if (state.scope.connectionId !== this.connection?.id) return;
    if (this.accessStates.get(state.scope.workspaceId ?? '')?.code === state.code) return;
    this.accessStates.set(state.scope.workspaceId ?? '', state);
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
    }
  >();
  private active?: { session: WorkspaceSession; runtime: WorkspaceRuntime };
  private queue: Promise<void> = Promise.resolve();
  private status = () => {};
  private polling = false;
  private timer?: ReturnType<typeof setInterval>;
  private startPolling() {
    if (this.timer) return;
    this.timer = setInterval(() => {
      if (this.polling || !this.active || document.visibilityState !== 'visible') return;
      this.polling = true;
      void this.checkAccess(this.active.session.workspaceId)
        .then((allowed) => {
          if (allowed) return this.active?.runtime.poll();
        })
        .catch((error) => {
          if (this.binding) this.setAccess(this.binding.adapter.classifyError(error));
        })
        .finally(() => {
          this.polling = false;
        });
    }, 5000);
  }
  async initialize() {
    const saved = await this.catalog.setting('connection');
    if (saved) {
      this.connection = saved.connection;
      this.handle = saved.handle;
      this.bind();
    }
  }
  async connect(kind: Connection['kind'], handle?: FileSystemDirectoryHandle) {
    await this.disconnect();
    const previous = await this.catalog.setting('folderIdentity');
    const same = handle && previous?.handle && (await handle.isSameEntry(previous.handle));
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
  async refreshRemote() {
    const generation = this.generation,
      binding = this.binding;
    if (!this.syncStarted) {
      this.syncStarted = true;
      for (const entry of this.repositories.values()) entry.runner?.start();
    }
    if (!binding || !binding.adapter.supportsSync || !(await this.checkAccess())) return;
    let discovered: TioObject[];
    try {
      discovered = await binding.discover();
    } catch (error) {
      if (generation === this.generation) this.setAccess(binding.adapter.classifyError(error));
      return;
    }
    if (generation !== this.generation) return;
    const saved = await this.sessions();
    for (const workspace of discovered) {
      if (saved.some((s) => s.workspaceId === workspace.id)) continue;
      const session = {
        id: this.connection!.id + '_' + workspace.id,
        workspaceId: workspace.id,
        connectionId: this.connection!.id,
        name: workspace.name ?? '',
      };
      await this.catalog.saveSession(session);
      // Discovery updates the catalog only. The provider remains authoritative.
      if (!binding.repository) {
        const { repository } = this.repository(session);
        if (repository instanceof LocalStore) await repository.put(workspace);
      }
    }
    this.onChange();
  }
  setting(key: string, ...value: [unknown?]) {
    return value.length ? this.catalog.setting(key, value[0]) : this.catalog.setting(key);
  }
  saveSession(session: WorkspaceSession) {
    return this.catalog.saveSession(session);
  }
  private repository(session: WorkspaceSession) {
    let entry = this.repositories.get(session.id);
    if (!entry) {
      const repository =
        this.binding?.repository?.(session.workspaceId, session.id) ?? new LocalStore(session.id);
      entry = { repository };
      this.repositories.set(session.id, entry);
      const content = this.binding?.adapter.supportsSync
        ? this.binding.content(session.workspaceId)
        : undefined;
      if (
        content &&
        this.connection &&
        !this.binding?.repository &&
        repository instanceof LocalStore
      ) {
        const runner = new HostSyncRunner(
          repository,
          content,
          this.connection.id,
          session.workspaceId,
          {
            beforeSync: async () => {
              const allowed = await this.checkAccess(session.workspaceId);
              const access = this.accessFor(session.workspaceId);
              if (!allowed && access?.code === 'unreachable')
                throw new ConnectionAccessError(access);
              return allowed;
            },
            onError: (error) => {
              if (this.binding) this.setAccess(this.binding.adapter.classifyError(error));
            },
            isActive: () => document.visibilityState === 'visible',
            onActive: (listener) => {
              document.addEventListener('visibilitychange', listener);
              return () => document.removeEventListener('visibilitychange', listener);
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
        runner.onStatus = () => this.status();
        entry.unsubscribe = repository.subscribeChanges((event) => {
          if (event.origin !== 'sync') runner.schedule();
        });
        if (this.syncStarted) runner.start();
      }
    }
    return entry;
  }
  async create(objects: TioObject[], assets = new Map<string, AssetData>()) {
    if (!this.connection) await this.connect('device');
    const workspace = objects.find((o) => o.type === 'workspace')!;
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
    const { repository } = this.repository(session);
    const runtime = await WorkspaceRuntime.open(repository);
    runtime.create(objects, undefined, assets);
    await runtime.flush();
    runtime.dispose();
    await this.catalog.saveSession(session);
    return session;
  }
  open(session: WorkspaceSession) {
    return this.transition(async () => {
      await this.active?.runtime.flush();
      const entry = this.repository(session);
      if (
        entry.repository.storageCapabilities?.offline === false &&
        !(await this.checkAccess(session.workspaceId))
      )
        throw new ConnectionAccessError(this.accessFor(session.workspaceId)!);
      const runtime = await WorkspaceRuntime.open(entry.repository, undefined, undefined, {
        targetId: session.selectedId,
      });
      try {
        await this.closeActive();
      } catch (error) {
        runtime.dispose();
        throw error;
      }
      this.active = { session, runtime };
      this.startPolling();
      return runtime;
    });
  }
  startSync(onStatus: (status: string) => void) {
    this.status = () =>
      onStatus(
        this.access && this.access.code !== 'available'
          ? this.access.code
          : (this.runner?.status ?? 'idle'),
      );
    this.status();
  }
  private get runner() {
    return this.active && this.repositories.get(this.active.session.id)?.runner;
  }
  get issues() {
    return this.runner?.issues ?? [];
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
        await this.refreshRemote();
        if (generation !== this.generation) return;
        if (this.active?.runtime.state.getState().error) await this.active.runtime.retry();
        else await this.active?.runtime.flush();
        await Promise.all(
          [...this.repositories.values()].flatMap((entry) =>
            entry.runner ? [entry.runner.sync()] : [],
          ),
        );
      })
      .finally(() => {
        if (this.authorization === work) this.authorization = undefined;
      });
    this.authorization = work;
    return work;
  }
  async sync() {
    await this.active?.runtime.flush();
    await this.refreshRemote();
    await this.runner?.sync();
    if (!this.runner && this.active) await this.active.runtime.poll();
  }
  async discard(id: string) {
    await this.active?.runtime.flush();
    await this.runner?.discard(id);
  }
  async restore(id: string) {
    await this.runner?.restore(id);
  }
  private async closeActive() {
    if (this.active) {
      await this.active.runtime.close();
      this.active = undefined;
    }
  }
  close() {
    return this.transition(() => this.closeActive());
  }
  private invalidateConnection() {
    this.generation++;
    clearInterval(this.timer);
    this.timer = undefined;
    this.unsubscribeAccess?.();
    this.unsubscribeAccess = undefined;
    this.authorization = undefined;
  }
  disconnect() {
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
      this.connection = null;
      this.binding = undefined;
      this.accessStates.clear();
      this.syncStarted = false;
      this.handle = undefined;
      await this.catalog.setting('connection', null);
    });
  }
  dispose() {
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
