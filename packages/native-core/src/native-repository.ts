import {
  applyCommit,
  type TioObject,
  type RepositoryCapabilities,
  validateAssetSize,
  type AssetData,
  type CommitRequest,
  type CommitResult,
  type WorkspaceSnapshot,
  type WorkspaceRepository,
  type WorkspaceEvent,
  type ObjectQuery,
  type ProjectionQuery,
  type QueryPage,
  type RecordQuery,
  type PageQuery,
  type MentionQuery,
  type NavigationQuery,
  type RecordWindowQuery,
} from '@tio/core';
import { queryEntry } from '@tio/database/query-entry';
import { ScanningRelations } from '@tio/database/relations';
import { ProjectionQueries } from '@tio/database/repository';

export class NativeRepository implements WorkspaceRepository {
  readonly storageCapabilities: RepositoryCapabilities = {
    persistence: 'atomic',
    offline: true,
    prefetch: 'none',
  } as const;
  readonly attachmentPolicy = { maxFileBytes: 20 * 1024 * 1024, maxImageBytes: 10 * 1024 * 1024 };
  private queries = new ProjectionQueries(this);
  readonly relations = new ScanningRelations(this, () => this.relationsReady());
  protected relationsReady() {
    return true;
  }
  private listeners = new Set<(event: WorkspaceEvent) => void>();
  private channel: BroadcastChannel | undefined;
  constructor(
    protected space: string,
    protected execute: <T>(
      space: string,
      action: string,
      args?: Record<string, unknown>,
    ) => Promise<T>,
    namespace = 'device',
  ) {
    if (typeof BroadcastChannel !== 'undefined') {
      this.channel = new BroadcastChannel('tio-' + JSON.stringify([namespace, space]));
      this.channel.onmessage = ({ data }) => this.emit(data as WorkspaceEvent);
    }
  }
  private emit(event: WorkspaceEvent) {
    for (const listener of this.listeners) listener(event);
  }
  subscribeChanges(listener: (event: WorkspaceEvent) => void) {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }
  readSnapshot() {
    return this.execute<WorkspaceSnapshot>(this.space, 'read', { projection: false });
  }
  async readObjects(ids: string[]) {
    const snapshot = await this.execute<WorkspaceSnapshot>(this.space, 'read', {
      ids,
      projection: false,
    });
    const found = new Set(snapshot.entries.map((e) => e.object.id));
    return { ...snapshot, missing: ids.filter((id) => !found.has(id)) };
  }
  readChanges(since: number) {
    return this.execute<WorkspaceSnapshot>(this.space, 'read', { since, projection: false });
  }
  async readProjection(query: ProjectionQuery) {
    const result = await this.execute<QueryPage>(this.space, 'read', {
      ...query,
      kind: query.type,
      database: query.databaseId,
      projection: true,
    });
    if (query.limit && result.entries.length === query.limit)
      result.next = result.entries.at(-1)!.projection.id;
    return result;
  }
  queryObjects(query: ObjectQuery) {
    return this.queries.objects(query);
  }
  scan(query: PageQuery) {
    return this.queries.scan(query);
  }
  queryRecords(query: RecordQuery) {
    return this.queries.records(query);
  }
  queryRecordWindow(query: RecordWindowQuery) {
    return this.queries.window(query);
  }
  queryMentions(query: MentionQuery) {
    return this.queries.mentions(query);
  }
  queryNavigation(query: NavigationQuery) {
    return this.queries.navigation(query);
  }
  readMetadata(ids: string[]) {
    return this.queries.metadata(ids);
  }
  async commit(
    request: CommitRequest,
    baseline?: { endpoint: string; base: TioObject; clean: boolean },
  ) {
    const ids = new Set(
      request.changes.flatMap((o) => (o.databaseId ? [o.id, o.databaseId] : [o.id])),
    );
    const previous = await this.readObjects([...ids]);
    const changes = new Set(request.changes.map((o) => o.id));
    const entries =
      previous.version === request.expectedVersion
        ? applyCommit(previous, request).filter((entry) => changes.has(entry.object.id))
        : [];
    const result = await this.execute<CommitResult>(this.space, 'publish', {
      request,
      entries,
      baseline,
      projections: entries.map((e) => queryEntry(e.object, e.revision)),
      signature: JSON.stringify(request),
    });
    if (result.status === 'committed') {
      const event = {
        version: result.version,
        commitId: request.id,
        origin: request.origin ?? 'host',
        changedIds: [...changes],
      };
      this.emit(event);
      this.channel?.postMessage(event);
    }
    return result;
  }
  async getCommitResult(id: string) {
    return (await this.execute<CommitResult | null>(this.space, 'receipt', { id })) ?? undefined;
  }
  acknowledgeCommits(client: string, sequence: number) {
    return this.execute<void>(this.space, 'acknowledge', { client, sequence });
  }
  async stageAsset(id: string, asset: AssetData) {
    validateAssetSize(asset.bytes.byteLength, this.attachmentPolicy.maxFileBytes);
    await this.execute(this.space, 'stage', {
      id,
      name: asset.name,
      mime: asset.mime,
      bytes: Array.from(asset.bytes),
    });
  }
  async readAsset(id: string) {
    const asset = await this.execute<{ name: string; mime: string; bytes: number[] } | null>(
      this.space,
      'readAsset',
      { id },
    );
    return asset ? { ...asset, bytes: Uint8Array.from(asset.bytes) } : undefined;
  }
  releaseAsset(id: string) {
    return this.execute<void>(this.space, 'releaseAsset', { id });
  }
  close() {
    this.relations.close();
    this.queries.close();
    this.channel?.close();
    this.listeners.clear();
  }
}
