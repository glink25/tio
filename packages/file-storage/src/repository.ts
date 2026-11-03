import {
  applyCommit,
  assertAccess,
  createDomain,
  HostError,
  readableObject,
  navigationObject,
  preservePrivateFields,
  validateAssetSize,
  type AssetData,
  type CommitRequest,
  type CommitResult,
  type Domain,
  type ObjectQuery,
  type PageQuery,
  type RecordQuery,
  type RepositoryCapabilities,
  type RepositoryStateStore,
  type WorkspaceContentPort,
  type WorkspaceEntry,
  type WorkspaceEvent,
  type WorkspaceRepository,
  type WorkspaceSnapshot,
  type TioObject,
  type QueryEntry,
  type QueryIndexState,
  type ProjectionQuery,
} from '@tio/core';
import { queryEntry } from '@tio/database/query-entry';
import { ScanningRelations } from '@tio/database/relations';
import { ProjectionQueries } from '@tio/database/repository';
import { canonical } from '@tio/serialization';

interface PendingWrite {
  request: CommitRequest;
  before: Record<string, string | null>;
  assets: Record<string, AssetData>;
  signature: string;
}
interface ObjectState extends QueryEntry {
  hash: string;
  changedAt: number;
}
interface Receipt {
  signature: string;
  ids: string[];
  clientId?: string;
  sequence?: number;
}
const changeKey = (version: number, id = '') => `change/${String(version).padStart(16, '0')}/${id}`;
async function fingerprint(object: unknown) {
  const bytes = new TextEncoder().encode(canonical(object));
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))]
    .map((v) => v.toString(16).padStart(2, '0'))
    .join('');
}
/** Files are authoritative; the state store contains projections and unfinished publications only. */
export class FileRepository implements WorkspaceRepository {
  get attachmentPolicy() {
    return this.content.attachmentPolicy;
  }
  readonly storageCapabilities: RepositoryCapabilities = {
    persistence: 'recoverable',
    offline: false,
    prefetch: 'none',
  };
  private queries = new ProjectionQueries(this);
  private relationQueries?: ScanningRelations;
  get relations() {
    return (this.relationQueries ??= new ScanningRelations(this));
  }
  private staged = new Map<string, AssetData>();
  private listeners = new Set<(event: WorkspaceEvent) => void>();
  private indexListeners = new Set<() => void>();
  private queue: Promise<unknown> = Promise.resolve();
  private building?: Promise<void>;
  private closed = false;
  private notifiedVersion = 0;
  queryIndexState: QueryIndexState = { status: 'building' };
  constructor(
    private content: WorkspaceContentPort,
    private workspaceId: string,
    private state: RepositoryStateStore,
    private lock: <T>(work: () => Promise<T>) => Promise<T> = (work) => work(),
    private domain: Domain = createDomain(),
  ) {}
  private serial<T>(work: () => Promise<T>): Promise<T> {
    const next = this.queue.then(() =>
      this.lock(async () => {
        if (this.closed) throw new HostError('closed');
        return work();
      }),
    );
    this.queue = next.catch(() => {});
    return next;
  }
  private async version() {
    return (await this.state.read<number>('version')) ?? 0;
  }
  private emit(version: number, commitId: string, changedIds: string[], origin = 'external') {
    this.notifiedVersion = Math.max(this.notifiedVersion, version);
    for (const listener of this.listeners) listener({ version, commitId, changedIds, origin });
  }
  private async authorize() {
    const access = await this.content.authorize();
    if (
      !access.allows(
        { workspaceId: this.workspaceId, id: this.workspaceId, type: 'workspace' },
        'read',
      )
    )
      throw new HostError('permission');
    return access;
  }
  private indexStatus(status: QueryIndexState) {
    this.queryIndexState = status;
    for (const listener of this.indexListeners) listener();
  }
  subscribeQueryIndex = (listener: () => void) => {
    this.indexListeners.add(listener);
    return () => {
      this.indexListeners.delete(listener);
    };
  };
  private async initialize() {
    await this.authorize();
    if (await this.state.read<boolean>('ready')) {
      if (!this.building && this.queryIndexState.status !== 'error')
        this.queryIndexState = { status: 'ready' };
      return;
    }
    if (!this.building && this.queryIndexState.status !== 'error')
      void this.refreshExternal().catch(() => {});
  }
  /** Only explicit refresh and first-use indexing discover external files. Never called by poll(). */
  refreshExternal(): Promise<void> {
    if (this.building) return this.building;
    this.indexStatus({ status: 'building' });
    this.building = (async () => {
      await this.authorize();
      const start = await this.serial(async () => {
        await this.recover();
        return this.version();
      });
      const ids = await this.content.list();
      const observed = new Map<string, { object: TioObject; state: ObjectState }>();
      // Bounded batches keep file I/O and object lifetimes independent of the full corpus.
      for (let offset = 0; offset < ids.length; offset += 64) {
        if (this.closed) throw new HostError('closed');
        await Promise.all(
          Array.from({ length: 4 }, async (_, worker) => {
            for (let i = offset + worker; i < Math.min(offset + 64, ids.length); i += 4) {
              const object = await this.content.read(ids[i], { fresh: true });
              if (!object)
                throw new HostError('unavailable', `Object disappeared during scan: ${ids[i]}`);
              const derived = queryEntry(object, 0);
              // Keep the projection, not a complete body, throughout the rebuild.
              observed.set(object.id, {
                object: derived.projection,
                state: { ...derived, hash: await fingerprint(object), changedAt: 0 },
              });
            }
          }),
        );
        await new Promise<void>((resolve) => setTimeout(resolve, 0));
      }
      await this.serial(async () => {
        await this.authorize();
        await this.recover();
        const previous = await this.state.entries<ObjectState>('object/');
        const byId = new Map(previous.map(({ value }) => [value.projection.id, value]));
        for (const [id, old] of byId)
          if (!observed.has(id) && old.changedAt <= start)
            throw new HostError('unavailable', `Previously known file is missing: ${id}`);
        const version = await this.version();
        const updates: { key: string; value: unknown }[] = [];
        const deletes: string[] = [];
        const changed: string[] = [];
        for (const [id, { state: entry }] of observed) {
          const old = byId.get(id);
          if (old && (old.changedAt > start || old.hash === entry.hash)) continue;
          const next = { ...entry, revision: (old?.revision ?? 0) + 1, changedAt: version + 1 };
          this.indexUpdate(next, old, updates, deletes);
          changed.push(id);
        }
        await this.state.write(
          [
            ...updates,
            { key: 'version', value: changed.length ? version + 1 : version },
            { key: 'ready', value: true },
            ...(!previous.length ? [{ key: 'record-order-ready', value: true }] : []),
          ],
          deletes,
        );
        if (changed.length) this.emit(version + 1, crypto.randomUUID(), changed);
      });
      this.indexStatus({ status: 'ready' });
    })()
      .catch((error) => {
        if (!this.closed) this.indexStatus({ status: 'error', error: String(error) });
        throw error;
      })
      .finally(() => {
        this.building = undefined;
      });
    return this.building;
  }
  private indexUpdate(
    entry: ObjectState,
    previous: ObjectState | undefined,
    puts: { key: string; value: unknown }[],
    deletes: string[],
  ) {
    const o = entry.projection;
    if (previous) {
      if (previous.projection.databaseId)
        deletes.push(`record-order/${previous.projection.databaseId}/${o.id}`);
      deletes.push(changeKey(previous.changedAt, o.id), `type/${previous.projection.type}/${o.id}`);
      if (previous.projection.databaseId)
        deletes.push(`database/${previous.projection.databaseId}/${o.id}`);
    }
    puts.push(
      { key: `object/${o.id}`, value: entry },
      { key: `type/${o.type}/${o.id}`, value: o.id },
      { key: changeKey(entry.changedAt, o.id), value: o.id },
    );
    if (o.type === 'record' && o.databaseId && !o.deleted)
      puts.push({ key: `record-order/${o.databaseId}/${o.id}`, value: navigationObject(o) });
    if (o.databaseId) puts.push({ key: `database/${o.databaseId}/${o.id}`, value: o.id });
  }
  private async observe(ids: string[], complete = false): Promise<WorkspaceSnapshot> {
    const version = await this.version();
    const access = await this.authorize();
    const entries: WorkspaceEntry[] = [],
      missing: string[] = [],
      denied: string[] = [];
    const puts: { key: string; value: unknown }[] = [],
      deletes: string[] = [],
      changed: string[] = [];
    for (const id of new Set(ids)) {
      const previous = await this.state.read<ObjectState>('object/' + id);
      const object = await this.content.read(id, { fresh: true });
      if (!object) {
        if (previous) throw new HostError('unavailable', `Previously known file is missing: ${id}`);
        missing.push(id);
        continue;
      }
      const hash = await fingerprint(object);
      let revision = previous?.revision ?? 0;
      if (previous?.hash !== hash) {
        revision++;
        this.indexUpdate(
          { ...queryEntry(object, revision), hash, changedAt: version + 1 },
          previous,
          puts,
          deletes,
        );
        changed.push(id);
      }
      const readable = complete ? object : readableObject(access, object);
      if (readable) entries.push({ object: readable, revision });
      else denied.push(id);
    }
    if (changed.length) {
      await this.state.write([...puts, { key: 'version', value: version + 1 }], deletes);
      this.emit(version + 1, crypto.randomUUID(), changed);
    }
    return { version: changed.length ? version + 1 : version, entries, missing, denied };
  }
  private async recover() {
    const pending = await this.state.read<PendingWrite>('pending');
    if (!pending) return;
    const { request, before, assets } = pending;
    for (const object of request.changes) {
      const current = await this.content.read(object.id, { fresh: true });
      const hash = current ? await fingerprint(current) : null;
      if (hash !== before[object.id] && hash !== (await fingerprint(object)))
        throw new HostError('conflict', `Recovery conflicts with an external edit: ${object.id}`);
      assertAccess(await this.content.authorize(), current, object);
    }
    for (const [id, asset] of Object.entries(assets)) {
      const metadata =
        request.changes.find((o) => o.id === id) ?? (await this.content.read(id, { fresh: true }));
      if (!metadata || metadata.type !== 'asset')
        throw new HostError('invalid', 'Asset metadata missing');
      await this.content.writeAsset(metadata, asset.bytes);
    }
    for (const object of request.changes) {
      const current = await this.content.read(object.id, { fresh: true });
      const hash = current ? await fingerprint(current) : null;
      if (hash === (await fingerprint(object))) continue;
      if (hash !== before[object.id])
        throw new HostError('conflict', `File changed during publication: ${object.id}`);
      assertAccess(await this.content.authorize(), current, object);
      await this.content.write(object);
    }
    const version = (await this.version()) + 1;
    const puts: { key: string; value: unknown }[] = [],
      deletes = ['pending'];
    for (const object of request.changes) {
      const previous = await this.state.read<ObjectState>('object/' + object.id);
      this.indexUpdate(
        {
          ...queryEntry(object, (previous?.revision ?? 0) + 1),
          hash: await fingerprint(object),
          changedAt: version,
        },
        previous,
        puts,
        deletes,
      );
    }
    const receipt: Receipt = {
      signature: pending.signature,
      ids: request.changes.map((o) => o.id),
      clientId: request.clientId,
      sequence: request.sequence,
    };
    puts.push({ key: 'receipt/' + request.id, value: receipt }, { key: 'version', value: version });
    if (request.clientId && request.sequence)
      puts.push({
        key: `client/${request.clientId}/${String(request.sequence).padStart(16, '0')}`,
        value: request.id,
      });
    await this.state.write(puts, deletes);
    request.assetIds.forEach((id) => this.staged.delete(id));
    this.emit(
      version,
      request.id,
      request.changes.map((o) => o.id),
      request.origin ?? 'host',
    );
  }
  readObjects(ids: string[]) {
    return this.serial(async () => {
      await this.recover();
      return this.observe(ids);
    });
  }
  async readSnapshot(): Promise<WorkspaceSnapshot> {
    await this.refreshExternal();
    const ids = (await this.state.entries<ObjectState>('object/')).map(
      (e) => e.value.projection.id,
    );
    const entries: WorkspaceEntry[] = [];
    for (let offset = 0; offset < ids.length; offset += 250)
      entries.push(...(await this.readObjects(ids.slice(offset, offset + 250))).entries);
    return { version: await this.version(), entries };
  }
  readChanges(since: number, ids?: string[]) {
    return this.serial(async () => {
      await this.recover();
      const changed = await this.state.entries<string>('change/', changeKey(since, '\uffff'));
      const scoped = ids ? new Set(ids) : undefined;
      const states = (
        await this.state.readMany<ObjectState>(changed.map(({ value }) => 'object/' + value))
      ).filter((e): e is ObjectState => !!e);
      const selected = states
        .filter((e) => !scoped || scoped.has(e.projection.id))
        .map((e) => e.projection.id);
      const snapshot = await this.observe(selected);
      if (scoped) {
        const access = await this.authorize();
        for (const entry of states) {
          if (
            scoped.has(entry.projection.id) ||
            !['workspace', 'page', 'database', 'databaseView'].includes(entry.projection.type)
          )
            continue;
          const object = readableObject(access, navigationObject(entry.projection));
          if (object) snapshot.entries.push({ object, revision: entry.revision });
        }
      }
      return snapshot;
    });
  }
  async readProjection(query: ProjectionQuery) {
    await this.initialize();
    return this.serial(async () => {
      await this.recover();
      const access = await this.authorize();
      let values: ObjectState[];
      if (query.ids)
        values = (
          await this.state.readMany<ObjectState>(
            [...new Set(query.ids)].map((id) => 'object/' + id),
          )
        ).filter((e): e is ObjectState => !!e);
      else {
        const prefix = query.type
          ? `type/${query.type}/`
          : query.databaseId
            ? `database/${query.databaseId}/`
            : 'object/';
        const rows = await this.state.entries<ObjectState | string>(
          prefix,
          query.after ? prefix + query.after : undefined,
          query.limit,
        );
        values =
          prefix === 'object/'
            ? rows.map(({ value }) => value as ObjectState)
            : (
                await this.state.readMany<ObjectState>(
                  rows.map(({ value }) => 'object/' + (value as string)),
                )
              ).filter((e): e is ObjectState => !!e);
      }
      const denied: string[] = [];
      return {
        version: await this.version(),
        next:
          query.limit !== undefined && values.length === query.limit
            ? values.at(-1)!.projection.id
            : undefined,
        entries: values.flatMap((e) => {
          const projection = readableObject(access, e.projection);
          if (!projection) {
            denied.push(e.projection.id);
            return [];
          }
          return [{ projection, revision: e.revision, references: e.references }];
        }),
        missing: query.ids?.filter((id) => !values.some((e) => e.projection.id === id)),
        denied,
      };
    });
  }
  async queryAccessVersion() {
    return (await this.authorize()).version;
  }
  async readRecordOrder(databaseId: string) {
    await this.requireIndex();
    return this.serial(async () => {
      await this.recover();
      const access = await this.authorize();
      if (!(await this.state.read<boolean>('record-order-ready'))) {
        const objects = await this.state.entries<ObjectState>('object/');
        await this.state.write([
          ...objects.flatMap(({ value: { projection: o } }) =>
            o.type === 'record' && o.databaseId && !o.deleted
              ? [{ key: `record-order/${o.databaseId}/${o.id}`, value: navigationObject(o) }]
              : [],
          ),
          { key: 'record-order-ready', value: true },
        ]);
      }
      const rows = await this.state.entries<TioObject>(`record-order/${databaseId}/`);
      return {
        version: await this.version(),
        ids: rows.filter(({ value }) => readableObject(access, value)).map(({ value }) => value.id),
      };
    });
  }
  private async requireIndex() {
    await this.initialize();
    if (this.queryIndexState.status !== 'ready')
      throw new HostError(
        this.queryIndexState.status === 'error' ? 'unavailable' : 'pending',
        this.queryIndexState.error ?? 'Query index is being prepared',
      );
  }
  async readMetadata(ids: string[]) {
    await this.requireIndex();
    return this.queries.metadata(ids);
  }
  async queryMentions(query: import('@tio/core').MentionQuery) {
    await this.requireIndex();
    return this.queries.mentions(query);
  }
  async queryNavigation(query: import('@tio/core').NavigationQuery) {
    await this.initialize();
    if (this.queryIndexState.status === 'error')
      throw new HostError('unavailable', this.queryIndexState.error);
    return this.queries.navigation(query);
  }
  async queryRecordWindow(query: import('@tio/core').RecordWindowQuery) {
    await this.requireIndex();
    return this.queries.window(query);
  }
  async queryRecords(query: RecordQuery) {
    await this.requireIndex();
    return this.queries.records(query);
  }
  async scan(query: PageQuery) {
    await this.requireIndex();
    return this.queries.scan(query);
  }
  async queryObjects(query: ObjectQuery) {
    await this.requireIndex();
    return this.queries.objects(query);
  }
  commit(request: CommitRequest): Promise<CommitResult> {
    return this.serial(async () => {
      const signature = await fingerprint(request);
      const pending = await this.state.read<PendingWrite>('pending');
      if (pending?.request.id === request.id && pending.signature !== signature)
        throw new HostError('invalid', 'Commit ID reused');
      await this.recover();
      const receipt = await this.state.read<Receipt>('receipt/' + request.id);
      if (receipt) {
        if (receipt.signature !== (await fingerprint(request)))
          throw new HostError('invalid', 'Commit ID reused');
        return { status: 'committed', ...(await this.observe(receipt.ids)) };
      }
      const version = await this.version();
      if (
        request.clientId &&
        request.sequence &&
        request.sequence <= ((await this.state.read<number>('watermark/' + request.clientId)) ?? 0)
      )
        return { status: 'compacted', version };
      if (request.changes.some((o) => o.workspaceId !== this.workspaceId))
        throw new HostError('invalid', 'Cross-workspace write');
      const needed = [
        ...new Set(request.changes.flatMap((o) => [o.id, ...(o.databaseId ? [o.databaseId] : [])])),
      ];
      const snapshot = await this.observe(needed, true);
      if (request.expectedVersion !== snapshot.version)
        return { status: 'conflict', version: snapshot.version };
      const access = await this.content.authorize();
      const originals = new Map(snapshot.entries.map((e) => [e.object.id, e.object]));
      const effective = {
        ...request,
        changes: request.changes.map((object) =>
          preservePrivateFields(access, originals.get(object.id), object),
        ),
      };
      applyCommit(snapshot, effective, this.domain);
      const before: PendingWrite['before'] = {},
        assets: PendingWrite['assets'] = {};
      for (const object of effective.changes) {
        assertAccess(access, originals.get(object.id), object);
        before[object.id] = originals.has(object.id)
          ? await fingerprint(originals.get(object.id))
          : null;
        if (
          object.type === 'asset' &&
          !object.deleted &&
          !request.assetIds.includes(object.id) &&
          !(await this.content.readAsset(object))
        )
          throw new HostError('invalid', 'Missing asset');
      }
      for (const id of request.assetIds) {
        const asset = this.staged.get(id);
        if (!asset) throw new HostError('invalid', 'Missing staged asset');
        assets[id] = asset;
      }
      await this.state.write([
        { key: 'pending', value: { request: effective, before, assets, signature } },
      ]);
      await this.recover();
      // Recovery already verified and published exactly these objects. No workspace scan.
      const entries = await Promise.all(
        effective.changes.map(async (object) => ({
          object,
          revision: (await this.state.read<ObjectState>('object/' + object.id))!.revision,
        })),
      );
      return {
        status: 'committed',
        version: await this.version(),
        entries: structuredClone(
          entries.flatMap((entry) => {
            const object = readableObject(access, entry.object);
            return object ? [{ ...entry, object }] : [];
          }),
        ),
      };
    });
  }
  getCommitResult(id: string): Promise<CommitResult | undefined> {
    return this.serial(async () => {
      await this.recover();
      const receipt = await this.state.read<Receipt>('receipt/' + id);
      return receipt ? { status: 'committed', ...(await this.observe(receipt.ids)) } : undefined;
    });
  }
  acknowledgeCommits(clientId: string, sequence: number) {
    return this.serial(async () => {
      const watermark = Math.max(
        sequence,
        (await this.state.read<number>('watermark/' + clientId)) ?? 0,
      );
      const rows = await this.state.entries<string>('client/' + clientId + '/');
      const deletes = rows
        .filter(({ key }) => Number(key.slice(key.lastIndexOf('/') + 1)) <= watermark)
        .flatMap(({ key, value }) => [key, 'receipt/' + value]);
      await this.state.write([{ key: 'watermark/' + clientId, value: watermark }], deletes);
    });
  }
  subscribeChanges = (fn: (event: WorkspaceEvent) => void) => {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  };
  notifyChanges = () =>
    this.serial(async () => {
      const version = await this.version();
      if (version <= this.notifiedVersion) return;
      const rows = await this.state.entries<string>(
        'change/',
        changeKey(this.notifiedVersion, '\uffff'),
      );
      this.emit(
        version,
        crypto.randomUUID(),
        rows.map((row) => row.value),
      );
    }).catch((error) => {
      if (!this.closed) throw error;
    });
  async stageAsset(id: string, asset: AssetData) {
    validateAssetSize(asset.bytes.byteLength, this.attachmentPolicy.maxFileBytes);
    if (!/^[a-zA-Z0-9_-]+$/.test(id)) throw new HostError('invalid');
    this.staged.set(id, structuredClone(asset));
  }
  async readAsset(id: string) {
    await this.authorize();
    const object = await this.content.read(id, { fresh: true });
    if (!object || object.deleted) return undefined;
    const bytes = await this.content.readAsset(object);
    if (!bytes) throw new HostError('unavailable', `Missing asset: ${id}`);
    return { name: object.filename ?? '', mime: object.mime ?? '', bytes };
  }
  async releaseAsset(id: string) {
    this.staged.delete(id);
  }
  close() {
    this.closed = true;
    this.relationQueries?.close();
    this.queries.close();
    this.listeners.clear();
    this.indexListeners.clear();
    this.staged.clear();
  }
}
