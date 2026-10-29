import { prepareAsset } from '@tio/assets';
import {
  createDomain,
  navigationObject,
  mentionReferences,
  type ObjectPage,
  type ObjectQuery,
  type RecordQuery,
  type SearchQuery,
  type SearchPage,
  type Domain,
  fullAccess,
  assertAccess,
  resourceOf,
  readableObject,
  type AccessPolicy,
  type AccessOperation,
  type Lifecycle,
  HostError,
  type AssetData,
  type CommitRequest,
  type CommittedMutation,
  type MutationSource,
  type AutomationProvider,
  type Block,
  type Field,
  type TioObject,
  type WorkspaceEntry,
  type WorkspaceEvent,
  type WorkspaceRepository,
} from '@tio/core';
import { convertColumn } from '@tio/database/conversion';
import { createStore } from 'zustand/vanilla';

import { executeCommand, fieldOperations, type WorkspaceCommand } from './commands';
import { projectNavigationMove } from './navigation';

type HistoryStep = Extract<WorkspaceCommand, { type: 'restore' }>;
interface HistoryEntry {
  steps: HistoryStep[];
  draft?: {
    owner: symbol;
    before: unknown;
    after: unknown;
    apply: (value: unknown) => void;
  };
  group?: string;
  time: number;
}
interface HistoryOptions {
  group?: string;
  target?: HistoryEntry[];
  entry?: HistoryEntry;
}
export interface WorkspaceState {
  objects: TioObject[];
  loads: Record<string, 'loading' | 'ready' | 'missing' | 'denied' | 'error'>;
  loadErrors: Record<string, string>;
  navigationComplete: boolean;
  writable: boolean;
  version: number;
  status: 'loading' | 'saved' | 'saving' | 'error';
  pending: number;
  error: Error | null;
  canUndo: boolean;
  canRedo: boolean;
  lifecycle: Lifecycle;
}
interface PendingCommand {
  intent: WorkspaceCommand;
  assets: ReadonlyMap<string, AssetData>;
  request?: CommitRequest;
  confirmed?: boolean;
  before?: TioObject[];
  historyEntry?: HistoryStep;
  guard?: () => void;
  complete?: () => void;
  reject?: (error: unknown) => void;
}
export const emptyWorkspaceState: WorkspaceState = {
  objects: [],
  loads: {},
  loadErrors: {},
  navigationComplete: false,
  writable: true,
  version: 0,
  status: 'loading',
  pending: 0,
  error: null,
  canUndo: false,
  canRedo: false,
  lifecycle: 'opening',
};
/** One editing session owns the live projection, command queue, persistence ACKs and external ingress. */
export class WorkspaceRuntime {
  private store = createStore<WorkspaceState>(() => ({ ...emptyWorkspaceState }));
  readonly state: Pick<typeof this.store, 'getState' | 'getInitialState' | 'subscribe'> =
    this.store;
  automation?: AutomationProvider;
  private commitListeners = new Set<(event: CommittedMutation) => void>();
  subscribeCommits(listener: (event: CommittedMutation) => void) {
    this.commitListeners.add(listener);
    return () => {
      this.commitListeners.delete(listener);
    };
  }
  async queryObjectPage(query: ObjectQuery): Promise<ObjectPage> {
    if (!this.repository.queryObjects) throw new HostError('unsupported');
    const page = await this.repository.queryObjects(query);
    return {
      ...page,
      entries: page.entries.flatMap((entry) => {
        const object = readableObject(this.access, entry.object);
        return object ? [{ ...entry, object }] : [];
      }),
    };
  }
  async queryObjects(scope: { type: string } | { databaseId: string }) {
    if (!this.repository.queryObjects) throw new HostError('unsupported');
    const objects: TioObject[] = [];
    let after: string | undefined;
    do {
      const page = await this.repository.queryObjects({ scope, after, limit: 100 });
      for (const entry of page.entries) {
        if (!this.access.allows(resourceOf(entry.object), 'read'))
          throw new HostError('permission');
        objects.push(readableObject(this.access, entry.object)!);
      }
      if (page.next && page.next === after) throw new HostError('invalid');
      after = page.next;
    } while (after);
    return objects;
  }
  hasPendingChanges(ids: string[]) {
    if ([...this.history, ...this.redos].some((entry) => entry.draft)) return true;
    return [...this.pending, ...this.waiting].some(({ intent }) => {
      if (intent.source?.kind === 'automation') return false;
      const affected =
        'id' in intent
          ? [intent.id]
          : (intent.type === 'create' || intent.type === 'import'
              ? intent.objects
              : intent.type === 'checked' || intent.type === 'convertField'
                ? intent.changes
                : intent.type === 'restore'
                  ? intent.after
                  : []
            ).map((object) => object.id);
      return affected.some((id) => ids.includes(id));
    });
  }
  /** External operations share this session's input guards and undo history. */
  externalWrite(
    expected: TioObject[],
    changes: TioObject[],
    authorize: () => void,
    expectedWorkspaceVersion?: number,
  ) {
    const ids = new Set([...expected, ...changes].map((o) => o.id));
    const guard = () => {
      authorize();
      if (this.disposed || this.closing) throw new HostError('closed');
      if (!this.store.getState().writable) throw new HostError('permission');
      if ([...this.history, ...this.redos].some((entry) => entry.draft))
        throw new HostError('conflict');
      const overlaps = (intent: WorkspaceCommand) => {
        const affected =
          'id' in intent
            ? [intent.id]
            : intent.type === 'create' || intent.type === 'import'
              ? intent.objects.map((o) => o.id)
              : intent.type === 'checked' || intent.type === 'convertField'
                ? [...intent.expected, ...intent.changes].map((o) => o.id)
                : intent.type === 'restore'
                  ? intent.after.map((o) => o.id)
                  : [];
        return affected.some((id) => ids.has(id));
      };
      if (
        this.pending.some((c) => c.guard !== guard && overlaps(c.intent)) ||
        this.waiting.some((c) => c.receipt?.guard !== guard && overlaps(c.intent))
      )
        throw new HostError('conflict');
    };
    return this.checked(expected, changes, guard, {
      source: { kind: 'ai' },
      remember: true,
      workspaceVersion: expectedWorkspaceVersion,
    });
  }
  automationWrite(
    expected: TioObject[],
    changes: TioObject[],
    source: Extract<MutationSource, { kind: 'automation' }>,
  ) {
    const guard = () => {
      if (this.disposed || this.closing) throw new HostError('closed');
      if (!this.store.getState().writable) throw new HostError('permission');
      if (this.hasPendingChanges([...expected, ...changes].map((o) => o.id)))
        throw new HostError('conflict');
    };
    return new Promise<void>((resolve, reject) => {
      try {
        guard();
        this.dispatch({ type: 'checked', expected, changes, source }, false, new Map(), {
          guard,
          complete: resolve,
          reject,
        });
      } catch (error) {
        reject(error);
      }
    });
  }
  private navigation = new Map<string, TioObject>();
  private reads = new Map<string, Promise<void>>();
  private preparing: Promise<void> | null = null;
  private preparingCount = 0;
  private waiting: {
    intent: WorkspaceCommand;
    remember: boolean;
    historyOptions?: HistoryOptions;
    assets: ReadonlyMap<string, AssetData>;
    receipt?: Pick<PendingCommand, 'guard' | 'complete' | 'reject'>;
  }[] = [];
  private retained = new Map<string, number>();
  private baseline = new Map<string, WorkspaceEntry>();
  private pending: PendingCommand[] = [];
  private history: HistoryEntry[] = [];
  private redos: HistoryEntry[] = [];
  private historyGroup?: HistoryEntry;
  private blobs = new Map<string, AssetData>();
  private running: Promise<void> | null = null;
  private retrying?: Promise<void>;
  private unsubscribe?: () => void;
  private disposed = false;
  private readGeneration = 0;
  private clientId = crypto.randomUUID();
  private sequence = 0;
  private version = 0;
  private constructor(
    private repository: WorkspaceRepository,
    readonly access: AccessPolicy,
    readonly domain: Domain,
  ) {}
  static async open(
    repository: WorkspaceRepository,
    access: AccessPolicy = fullAccess,
    domain: Domain = createDomain(),
    options: { targetId?: string } = {},
  ) {
    const runtime = new WorkspaceRuntime(repository, access, domain);
    runtime.unsubscribe = repository.subscribeChanges((event) => runtime.ingest(event));
    try {
      if (repository.queryNavigation && repository.readObjects) {
        await runtime.loadNavigation();
        const target =
          options.targetId ??
          [...runtime.navigation.values()].find(
            (o) => ['page', 'database'].includes(o.type) && !o.deleted,
          )?.id;
        if (target) await runtime.ensure([target]);
        runtime.publish();
      } else await runtime.refresh(true);
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
      this.retained.delete(entry.object.id);
      this.retained.set(entry.object.id, Date.now());
      if (['workspace', 'page', 'database', 'databaseView'].includes(entry.object.type))
        this.navigation.set(entry.object.id, navigationObject(entry.object));
    }
  }
  private commandObjects() {
    return this.pending.reduce(
      (state, command) =>
        command.confirmed ? state : executeCommand(command.intent, state, undefined, this.domain),
      [...this.baseline.values()].map((e) => e.object),
    );
  }
  private projectWaiting(objects: TioObject[]) {
    return this.waiting.reduce(
      (state, { intent }) =>
        intent.type === 'place' || intent.type === 'move'
          ? projectNavigationMove(state, intent)
          : state,
      objects,
    );
  }
  private publish() {
    try {
      const objects = this.commandObjects();
      const ids = new Set(objects.map((o) => o.id));
      this.store.setState({
        version: this.version,
        objects: this.projectWaiting([
          ...objects,
          ...[...this.navigation.values()].filter((o) => !ids.has(o.id)),
        ]),
        loads: {
          ...this.store.getState().loads,
          ...Object.fromEntries(objects.map((o) => [o.id, 'ready' as const])),
        },
        lifecycle: this.closing ? 'closing' : this.pending.length ? 'flushing' : 'ready',
        pending: this.pending.length + this.preparingCount,
        canUndo: this.history.length > 0,
        canRedo: this.redos.length > 0,
        status: this.store.getState().error
          ? 'error'
          : this.pending.length || this.preparingCount
            ? 'saving'
            : 'saved',
      });
    } catch (error) {
      this.fail(error);
    }
  }
  private fail(error: unknown) {
    if (
      this.repository.storageCapabilities?.offline === false &&
      error instanceof HostError &&
      error.code === 'permission'
    )
      this.setWritable(false);
    this.store.setState({
      status: 'error',
      lifecycle: 'error',
      error: error instanceof Error ? error : new Error(String(error)),
      pending: this.pending.length + this.preparingCount,
    });
  }
  private async refresh(initial = false) {
    const generation = ++this.readGeneration;
    try {
      const { entries, version } = await (this.repository.readChanges
        ? this.repository.readChanges(this.version)
        : this.repository.readSnapshot());
      if (this.disposed || generation !== this.readGeneration) return;
      this.version = Math.max(this.version, version);
      for (const [id, event] of this.events)
        if (event.version <= this.version) this.events.delete(id);
      if (this.repository.queryNavigation) {
        for (const entry of entries) {
          if (['workspace', 'page', 'database', 'databaseView'].includes(entry.object.type))
            this.navigation.set(entry.object.id, navigationObject(entry.object));
        }
        this.accept(entries.filter((e) => this.baseline.has(e.object.id)));
      } else this.accept(entries);
      this.publish();
    } catch (error) {
      if (!this.disposed && generation === this.readGeneration) this.fail(error);
      if (initial) throw error;
    }
  }
  private async loadNavigation() {
    let after: string | undefined;
    let initialVersion: number | undefined;
    do {
      const page = await this.repository.queryNavigation!({ after, limit: 250 });
      if (this.disposed) return;
      initialVersion ??= page.version;
      for (const object of page.items) this.navigation.set(object.id, object);
      if (page.next && page.next === after)
        throw new HostError('invalid', 'Navigation cursor did not advance');
      if (!page.complete && !page.next)
        throw new HostError('unavailable', 'Navigation is incomplete');
      after = page.next;
      this.publish();
    } while (after);
    this.version = initialVersion ?? 0;
    this.store.setState({ navigationComplete: true });
  }
  /** Loading a body never advances the workspace change cursor. */
  async ensure(ids: string[], force = false): Promise<void> {
    if (this.disposed) throw new HostError('closed');
    await Promise.all(
      [...new Set(ids.filter(Boolean))].map((id) => {
        if (this.reads.has(id)) return this.reads.get(id)!;
        if (!force && this.baseline.has(id)) return Promise.resolve();
        this.store.setState({ loads: { ...this.store.getState().loads, [id]: 'loading' } });
        const work = (async () => {
          try {
            const page = this.repository.readObjects
              ? await this.repository.readObjects([id])
              : await this.repository.readSnapshot();
            if (this.disposed) return;
            const entry = page.entries.find((e) => e.object.id === id);
            if (entry) this.accept([entry]);
            else this.baseline.delete(id);
            this.store.setState({
              loads: {
                ...this.store.getState().loads,
                [id]: entry ? 'ready' : page.denied?.includes(id) ? 'denied' : 'missing',
              },
            });
            this.publish();
          } catch (error) {
            if (!this.disposed)
              this.store.setState({
                loads: {
                  ...this.store.getState().loads,
                  [id]:
                    error instanceof HostError && error.code === 'permission' ? 'denied' : 'error',
                },
                loadErrors: { ...this.store.getState().loadErrors, [id]: String(error) },
              });
            throw error;
          } finally {
            this.reads.delete(id);
          }
        })();
        this.reads.set(id, work);
        return work;
      }),
    );
  }
  /** Pin visible content; only clean, unpinned bodies are eligible for eviction. */
  private pins = new Map<string, number>();
  retain(ids: string[]) {
    ids.forEach((id) => this.pins.set(id, (this.pins.get(id) ?? 0) + 1));
    return () => {
      ids.forEach((id) => {
        const count = (this.pins.get(id) ?? 1) - 1;
        if (count) this.pins.set(id, count);
        else this.pins.delete(id);
      });
      this.evict();
    };
  }
  private evict() {
    if (this.pending.length || this.preparing) return;
    for (const id of this.retained.keys()) {
      if (this.baseline.size <= 256) break;
      if (this.pins.has(id)) continue;
      this.baseline.delete(id);
      this.retained.delete(id);
      const loads = { ...this.store.getState().loads };
      delete loads[id];
      this.store.setState({ loads });
    }
    this.publish();
  }
  async mentionCandidates(
    text: string,
    after?: string,
    kind?: import('@tio/core').MentionQuery['kind'],
  ) {
    if (this.disposed) throw new HostError('closed');
    if (!this.repository.queryMentions) throw new HostError('unsupported');
    return this.repository.queryMentions({ text, after, kind, limit: 50 });
  }
  async mentionMetadata(ids: string[]) {
    if (this.disposed) throw new HostError('closed');
    if (!this.repository.readMetadata) throw new HostError('unsupported');
    return this.repository.readMetadata(ids);
  }
  async loadTarget(id: string) {
    await this.ensure([id]);
    const object = this.baseline.get(id)?.object;
    if (object?.databaseId) await this.ensure([object.databaseId]);
    if (object) await this.loadValues([object]);
  }
  private async loadValues(objects: TioObject[], seen = new Set<string>()) {
    for (const object of objects) {
      if (seen.has(object.id)) continue;
      seen.add(object.id);
      if (!object.databaseId) continue;
      await this.ensure([object.databaseId]);
      const db = this.baseline.get(object.databaseId)?.object;
      const ids: string[] = [];
      for (const field of db?.fields ?? []) {
        const value = object.properties?.[field.id];
        const values = Array.isArray(value) ? value : value ? [value] : [];
        if (field.type === 'relation')
          ids.push(...values.filter((v): v is string => typeof v === 'string'));
        if (field.type === 'files')
          ids.push(
            ...values
              .filter((v): v is string => typeof v === 'string' && v.startsWith('asset:'))
              .map((v) => v.slice(6)),
          );
      }
      await this.ensure(ids.filter((id) => !seen.has(id)));
      await this.loadValues(
        ids.flatMap((id) => (this.baseline.has(id) ? [this.baseline.get(id)!.object] : [])),
        seen,
      );
    }
  }
  async records(query: RecordQuery): Promise<ObjectPage> {
    if (!this.repository.queryRecords)
      throw new HostError('unsupported', 'Record queries unavailable');
    const page = await this.repository.queryRecords(query);
    if (this.disposed) throw new HostError('closed');
    this.accept(page.entries);
    await this.loadValues(page.entries.map((e) => e.object));
    this.publish();
    return page;
  }
  /** Read a complete database at one provider version, independently of the visible view. */
  async databaseSnapshot(databaseId: string) {
    await this.flush();
    await this.ensure([databaseId]);
    for (let attempt = 0; attempt < 3; attempt++) {
      const records: TioObject[] = [];
      let after: string | undefined, version: number | undefined;
      let consistent = true;
      do {
        const page = await this.records({ databaseId, limit: 1000, after });
        version ??= page.version;
        if (page.version !== version) {
          consistent = false;
          break;
        }
        records.push(...page.entries.map((entry) => entry.object));
        if (page.next && page.next === after) throw new HostError('invalid');
        after = page.next;
      } while (after);
      await this.refresh();
      if (!consistent || this.version !== version) continue;
      const database = this.snapshot().find((o) => o.id === databaseId && !o.deleted);
      if (!database || !this.can(database, 'read')) throw new HostError('unavailable');
      if (records.some((o) => !this.can(o, 'read'))) throw new HostError('permission');
      const objects = new Map(this.snapshot().map((o) => [o.id, o]));
      for (const record of records) objects.set(record.id, record);
      const mentions = new Set<string>();
      for (const record of records)
        for (const field of database.fields ?? []) {
          const value = record.properties?.[field.id];
          if (field.type === 'mention')
            for (const ref of mentionReferences(value))
              if (
                ref.kind !== 'github-user' &&
                ref.workspaceId === database.workspaceId &&
                !objects.has(ref.id)
              )
                mentions.add(ref.id);
        }
      const ids = [...mentions];
      for (let offset = 0; offset < ids.length; offset += 1000) {
        const metadata = await this.mentionMetadata(ids.slice(offset, offset + 1000));
        if (metadata.version !== version) {
          consistent = false;
          break;
        }
        for (const entry of metadata.entries)
          if (!metadata.denied?.includes(entry.object.id) && this.can(entry.object, 'read'))
            objects.set(entry.object.id, entry.object);
        const parents = [
          ...new Set(
            metadata.entries.flatMap((e) =>
              e.object.type === 'record' && e.object.databaseId && !objects.has(e.object.databaseId)
                ? [e.object.databaseId]
                : [],
            ),
          ),
        ];
        if (parents.length) {
          const parentMetadata = await this.mentionMetadata(parents);
          if (parentMetadata.version !== version) {
            consistent = false;
            break;
          }
          for (const entry of parentMetadata.entries)
            if (this.can(entry.object, 'read')) objects.set(entry.object.id, entry.object);
        }
      }
      if (!consistent || this.version !== version) continue;
      return {
        database,
        records: structuredClone(records),
        objects: structuredClone([...objects.values()]),
        version,
      };
    }
    throw new HostError('conflict');
  }
  async convertField(databaseId: string, target: Field) {
    const { database, records, objects, version } = await this.databaseSnapshot(databaseId);
    const source = database.fields?.find((f) => f.id === target.id);
    if (!source) throw new HostError('unavailable');
    const result = convertColumn(database, source, target, objects);
    const guard = () => {
      if (this.version !== version) throw new HostError('conflict');
    };
    await new Promise<void>((resolve, reject) => {
      try {
        guard();
        this.dispatch(
          { type: 'convertField', expected: [database, ...records], changes: result.changes },
          true,
          new Map(),
          { guard, complete: resolve, reject },
        );
      } catch (error) {
        reject(error);
      }
    });
    return result.cleared;
  }
  async loadDatabase(id: string) {
    await this.ensure([id]);
    if (this.repository.queryObjects) {
      let after: string | undefined;
      do {
        const page = await this.repository.queryObjects({
          scope: { type: 'databaseView' },
          limit: 250,
          after,
        });
        if (this.disposed) return;
        this.accept(page.entries.filter((e) => e.object.databaseId === id));
        after = page.next;
      } while (after);
      this.publish();
    }
  }
  async search(query: SearchQuery): Promise<SearchPage> {
    if (!this.repository.search) throw new HostError('unsupported', 'Search unavailable');
    return this.repository.search(query);
  }
  async exportObjects(): Promise<TioObject[]> {
    await this.flush();
    if (!this.repository.scan)
      return (await this.repository.readSnapshot()).entries.map((e) => e.object);
    for (let attempt = 0; attempt < 3; attempt++) {
      const objects: TioObject[] = [];
      let after: string | undefined, version: number | undefined;
      let consistent = true;
      do {
        const page = await this.repository.scan({ after, limit: 250 });
        version ??= page.version;
        if (page.version !== version) {
          consistent = false;
          break;
        }
        objects.push(...page.entries.map((e) => e.object));
        if (page.next && page.next === after)
          throw new HostError('invalid', 'Scan cursor did not advance');
        after = page.next;
      } while (after);
      if (consistent) return objects;
    }
    throw new HostError('conflict', 'Workspace changed during export; retry');
  }
  private dependencies(intent: WorkspaceCommand) {
    const ids: string[] = [];
    if ('id' in intent) ids.push(intent.id);
    if ((intent.type === 'move' || intent.type === 'place') && intent.parentId)
      ids.push(intent.parentId);
    if (intent.type === 'create' || intent.type === 'import') {
      if ('embed' in intent && intent.embed) ids.push(intent.embed.pageId);
      if (intent.type === 'create') {
        for (const object of intent.objects) {
          if (object.parentId && !intent.objects.some((o) => o.id === object.parentId))
            ids.push(object.parentId);
          if (['page', 'database'].includes(object.type) && object.order === undefined)
            ids.push(
              ...this.snapshot()
                .filter(
                  (o) =>
                    !o.deleted &&
                    o.workspaceId === object.workspaceId &&
                    ['page', 'database'].includes(o.type) &&
                    (o.parentId ?? null) === (object.parentId ?? null),
                )
                .map((o) => o.id),
            );
        }
      }
      for (const object of intent.objects)
        if (object.databaseId && !intent.objects.some((o) => o.id === object.databaseId))
          ids.push(object.databaseId);
    }
    if (intent.type === 'checked' || intent.type === 'convertField')
      ids.push(...intent.expected.map((o) => o.id));
    if (intent.type === 'restore') ids.push(...intent.after.map((o) => o.id));
    if (intent.type === 'place') {
      const source = this.snapshot().find((o) => o.id === intent.id);
      ids.push(
        ...this.snapshot()
          .filter(
            (o) =>
              !o.deleted &&
              o.workspaceId === source?.workspaceId &&
              ['page', 'database'].includes(o.type) &&
              (o.parentId ?? null) === intent.parentId,
          )
          .map((o) => o.id),
      );
      if (intent.beforeId) ids.push(intent.beforeId);
    }
    if (intent.type === 'move' || intent.type === 'place') {
      let parent = intent.parentId;
      const seen = new Set<string>();
      while (parent && !seen.has(parent)) {
        seen.add(parent);
        ids.push(parent);
        parent =
          (this.baseline.get(parent)?.object ?? this.navigation.get(parent))?.parentId ?? null;
      }
    }
    for (const id of [...ids]) {
      const object = this.baseline.get(id)?.object ?? this.navigation.get(id);
      if (object?.databaseId) ids.push(object.databaseId);
    }
    return [...new Set(ids)].filter(
      (id) =>
        !this.store
          .getState()
          .objects.some(
            (o) =>
              o.id === id &&
              this.pending.some(
                (p) =>
                  (p.intent.type === 'create' || p.intent.type === 'import') &&
                  p.intent.objects.some((o) => o.id === id),
              ),
          ),
    );
  }
  setWritable(writable: boolean) {
    this.store.setState({ writable });
  }
  can(object: TioObject, operation: AccessOperation = 'update', fieldId?: string) {
    return (
      (operation === 'read' || this.store.getState().writable) &&
      this.access.allows(resourceOf(object, fieldId), operation)
    );
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
    receipt?: Pick<PendingCommand, 'guard' | 'complete' | 'reject'>,
    prepared = false,
    historyOptions?: HistoryOptions,
  ) {
    if (this.disposed || (this.closing && !prepared)) throw new Error('Workspace is closed');
    if (!prepared && !this.store.getState().writable) throw new HostError('permission');
    intent = { ...intent, timestamp: intent.timestamp ?? new Date().toISOString() };
    const dependencies = this.dependencies(intent);
    if (!prepared && (this.preparing || dependencies.some((id) => !this.baseline.has(id)))) {
      if (intent.type === 'place' || intent.type === 'move') {
        const before = this.snapshot();
        const projected = projectNavigationMove(before, intent);
        for (const object of projected) {
          const old = before.find((o) => o.id === object.id)!;
          if (old.parentId !== object.parentId || old.order !== object.order)
            assertAccess(this.access, old, object);
        }
      }
      this.waiting.push({
        intent: structuredClone(intent),
        remember,
        assets,
        receipt,
        historyOptions,
      });
      this.preparingCount = this.waiting.length;
      this.publish();
      this.prepareWaiting();
      return;
    }

    const before = this.commandObjects();
    if (historyOptions?.entry) {
      // Build the inverse only after required bodies have been loaded.
      const restored = [...historyOptions.entry.steps]
        .reverse()
        .reduce((state, step) => executeCommand(step, state, undefined, this.domain), before);
      const changed = restored.filter(
        (o) => JSON.stringify(o) !== JSON.stringify(before.find((old) => old.id === o.id)),
      );
      intent = {
        ...intent,
        type: 'restore',
        before: changed,
        after: before.filter((o) => changed.some((change) => change.id === o.id)),
      };
    }
    const next = executeCommand(intent, before, undefined, this.domain);
    const originals = new Map(before.map((o) => [o.id, o]));
    const changed = next.filter((o) => JSON.stringify(o) !== JSON.stringify(originals.get(o.id)));
    if (!changed.length) {
      this.store.setState({ canUndo: this.history.length > 0, canRedo: this.redos.length > 0 });
      receipt?.complete?.();
      return;
    }
    for (const o of changed) {
      this.domain.objects.decode(o);
      try {
        assertAccess(this.access, originals.get(o.id), o);
      } catch {
        throw new HostError('permission');
      }
    }
    let historyEntry: HistoryStep | undefined;
    if (remember || historyOptions?.target) {
      historyEntry = {
        type: 'restore',
        before: structuredClone(
          changed.flatMap((o) => (originals.has(o.id) ? [originals.get(o.id)!] : [])),
        ),
        after: structuredClone(changed),
      };
      const target = historyOptions?.target ?? this.history;
      const time = Date.now();
      const group = historyOptions?.group;
      if (remember) this.redos = [];
      if (
        group &&
        this.historyGroup === target.at(-1) &&
        this.historyGroup?.group === group &&
        time - this.historyGroup.time < 500
      ) {
        this.historyGroup.steps.push(historyEntry);
        this.historyGroup.time = time;
      } else {
        const entry = { steps: [historyEntry], group, time };
        target.push(entry);
        this.historyGroup = group ? entry : undefined;
      }
      while (
        target.length > 100 ||
        new TextEncoder().encode(JSON.stringify(target)).length > 8 * 1024 * 1024
      )
        target.shift();
    }
    const command = { intent: structuredClone(intent), assets, historyEntry, ...receipt };
    this.pending.push(command);
    for (const [id, blob] of assets) this.blobs.set(id, blob);
    // Include navigation intents still loading dependencies in every publication.
    this.publish();
    this.drain();
  }
  private prepareWaiting() {
    if (this.preparing || this.store.getState().error || !this.waiting.length) return;
    this.preparing = Promise.resolve()
      .then(async () => {
        while (this.waiting.length && !this.disposed) {
          const command = this.waiting[0];
          try {
            for (const id of this.dependencies(command.intent)) await this.loadTarget(id);
            for (const id of this.dependencies(command.intent))
              if (!this.baseline.has(id))
                throw new HostError('unavailable', `Command dependency unavailable: ${id}`);
            this.dispatch(
              command.intent,
              command.remember,
              command.assets,
              command.receipt,
              true,
              command.historyOptions,
            );
            this.waiting.shift();
            this.preparingCount = this.waiting.length;
          } catch (error) {
            if (command.intent.source?.kind === 'ai') {
              this.waiting.shift();
              this.preparingCount = this.waiting.length;
              command.receipt?.reject?.(error);
              continue;
            }
            this.fail(error);
            break;
          }
        }
      })
      .finally(() => {
        this.preparing = null;
        this.publish();
      });
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
            command.complete?.();
            if (command.request && command.request.changes.length) {
              const event: CommittedMutation = {
                commitId: command.request.id,
                source: command.request.source!,
                timestamp: command.intent.timestamp!,
                changes: command.request.changes.flatMap((after) => {
                  const committed = readableObject(
                    this.access,
                    entries.find((entry) => entry.object.id === after.id)?.object ?? after,
                  );
                  if (!committed) return [];
                  const before = command.before?.find((o) => o.id === after.id);
                  return [
                    {
                      before: before ? readableObject(this.access, before) : undefined,
                      after: committed,
                    },
                  ];
                }),
              };
              for (const listener of this.commitListeners) {
                // Observers cannot turn a successful durable commit into an editing failure.
                try {
                  listener(structuredClone(event));
                } catch {
                  /* isolated observer */
                }
              }
            }
            for (const id of command.assets.keys()) this.blobs.delete(id);
            this.publish();
            if (command.request?.sequence)
              await this.repository.acknowledgeCommits?.(this.clientId, command.request.sequence);
          } catch (error) {
            const rejectedBackground =
              ['automation', 'ai'].includes(command.intent.source?.kind ?? '') &&
              error instanceof HostError &&
              [
                'permission',
                'invalid',
                'unsupported',
                'closed',
                ...(command.intent.source?.kind === 'ai' ? ['conflict'] : []),
              ].includes(error.code);
            if (
              (['checked', 'convertField'].includes(command.intent.type) && !command.request) ||
              rejectedBackground
            ) {
              this.pending.shift();
              if (command.historyEntry) this.removeHistoryStep(command.historyEntry);
              command.reject?.(error);
              this.publish();
              continue;
            }
            if (command.intent.source?.kind === 'automation') command.reject?.(error);
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
  private removeHistoryStep(step: HistoryStep) {
    for (const stack of [this.history, this.redos]) {
      for (const entry of stack) entry.steps = entry.steps.filter((item) => item !== step);
      for (let i = stack.length - 1; i >= 0; i--)
        if (!stack[i].steps.length && !stack[i].draft) stack.splice(i, 1);
    }
  }
  private async commitCommand(command: PendingCommand): Promise<WorkspaceEntry[]> {
    for (let attempt = 0; attempt < 32; attempt++) {
      if (command.request) {
        const receipt = await this.repository.getCommitResult(command.request.id);
        if (receipt?.status === 'committed') return receipt.entries;
      } else {
        command.guard?.();
        const snapshot = await (this.repository.readChanges
          ? this.repository.readChanges(this.version)
          : this.repository.readSnapshot());
        for (const entry of snapshot.entries)
          if (['workspace', 'page', 'database', 'databaseView'].includes(entry.object.type))
            this.navigation.set(entry.object.id, navigationObject(entry.object));
        this.accept(
          snapshot.entries.filter(
            (e) =>
              this.baseline.has(e.object.id) ||
              this.dependencies(command.intent).includes(e.object.id),
          ),
        );
        this.version = snapshot.version;
        if (
          command.intent.workspaceVersion !== undefined &&
          command.intent.workspaceVersion !== snapshot.version
        )
          throw new HostError('conflict');
        command.guard?.();
        const confirmed = [...this.baseline.values()].map((entry) => entry.object);
        const recovery: unknown[] = [];
        const next = executeCommand(
          command.intent,
          confirmed,
          (result) => {
            if (result.recovered.length)
              recovery.push({
                objectId: 'id' in command.intent ? command.intent.id : undefined,
                warnings: result.warnings,
                values: result.recovered,
              });
          },
          this.domain,
        );
        const previous = new Map(confirmed.map((object) => [object.id, object]));
        if (command.historyEntry?.type === 'restore') {
          const changed = next.filter(
            (o) => JSON.stringify(o) !== JSON.stringify(previous.get(o.id)),
          );
          command.historyEntry.before = structuredClone(
            changed.flatMap((o) => (previous.has(o.id) ? [previous.get(o.id)!] : [])),
          );
          command.historyEntry.after = structuredClone(changed);
          if (!changed.length) this.removeHistoryStep(command.historyEntry);
        }
        for (const [id, asset] of command.assets) await this.repository.stageAsset(id, asset);
        command.request = {
          id: crypto.randomUUID(),
          clientId: this.clientId,
          sequence: ++this.sequence,
          origin: this.clientId,
          source: command.intent.source ?? {
            kind: command.intent.type === 'import' ? 'import' : 'editor',
          },
          expectedVersion: snapshot.version,
          recovery,
          changes: next.filter(
            (o) =>
              o !== previous.get(o.id) && JSON.stringify(o) !== JSON.stringify(previous.get(o.id)),
          ),
          assetIds: [...command.assets.keys()],
        };
        command.before = structuredClone(
          confirmed.filter((object) =>
            command.request!.changes.some((change) => change.id === object.id),
          ),
        );
      }
      if (command.intent.source?.kind === 'ai') command.guard?.();
      const result = await this.repository.commit(command.request);
      if (result.status === 'committed') {
        // Consume change events separately: a recovered receipt may carry a newer workspace version.
        return result.entries;
      }
      if (result.status === 'compacted')
        return (
          await (this.repository.readObjects
            ? this.repository.readObjects(command.request.changes.map((o) => o.id))
            : this.repository.readSnapshot())
        ).entries;
      command.request = undefined;
    }
    throw new HostError('unavailable', 'Workspace is busy; retry the pending command');
  }
  async flush() {
    this.prepareWaiting();
    while (this.preparing) await this.preparing;
    do {
      if (this.store.getState().error) throw this.store.getState().error;
      this.drain();
      await this.running;
    } while (this.pending.length && !this.store.getState().error);
    if (this.store.getState().error) throw this.store.getState().error;
  }
  async poll() {
    if (!this.pending.length && !this.running && !this.preparing) await this.refresh();
  }
  retry(): Promise<void> {
    if (this.retrying) return this.retrying;
    this.retrying = this.recover().finally(() => {
      this.retrying = undefined;
    });
    return this.retrying;
  }
  private async recover() {
    try {
      this.store.setState({ error: null });
      this.prepareWaiting();
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
    } catch (error) {
      this.fail(error);
      throw error;
    }
  }

  /** Checked command acknowledged using the provider's declared persistence guarantee. */
  checked(
    expected: TioObject[],
    changes: TioObject[],
    guard: () => void,
    options: { source?: MutationSource; remember?: boolean; workspaceVersion?: number } = {},
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      try {
        guard();
        this.dispatch(
          {
            type: 'checked',
            expected,
            changes,
            source: options.source,
            workspaceVersion: options.workspaceVersion,
          },
          options.remember ?? true,
          new Map(),
          {
            guard,
            complete: resolve,
            reject,
          },
        );
      } catch (error) {
        reject(error);
      }
    });
  }
  patch(id: string, changes: Partial<TioObject>, remember = true) {
    const keys = Object.keys(changes);
    const group =
      keys.length === 1 && ['title', 'name'].includes(keys[0])
        ? `patch:${id}:${keys[0]}`
        : undefined;
    this.dispatch({ type: 'patch', id, changes }, remember, new Map(), undefined, false, { group });
  }
  create(
    items: TioObject[],
    embed?: { pageId: string; block: Block },
    assets: ReadonlyMap<string, AssetData> = new Map(),
  ) {
    this.dispatch({ type: 'create', objects: items, embed }, true, assets);
  }
  import(items: TioObject[], assets: ReadonlyMap<string, AssetData> = new Map()) {
    this.dispatch({ type: 'import', objects: items }, true, assets);
  }
  append(id: string, block: Block) {
    this.dispatch({ type: 'append', id, block }, true);
  }
  blocks(id: string, next: Block[], previous: Block[], inputGroup?: string | null) {
    const changed = next.filter(
      (block, i) => JSON.stringify(block) !== JSON.stringify(previous[i]),
    );
    const inserted = next.filter((block) => !previous.some((old) => old.id === block.id));
    const inputBlock =
      next.length === previous.length &&
      changed.length === 1 &&
      previous.some(
        (block) =>
          block.id === changed[0].id &&
          block.type === changed[0].type &&
          JSON.stringify(block.props) === JSON.stringify(changed[0].props) &&
          JSON.stringify(block.children) === JSON.stringify(changed[0].children),
      )
        ? changed[0]
        : next.length === previous.length + 1 &&
            inserted.length === 1 &&
            inserted[0].type === 'paragraph' &&
            !inserted[0].children.length
          ? inserted[0]
          : undefined;
    const group =
      inputGroup === null
        ? undefined
        : inputGroup || inputBlock
          ? `blocks:${id}:${inputGroup ?? inputBlock!.id}`
          : undefined;
    this.dispatch({ type: 'blocks', id, next, previous }, true, new Map(), undefined, false, {
      group,
    });
  }
  cell(id: string, fieldId: string, value: unknown) {
    this.dispatch({ type: 'cell', id, fieldId, value }, true);
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
  place(id: string, parentId: string | null, beforeId: string | null) {
    this.dispatch({ type: 'place', id, parentId, beforeId }, true);
  }
  move(id: string, parentId: string | null, order = Date.now()) {
    this.dispatch({ type: 'move', id, parentId, order }, true);
  }
  restoreObject(id: string) {
    this.dispatch({ type: 'undelete', id }, true);
  }
  breakHistoryGroup() {
    this.historyGroup = undefined;
  }
  /** Temporary editor drafts participate in ordering, never in persistence. */
  recordDraft<T>(owner: symbol, before: T, after: T, apply: (value: T) => void) {
    if (this.disposed || this.closing) throw new HostError('closed');
    if (!this.store.getState().writable) throw new HostError('permission');
    if (JSON.stringify(before) === JSON.stringify(after)) return;
    const time = Date.now();
    const previous = this.history.at(-1);
    if (
      previous === this.historyGroup &&
      previous?.draft?.owner === owner &&
      time - previous.time < 500
    ) {
      previous.draft.after = structuredClone(after);
      previous.time = time;
    } else {
      const entry: HistoryEntry = {
        steps: [],
        time,
        draft: {
          owner,
          before: structuredClone(before),
          after: structuredClone(after),
          apply: (value) => apply(value as T),
        },
      };
      this.history.push(entry);
      this.historyGroup = entry;
    }
    this.redos = [];
    while (
      this.history.length > 100 ||
      new TextEncoder().encode(JSON.stringify(this.history)).length > 8 * 1024 * 1024
    )
      this.history.shift();
    this.store.setState({ canUndo: this.history.length > 0, canRedo: false });
  }
  discardDraft(owner: symbol) {
    if (![...this.history, ...this.redos].some((entry) => entry.draft?.owner === owner)) return;
    this.history = this.history.filter((entry) => entry.draft?.owner !== owner);
    this.redos = this.redos.filter((entry) => entry.draft?.owner !== owner);
    this.breakHistoryGroup();
    this.store.setState({ canUndo: this.history.length > 0, canRedo: this.redos.length > 0 });
  }
  private travelHistory(source: HistoryEntry[], target: HistoryEntry[]) {
    if (this.disposed || this.closing) throw new HostError('closed');
    if (!this.store.getState().writable) throw new HostError('permission');
    this.breakHistoryGroup();
    const entry = source.at(-1);
    if (!entry) return;
    if (entry.draft) {
      entry.draft.apply(
        structuredClone(source === this.history ? entry.draft.before : entry.draft.after),
      );
      source.pop();
      target.push(entry);
      this.store.setState({ canUndo: this.history.length > 0, canRedo: this.redos.length > 0 });
      return;
    }
    source.pop();
    try {
      this.dispatch(
        {
          type: 'restore',
          source: { kind: source === this.history ? 'undo' : 'redo' },
          before: [],
          after: entry.steps.flatMap((step) => step.after),
        },
        false,
        new Map(),
        undefined,
        false,
        { target, entry },
      );
    } catch (error) {
      source.push(entry);
      throw error;
    }
  }
  undo() {
    this.travelHistory(this.history, this.redos);
  }
  redo() {
    this.travelHistory(this.redos, this.history);
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
  /** Discard queued input and wait only for work that has already started. */
  async discardAndClose() {
    this.dispose(true);
    await Promise.allSettled([this.preparing, this.running, this.retrying]);
  }
  dispose(force = false) {
    if (!force && (this.pending.length || this.preparingCount))
      throw new HostError('pending', 'Flush pending changes before disposing');
    this.disposed = true;
    this.automation?.dispose();
    for (const command of this.pending) {
      if (['automation', 'ai'].includes(command.intent.source?.kind ?? ''))
        command.reject?.(new HostError('closed'));
    }
    for (const command of this.waiting) {
      if (['automation', 'ai'].includes(command.intent.source?.kind ?? ''))
        command.receipt?.reject?.(new HostError('closed'));
    }
    this.commitListeners.clear();
    this.history = [];
    this.redos = [];
    this.breakHistoryGroup();
    this.store.setState({ lifecycle: 'closed', canUndo: false, canRedo: false });
    this.readGeneration++;
    this.unsubscribe?.();
    // An already-started commit may finish, but cannot enter another session's state.
  }
}

/** Shared editor-facing contract for Web composition and independent embedding. */
export type EditorSession = Pick<
  WorkspaceRuntime,
  | 'mentionCandidates'
  | 'mentionMetadata'
  | 'ensure'
  | 'retain'
  | 'loadTarget'
  | 'loadDatabase'
  | 'records'
  | 'databaseSnapshot'
  | 'convertField'
  | 'search'
  | 'exportObjects'
  | 'checked'
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
  | 'redo'
  | 'breakHistoryGroup'
  | 'recordDraft'
  | 'discardDraft'
  | 'upload'
  | 'readAsset'
  | 'flush'
  | 'retry'
  | 'close'
>;
