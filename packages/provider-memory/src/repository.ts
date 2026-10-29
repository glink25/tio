import { validateAssetSize } from '@tio/core';
import type { PageQuery, RecordQuery, RepositoryCapabilities } from '@tio/core';
import {
  applyCommit,
  createDomain,
  type Domain,
  fullAccess,
  resourceOf,
  assertAccess,
  readableObject,
  preservePrivateFields,
  type AccessPolicy,
  type WorkspaceEvent,
  HostError,
  type AssetData,
  type CommitRequest,
  type CommitResult,
  type WorkspaceRepository,
  type WorkspaceSnapshot,
  type ObjectQuery,
} from '@tio/core';
import { ScanningRelations } from '@tio/database/relations';
import { ScanningQueries } from '@tio/database/repository';
/** Reference host implementation. Only this host owns durable state in embedding tests. */
export class MemoryRepository implements WorkspaceRepository {
  readonly attachmentPolicy = { maxFileBytes: 20 * 1024 * 1024, maxImageBytes: 10 * 1024 * 1024 };
  automation?: import('@tio/core').AutomationProvider;
  readonly storageCapabilities: RepositoryCapabilities = {
    persistence: 'atomic',
    offline: true,
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

  private snapshot: WorkspaceSnapshot = { version: 0, entries: [] };
  private changedAt = new Map<string, number>();
  private receipts = new Map<string, { signature: string; result: CommitResult }>();
  readonly recovery: unknown[] = [];
  private staged = new Map<string, AssetData>();
  private assets = new Map<string, AssetData>();
  private listeners = new Set<(event: WorkspaceEvent) => void>();
  constructor(
    readonly access: AccessPolicy = fullAccess,
    readonly domain: Domain = createDomain(),
  ) {}
  private watermarks = new Map<string, number>();
  async acknowledgeCommits(clientId: string, sequence: number) {
    this.watermarks.set(clientId, Math.max(sequence, this.watermarks.get(clientId) ?? 0));
    for (const [id, receipt] of this.receipts) {
      const request = JSON.parse(receipt.signature);
      if (request.clientId === clientId && request.sequence <= sequence) this.receipts.delete(id);
    }
  }
  async readSnapshot() {
    return {
      version: this.snapshot.version,
      entries: this.snapshot.entries.flatMap((entry) => {
        const object = readableObject(this.access, entry.object);
        return object ? [{ ...entry, object: structuredClone(object) }] : [];
      }),
    };
  }
  async queryObjects(query: ObjectQuery) {
    if (!Number.isSafeInteger(query.limit) || query.limit < 1 || query.limit > 1000)
      throw new HostError('invalid', 'Query limit must be 1..1000');
    const snapshot = await this.readSnapshot();
    const matched = snapshot.entries
      .filter(
        ({ object }) =>
          ('type' in query.scope
            ? object.type === query.scope.type
            : object.databaseId === query.scope.databaseId) &&
          (!query.after || object.id > query.after),
      )
      .sort((a, b) => (a.object.id < b.object.id ? -1 : a.object.id > b.object.id ? 1 : 0));
    const entries = matched.slice(0, query.limit);
    return {
      version: snapshot.version,
      entries,
      next: matched.length > entries.length ? entries[entries.length - 1].object.id : undefined,
    };
  }
  async readObjects(ids: string[]): Promise<WorkspaceSnapshot> {
    const selected = new Set(ids);
    const result = this.selectEntries((id) => selected.has(id));
    return {
      ...result,
      missing: ids.filter((id) => !this.snapshot.entries.some((e) => e.object.id === id)),
      denied: ids.filter(
        (id) =>
          this.snapshot.entries.some((e) => e.object.id === id) &&
          !result.entries.some((e) => e.object.id === id),
      ),
    };
  }
  async readChanges(since: number): Promise<WorkspaceSnapshot> {
    return this.selectEntries((id) => (this.changedAt.get(id) ?? 0) > since);
  }
  private selectEntries(select: (id: string) => boolean): WorkspaceSnapshot {
    return {
      version: this.snapshot.version,
      entries: this.snapshot.entries.flatMap((entry) => {
        if (!select(entry.object.id)) return [];
        const object = readableObject(this.access, entry.object);
        return object ? [{ object: structuredClone(object), revision: entry.revision }] : [];
      }),
    };
  }
  private readableResult(result: CommitResult): CommitResult {
    if (result.status !== 'committed') return structuredClone(result);
    return {
      ...result,
      entries: result.entries.flatMap((entry) => {
        const object = readableObject(this.access, entry.object);
        return object ? [{ ...entry, object: structuredClone(object) }] : [];
      }),
    };
  }
  async getCommitResult(id: string) {
    const receipt = this.receipts.get(id)?.result;
    return receipt ? this.readableResult(receipt) : undefined;
  }
  subscribeChanges = (listener: (event: WorkspaceEvent) => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  async commit(request: CommitRequest): Promise<CommitResult> {
    const signature = JSON.stringify(request);
    const receipt = this.receipts.get(request.id);
    if (receipt) {
      if (receipt.signature !== signature) throw new HostError('invalid', 'Commit ID reused');
      return this.readableResult(receipt.result);
    }
    if (
      request.clientId &&
      request.sequence &&
      request.sequence <= (this.watermarks.get(request.clientId) ?? 0)
    )
      return { status: 'compacted', version: this.snapshot.version };
    const effective = {
      ...request,
      changes: request.changes.map((object) =>
        preservePrivateFields(
          this.access,
          this.snapshot.entries.find((e) => e.object.id === object.id)?.object,
          object,
        ),
      ),
    };
    for (const object of effective.changes) {
      try {
        assertAccess(
          this.access,
          this.snapshot.entries.find((e) => e.object.id === object.id)?.object,
          object,
        );
      } catch {
        throw new HostError('permission');
      }
    }
    if (request.expectedVersion !== this.snapshot.version)
      return { status: 'conflict', version: this.snapshot.version };
    const entries = applyCommit(this.snapshot, effective, this.domain);
    const assets = new Map(this.assets);
    for (const id of request.assetIds) {
      const data = this.staged.get(id) ?? assets.get(id);
      if (!data) throw new HostError('invalid', 'Missing staged asset');
      assets.set(id, data);
    }
    for (const o of request.changes)
      if (o.type === 'asset' && !o.deleted && !assets.has(o.id))
        throw new HostError('invalid', 'Missing asset');
    this.snapshot = { version: this.snapshot.version + 1, entries };
    for (const object of request.changes) this.changedAt.set(object.id, this.snapshot.version);
    this.assets = assets;
    this.recovery.push(...structuredClone(request.recovery ?? []));
    request.assetIds.forEach((id) => this.staged.delete(id));
    const result: CommitResult = {
      status: 'committed',
      version: this.snapshot.version,
      entries: structuredClone(
        entries.filter((e) => request.changes.some((o) => o.id === e.object.id)),
      ),
    };
    this.receipts.set(request.id, { signature, result });
    this.listeners.forEach((listener) =>
      listener({
        version: this.snapshot.version,
        commitId: request.id,
        origin: request.origin ?? 'host',
        changedIds: request.changes.map((o) => o.id),
      }),
    );
    return this.readableResult(result);
  }
  async stageAsset(id: string, asset: AssetData) {
    validateAssetSize(asset.bytes.byteLength, this.attachmentPolicy.maxFileBytes);
    if (!/^[a-zA-Z0-9_-]+$/.test(id)) throw new HostError('invalid');
    this.staged.set(id, structuredClone(asset));
  }
  async readAsset(id: string) {
    const entry = this.snapshot.entries.find((entry) => entry.object.id === id);
    if (entry && !this.access.allows(resourceOf(entry.object), 'read'))
      throw new HostError('permission');
    return structuredClone(this.assets.get(id));
  }
  async releaseAsset(id: string) {
    this.staged.delete(id);
  }
}
