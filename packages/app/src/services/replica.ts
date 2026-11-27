import { HostError, type SearchQuery, type PageQuery, type WorkspaceContentPort } from '@tio/core';
import { WorkerSearch } from '@tio/database/search-browser';

import type { ReplicaStorage } from '../platform';

export function createReplica(
  Backend: new (instance: string, space: string) => ReplicaStorage,
  content: (workspaceId: string) => WorkspaceContentPort | undefined,
  isLive: () => boolean,
) {
  return class extends Backend {
    declare readonly attachmentPolicy: import('@tio/core').AssetPolicy;
    constructor(
      instanceId: string,
      readonly workspaceId: string,
    ) {
      super(instanceId, workspaceId);
      this.attachmentPolicy = content(workspaceId)?.attachmentPolicy ?? this.attachmentPolicy;
      this.remoteAssets = true;
      this.storageCapabilities.prefetch = 'all';
    }
    protected relationsReady() {
      return this.complete;
    }
    async markComplete() {
      if (isLive()) {
        await this.setComplete();
        this.relations.invalidate('ready');
        // Versioned notification also refreshes queries and readiness in other windows.
        await this.batch([], undefined, 'sync');
      }
    }
    get complete(): boolean {
      return this.storageComplete;
    }
    get contentReady(): boolean {
      return this.complete;
    }
    private requireComplete() {
      if (!this.complete) throw new HostError('pending');
    }
    override queryRecords(query: import('@tio/core').RecordQuery) {
      this.requireComplete();
      return super.queryRecords(query);
    }
    override queryObjects(query: import('@tio/core').ObjectQuery) {
      this.requireComplete();
      return super.queryObjects(query);
    }
    private workerSearch: WorkerSearch = new WorkerSearch(this);
    search(query: SearchQuery): Promise<import('@tio/core').SearchPage> {
      this.requireComplete();
      return this.workerSearch.search(query);
    }
    override close() {
      this.workerSearch.close();
      super.close();
    }
    cachedAsset(id: string) {
      return super.readAsset(id);
    }
    override scan(query: PageQuery) {
      this.requireComplete();
      return super.scan(query);
    }
    override async readAsset(id: string) {
      const cached = await super.readAsset(id);
      if (cached) return cached;
      const entry = await this.get(id);
      if (!entry || entry.object.deleted) return undefined;
      const bytes = await content(this.workspaceId)?.readAsset(entry.object);
      if (!bytes) throw new HostError('unavailable', 'Remote attachment is unavailable');
      const asset = {
        name: entry.object.filename ?? '',
        mime: entry.object.mime ?? 'application/octet-stream',
        bytes,
      };
      await this.cacheAsset(id, asset);
      return asset;
    }
  };
}

export function replicaSyncStore<
  T extends ReplicaStorage & { cachedAsset: ReplicaStorage['readAsset'] },
>(replica: T) {
  return new Proxy(replica, {
    get(target, key) {
      if (key === 'readAsset') return target.cachedAsset.bind(target);
      const value = Reflect.get(target, key);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
}
