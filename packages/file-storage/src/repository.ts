import { validateAssetSize } from '@tio/core';
import {
  applyCommit,
  assertAccess as checkAccess,
  createDomain,
  HostError,
  type AssetData,
  type CommitRequest,
  type CommitResult,
  type Domain,
  type ObjectQuery,
  type PageQuery,
  type RecordQuery,
  type RepositoryCapabilities,
  type WorkspaceContentPort,
  type WorkspaceEntry,
  type WorkspaceEvent,
  type WorkspaceRepository,
  type WorkspaceSnapshot,
} from '@tio/core';
import { ScanningRelations } from '@tio/database/relations';
import { ScanningQueries, pageEntries } from '@tio/database/repository';
import { canonical } from '@tio/serialization';

const assertAccess: typeof checkAccess = (...args) => {
  try {
    checkAccess(...args);
  } catch {
    throw new HostError('permission');
  }
};
interface PendingWrite {
  request: CommitRequest;
  before: Record<string, string | null>;
  assets: Record<string, AssetData>;
}
export interface FileJournalState {
  version: number;
  objects: Record<string, { hash: string; revision: number; changedAt: number }>;
  pending?: PendingWrite;
  receipts: Record<
    string,
    { signature: string; ids: string[]; version: number; clientId?: string; sequence?: number }
  >;
  watermarks: Record<string, number>;
}
/** Durable metadata plus unfinished writes only; acknowledged bodies are removed. */
export interface FileJournal {
  load(): Promise<FileJournalState | undefined>;
  save(state: FileJournalState): Promise<void>;
}
const fresh = (): FileJournalState => ({ version: 0, objects: {}, receipts: {}, watermarks: {} });
async function fingerprint(object: unknown) {
  const bytes = new TextEncoder().encode(canonical(object));
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))]
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}
/** Files are authoritative. Serialization is shared across instances by the host lock. */
export class FileRepository implements WorkspaceRepository {
  get attachmentPolicy() {
    return this.content.attachmentPolicy;
  }
  readonly storageCapabilities: RepositoryCapabilities = {
    persistence: 'recoverable',
    offline: false,
    prefetch: 'none',
  };
  private queries = new ScanningQueries(this);
  private relationQueries?: ScanningRelations;
  get relations() {
    return (this.relationQueries ??= new ScanningRelations(this, () => this.relationsReady()));
  }
  protected relationsReady() {
    return true;
  }

  private staged = new Map<string, AssetData>();
  private listeners = new Set<(event: WorkspaceEvent) => void>();
  private queue: Promise<unknown> = Promise.resolve();
  private closed = false;
  constructor(
    private content: WorkspaceContentPort,
    private workspaceId: string,
    private journal: FileJournal,
    private lock: <T>(work: () => Promise<T>) => Promise<T> = (work) => work(),
    private domain: Domain = createDomain(),
  ) {}
  private serial<T>(work: (state: FileJournalState) => Promise<T>): Promise<T> {
    const next = this.queue.then(() =>
      this.lock(async () => {
        if (this.closed) throw new HostError('closed');
        return work((await this.journal.load()) ?? fresh());
      }),
    );
    this.queue = next.catch(() => {});
    return next;
  }
  private emit(state: FileJournalState, commitId: string, ids: string[], origin = 'external') {
    for (const listener of this.listeners)
      listener({ version: state.version, commitId, changedIds: ids, origin });
  }
  private async scanState(state: FileJournalState): Promise<WorkspaceSnapshot> {
    const entries: WorkspaceEntry[] = [];
    const ids = await this.content.list();
    const changed: string[] = [];
    for (const id of ids) {
      const object = await this.content.read(id, { fresh: true });
      if (!object) throw new HostError('unavailable', `Object disappeared during scan: ${id}`);
      const hash = await fingerprint(object);
      const previous = state.objects[id];
      if (previous?.hash !== hash) {
        state.objects[id] = {
          hash,
          revision: (previous?.revision ?? 0) + 1,
          changedAt: state.version + 1,
        };
        changed.push(id);
      }
      entries.push({ object, revision: state.objects[id].revision });
    }
    for (const id of Object.keys(state.objects))
      if (!ids.includes(id))
        throw new HostError('unavailable', `Previously known file is missing: ${id}`);
    if (changed.length) {
      state.version++;
      await this.journal.save(state);
      this.emit(state, crypto.randomUUID(), changed);
    }
    return { version: state.version, entries };
  }
  private async recover(state: FileJournalState) {
    const pending = state.pending;
    if (!pending) return;
    const { request, before, assets } = pending;
    const access = await this.content.authorize();
    // Validate every object before writing any. A conflicting external edit is never overwritten.
    for (const object of request.changes) {
      const current = await this.content.read(object.id, { fresh: true });
      const hash = current ? await fingerprint(current) : null;
      if (hash !== before[object.id] && hash !== (await fingerprint(object)))
        throw new HostError('conflict', `Recovery conflicts with an external edit: ${object.id}`);
      assertAccess(access, current, object);
    }
    for (const [id, asset] of Object.entries(assets)) {
      const metadata = request.changes.find((o) => o.id === id) ?? (await this.content.read(id));
      if (!metadata || metadata.type !== 'asset')
        throw new HostError('invalid', 'Asset metadata missing');
      await this.content.writeAsset(metadata, asset.bytes);
    }
    for (const object of request.changes) {
      const current = await this.content.read(object.id, { fresh: true });
      const hash = current ? await fingerprint(current) : null;
      const desired = await fingerprint(object);
      if (hash === desired) continue;
      if (hash !== before[object.id])
        throw new HostError('conflict', `File changed during publication: ${object.id}`);
      assertAccess(await this.content.authorize(), current, object);
      await this.content.write(object);
    }
    const entries: WorkspaceEntry[] = [];
    state.version++;
    for (const object of request.changes) {
      const revision = (state.objects[object.id]?.revision ?? 0) + 1;
      state.objects[object.id] = {
        hash: await fingerprint(object),
        revision,
        changedAt: state.version,
      };
      entries.push({ object, revision });
    }
    state.receipts[request.id] = {
      signature: await fingerprint(request),
      ids: entries.map((e) => e.object.id),
      version: state.version,
      clientId: request.clientId,
      sequence: request.sequence,
    };
    delete state.pending;
    await this.journal.save(state);
    request.assetIds.forEach((id) => this.staged.delete(id));
    this.emit(
      state,
      request.id,
      request.changes.map((o) => o.id),
      request.origin ?? 'host',
    );
  }
  readSnapshot() {
    return this.serial(async (state) => {
      await this.recover(state);
      return this.scanState(state);
    });
  }
  readObjects(ids: string[]) {
    return this.serial(async (state) => {
      await this.recover(state);
      const entries: WorkspaceEntry[] = [];
      const missing: string[] = [];
      const changed: string[] = [];
      for (const id of [...new Set(ids)]) {
        const object = await this.content.read(id, { fresh: true });
        if (!object) {
          missing.push(id);
          continue;
        }
        const hash = await fingerprint(object);
        if (state.objects[id]?.hash !== hash) {
          state.objects[id] = {
            hash,
            revision: (state.objects[id]?.revision ?? 0) + 1,
            changedAt: state.version + 1,
          };
          changed.push(id);
        }
        entries.push({ object, revision: state.objects[id].revision });
      }
      if (changed.length) {
        state.version++;
        await this.journal.save(state);
        this.emit(state, crypto.randomUUID(), changed);
      }
      return { version: state.version, entries, missing };
    });
  }
  readChanges(since: number) {
    return this.serial(async (state) => {
      await this.recover(state);
      const snapshot = await this.scanState(state);
      return {
        ...snapshot,
        entries: snapshot.entries.filter((e) => state.objects[e.object.id].changedAt > since),
      };
    });
  }
  async readMetadata(ids: string[]) {
    return this.queries.metadata(ids);
  }
  queryMentions(query: import('@tio/core').MentionQuery) {
    return this.queries.mentions(query);
  }
  queryNavigation(query: import('@tio/core').NavigationQuery) {
    return this.queries.navigation(query);
  }
  queryRecords(query: RecordQuery) {
    return this.queries.records(query);
  }
  scan(query: PageQuery) {
    return this.queries.scan(query);
  }
  async queryObjects(query: ObjectQuery) {
    const snapshot = await this.readSnapshot();
    return pageEntries(
      {
        ...snapshot,
        entries: snapshot.entries.filter((e) =>
          'type' in query.scope
            ? e.object.type === query.scope.type
            : e.object.databaseId === query.scope.databaseId,
        ),
      },
      query,
    );
  }
  commit(request: CommitRequest): Promise<CommitResult> {
    return this.serial(async (state) => {
      if (
        state.pending &&
        state.pending.request.id === request.id &&
        canonical(state.pending.request) !== canonical(request)
      )
        throw new HostError('invalid', 'Commit ID reused');
      await this.recover(state);
      const receipt = state.receipts[request.id];
      if (receipt) {
        if (receipt.signature !== (await fingerprint(request)))
          throw new HostError('invalid', 'Commit ID reused');
        return this.receiptResult(state, request.id);
      }
      if (
        request.clientId &&
        request.sequence &&
        request.sequence <= (state.watermarks[request.clientId] ?? 0)
      )
        return { status: 'compacted', version: state.version };
      const snapshot = await this.scanState(state);
      if (request.expectedVersion !== state.version)
        return { status: 'conflict', version: state.version };
      if (request.changes.some((o) => o.workspaceId !== this.workspaceId))
        throw new HostError('invalid', 'Cross-workspace write');
      applyCommit(snapshot, request, this.domain);
      const access = await this.content.authorize();
      const before: PendingWrite['before'] = {};
      for (const object of request.changes) {
        assertAccess(
          access,
          snapshot.entries.find((e) => e.object.id === object.id)?.object,
          object,
        );
        before[object.id] = state.objects[object.id]?.hash ?? null;
      }
      const assets: PendingWrite['assets'] = {};
      for (const id of request.assetIds) {
        const asset = this.staged.get(id);
        if (!asset) throw new HostError('invalid', 'Missing staged asset');
        assets[id] = asset;
      }
      for (const object of request.changes)
        if (
          object.type === 'asset' &&
          !object.deleted &&
          !assets[object.id] &&
          !(await this.content.readAsset(object))
        )
          throw new HostError('invalid', 'Missing asset');
      state.pending = structuredClone({ request, before, assets });
      await this.journal.save(state);
      await this.recover(state);
      return this.receiptResult(state, request.id);
    });
  }
  private async receiptResult(state: FileJournalState, id: string): Promise<CommitResult> {
    const receipt = state.receipts[id];
    const snapshot = await this.scanState(state);
    return {
      status: 'committed',
      version: snapshot.version,
      entries: snapshot.entries.filter((e) => receipt.ids.includes(e.object.id)),
    };
  }
  getCommitResult(id: string) {
    return this.serial(async (state) => {
      await this.recover(state);
      return state.receipts[id] ? this.receiptResult(state, id) : undefined;
    });
  }
  acknowledgeCommits(clientId: string, sequence: number) {
    return this.serial(async (state) => {
      state.watermarks[clientId] = Math.max(sequence, state.watermarks[clientId] ?? 0);
      for (const [id, receipt] of Object.entries(state.receipts))
        if (receipt.clientId === clientId && receipt.sequence! <= sequence)
          delete state.receipts[id];
      await this.journal.save(state);
    });
  }
  subscribeChanges(listener: (event: WorkspaceEvent) => void) {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }
  async stageAsset(id: string, asset: AssetData) {
    validateAssetSize(asset.bytes.byteLength, this.attachmentPolicy.maxFileBytes);
    if (!/^[a-zA-Z0-9_-]+$/.test(id)) throw new HostError('invalid');
    this.staged.set(id, structuredClone(asset));
  }
  async readAsset(id: string) {
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
    this.relationQueries?.close();
    this.closed = true;
    this.listeners.clear();
    this.staged.clear();
  }
}
