import {
  applyCommit,
  fullAccess,
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
} from '@tio/core';
/** Reference host implementation. Only this host owns durable state in embedding tests. */
export class MemoryRepository implements WorkspaceRepository {
  private snapshot: WorkspaceSnapshot = { version: 0, entries: [] };
  private receipts = new Map<string, { signature: string; result: CommitResult }>();
  private staged = new Map<string, AssetData>();
  private assets = new Map<string, AssetData>();
  private listeners = new Set<(event: WorkspaceEvent) => void>();
  constructor(readonly access: AccessPolicy = fullAccess) {}
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
    const entries = applyCommit(this.snapshot, effective);
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
    this.assets = assets;
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
    if (!/^[a-zA-Z0-9_-]+$/.test(id) || asset.bytes.byteLength > 20 * 1024 * 1024)
      throw new HostError('invalid');
    this.staged.set(id, structuredClone(asset));
  }
  async readAsset(id: string) {
    return structuredClone(this.assets.get(id));
  }
  async releaseAsset(id: string) {
    this.staged.delete(id);
  }
}
