import { prepareAsset } from '@tio/assets';
import {
  validate,
  fullAccess,
  assertAccess,
  resourceOf,
  type AccessPolicy,
  type AccessOperation,
  type Lifecycle,
  HostError,
  type AssetData,
  type CommitRequest,
  type Block,
  type Field,
  type TioObject,
  type WorkspaceEntry,
  type WorkspaceEvent,
  type WorkspaceRepository,
} from '@tio/core';
import { createStore } from 'zustand/vanilla';

import { executeCommand, fieldOperations, type WorkspaceCommand } from './commands';
export interface WorkspaceState {
  objects: TioObject[];
  status: 'loading' | 'saved' | 'saving' | 'error';
  pending: number;
  error: Error | null;
  canUndo: boolean;
  lifecycle: Lifecycle;
}
interface PendingCommand {
  intent: WorkspaceCommand;
  assets: ReadonlyMap<string, AssetData>;
  request?: CommitRequest;
  confirmed?: boolean;
}
export const emptyWorkspaceState: WorkspaceState = {
  objects: [],
  status: 'loading',
  pending: 0,
  error: null,
  canUndo: false,
  lifecycle: 'opening',
};
/** One editing session owns the live projection, command queue, persistence ACKs and external ingress. */
export class WorkspaceRuntime {
  private store = createStore<WorkspaceState>(() => ({ ...emptyWorkspaceState }));
  readonly state: Pick<typeof this.store, 'getState' | 'getInitialState' | 'subscribe'> =
    this.store;
  private baseline = new Map<string, WorkspaceEntry>();
  private pending: PendingCommand[] = [];
  private history: WorkspaceCommand[] = [];
  private blobs = new Map<string, AssetData>();
  private running: Promise<void> | null = null;
  private unsubscribe?: () => void;
  private disposed = false;
  private readGeneration = 0;
  private clientId = crypto.randomUUID();
  private sequence = 0;
  private version = 0;
  private constructor(
    private repository: WorkspaceRepository,
    readonly access: AccessPolicy,
  ) {}
  static async open(repository: WorkspaceRepository, access: AccessPolicy = fullAccess) {
    const runtime = new WorkspaceRuntime(repository, access);
    runtime.unsubscribe = repository.subscribeChanges((event) => runtime.ingest(event));
    try {
      await runtime.refresh(true);
      return runtime;
    } catch (error) {
      runtime.dispose();
      throw error;
    }
  }
  private events = new Map<string, WorkspaceEvent>();
  private ingest(event: WorkspaceEvent) {
    if (this.disposed || event.version <= this.version) return;
    this.events.set(event.commitId, event);
    // Serialize ingress with the active commit; no snapshot containing a pending command
    // is published until its receipt has resolved the command's identity.
    if (!this.pending.length && !this.running) void this.refresh();
  }
  private accept(entries: WorkspaceEntry[]) {
    for (const entry of entries) {
      const current = this.baseline.get(entry.object.id);
      if (!current || entry.revision > current.revision) this.baseline.set(entry.object.id, entry);
    }
  }
  private publish() {
    try {
      const objects = this.pending.reduce(
        (state, command) => (command.confirmed ? state : executeCommand(command.intent, state)),
        [...this.baseline.values()].map((e) => e.object),
      );
      this.store.setState({
        objects,
        lifecycle: this.closing ? 'closing' : this.pending.length ? 'flushing' : 'ready',
        pending: this.pending.length,
        canUndo: this.history.length > 0,
        status: this.store.getState().error ? 'error' : this.pending.length ? 'saving' : 'saved',
      });
    } catch (error) {
      this.fail(error);
    }
  }
  private fail(error: unknown) {
    this.store.setState({
      status: 'error',
      lifecycle: 'error',
      error: error instanceof Error ? error : new Error(String(error)),
      pending: this.pending.length,
    });
  }
  private async refresh(initial = false) {
    const generation = ++this.readGeneration;
    try {
      const { entries, version } = await (this.version && this.repository.readChanges
        ? this.repository.readChanges(this.version)
        : this.repository.readSnapshot());
      if (this.disposed || generation !== this.readGeneration) return;
      this.version = Math.max(this.version, version);
      for (const [id, event] of this.events)
        if (event.version <= this.version) this.events.delete(id);
      this.accept(entries);
      this.publish();
    } catch (error) {
      if (!this.disposed && generation === this.readGeneration) this.fail(error);
      if (initial) throw error;
    }
  }
  can(object: TioObject, operation: AccessOperation = 'update', fieldId?: string) {
    return this.access.allows(resourceOf(object, fieldId), operation);
  }
  private closing?: Promise<void>;
  close() {
    if (this.disposed) return Promise.resolve();
    if (this.closing) return this.closing;
    this.store.setState({ lifecycle: 'closing' });
    this.closing = this.flush()
      .then(() => {
        this.dispose();
      })
      .catch((error) => {
        this.closing = undefined;
        this.store.setState({ lifecycle: 'error' });
        throw error;
      });
    return this.closing;
  }
  private dispatch(
    intent: WorkspaceCommand,
    remember = false,
    assets: ReadonlyMap<string, AssetData> = new Map(),
  ) {
    if (this.disposed || this.closing) throw new Error('Workspace is closed');
    const before = this.store.getState().objects;
    const next = executeCommand(intent, before);
    next.forEach((o) => {
      validate(o);
      const old = before.find((p) => p.id === o.id);
      if (JSON.stringify(old) !== JSON.stringify(o)) {
        try {
          assertAccess(this.access, old, o);
        } catch {
          throw new HostError('permission');
        }
      }
    });
    if (remember)
      this.history.push({
        type: 'restore',
        before: structuredClone(before),
        after: structuredClone(next),
      });
    const command = { intent: structuredClone(intent), assets };
    this.pending.push(command);
    for (const [id, blob] of assets) this.blobs.set(id, blob);
    // Synchronous publication is the only UI write path; no component-level draft mirror.
    this.store.setState({
      objects: next,
      pending: this.pending.length,
      canUndo: this.history.length > 0,
      status: this.store.getState().error ? 'error' : 'saving',
    });
    this.drain();
  }
  private drain() {
    if (this.running || this.disposed || this.store.getState().error || !this.pending.length)
      return;
    this.running = Promise.resolve()
      .then(async () => {
        while (!this.disposed && this.pending.length && !this.store.getState().error) {
          const command = this.pending[0];
          try {
            const entries = await this.commitCommand(command);
            this.accept(entries);
            this.pending.shift();
            for (const id of command.assets.keys()) this.blobs.delete(id);
            this.publish();
            if (command.request?.sequence)
              await this.repository.acknowledgeCommits?.(this.clientId, command.request.sequence);
          } catch (error) {
            this.fail(error);
          }
        }
        if (!this.pending.length && !this.store.getState().error && !this.disposed)
          await this.refresh();
      })
      .finally(() => {
        this.running = null;
        this.drain();
      });
  }
  private async commitCommand(command: PendingCommand): Promise<WorkspaceEntry[]> {
    for (let attempt = 0; attempt < 32; attempt++) {
      if (command.request) {
        const receipt = await this.repository.getCommitResult(command.request.id);
        if (receipt?.status === 'committed') return receipt.entries;
      } else {
        const snapshot = await this.repository.readSnapshot();
        this.accept(snapshot.entries);
        const next = executeCommand(
          command.intent,
          snapshot.entries.map((e) => e.object),
        );
        const previous = new Map(
          snapshot.entries.map((e) => [e.object.id, JSON.stringify(e.object)]),
        );
        for (const [id, asset] of command.assets) await this.repository.stageAsset(id, asset);
        command.request = {
          id: crypto.randomUUID(),
          clientId: this.clientId,
          sequence: ++this.sequence,
          origin: this.clientId,
          expectedVersion: snapshot.version,
          changes: next.filter((o) => JSON.stringify(o) !== previous.get(o.id)),
          assetIds: [...command.assets.keys()],
        };
      }
      const result = await this.repository.commit(command.request);
      if (result.status === 'committed') {
        this.version = result.version;
        return result.entries;
      }
      if (result.status === 'compacted') return (await this.repository.readSnapshot()).entries;
      command.request = undefined;
    }
    throw new HostError('unavailable', 'Workspace is busy; retry the pending command');
  }
  async flush() {
    do {
      if (this.store.getState().error) throw this.store.getState().error;
      this.drain();
      await this.running;
    } while (this.pending.length && !this.store.getState().error);
    if (this.store.getState().error) throw this.store.getState().error;
  }
  async retry() {
    this.store.setState({ error: null });
    for (const command of this.pending) {
      if (!command.request) continue;
      const receipt = await this.repository.getCommitResult(command.request.id);
      if (receipt?.status === 'committed') {
        command.confirmed = true;
        this.accept(receipt.entries);
      }
    }
    // Receipt lookup precedes snapshot publication, including recovery from lost ACKs.
    await this.flush();
    await this.refresh();
  }
  patch(id: string, changes: Partial<TioObject>, remember = false) {
    this.dispatch({ type: 'patch', id, changes }, remember);
  }
  create(
    items: TioObject[],
    embed?: { pageId: string; block: Block },
    assets: ReadonlyMap<string, AssetData> = new Map(),
  ) {
    this.dispatch({ type: 'create', objects: items, embed }, true, assets);
  }
  append(id: string, block: Block) {
    this.dispatch({ type: 'append', id, block }, true);
  }
  blocks(id: string, next: Block[], previous: Block[]) {
    this.dispatch({ type: 'blocks', id, next, previous });
  }
  cell(id: string, fieldId: string, value: unknown) {
    this.dispatch({ type: 'cell', id, fieldId, value });
  }
  fields(
    id: string,
    fields: Field[],
    previous = this.snapshot().find((o) => o.id === id)?.fields ?? [],
  ) {
    this.dispatch(
      {
        type: 'fields',
        id,
        operations: fieldOperations(previous, fields),
      },
      true,
    );
  }
  move(id: string, parentId: string | null, order = Date.now()) {
    this.dispatch({ type: 'move', id, parentId, order }, true);
  }
  restoreObject(id: string) {
    this.dispatch({ type: 'undelete', id }, true);
  }
  undo() {
    const apply = this.history.pop();
    if (apply) this.dispatch(apply);
  }
  upload(workspaceId: string, file: AssetData) {
    const { metadata, assets, ref } = prepareAsset(workspaceId, file);
    this.dispatch({ type: 'create', objects: [metadata] }, false, assets);
    return ref;
  }
  async readAsset(id: string) {
    return this.blobs.get(id) ?? this.repository.readAsset(id);
  }
  snapshot() {
    return structuredClone(this.store.getState().objects);
  }
  dispose(force = false) {
    if (!force && this.pending.length)
      throw new HostError('pending', 'Flush pending changes before disposing');
    this.disposed = true;
    this.store.setState({ lifecycle: 'closed' });
    this.readGeneration++;
    this.unsubscribe?.();
    // An already-started commit may finish, but cannot enter another session's state.
  }
}

/** Shared editor-facing contract for Web composition and independent embedding. */
export type EditorSession = Pick<
  WorkspaceRuntime,
  | 'state'
  | 'access'
  | 'can'
  | 'snapshot'
  | 'patch'
  | 'create'
  | 'append'
  | 'blocks'
  | 'cell'
  | 'fields'
  | 'move'
  | 'undo'
  | 'upload'
  | 'readAsset'
  | 'flush'
  | 'retry'
  | 'close'
>;
