import { DomainError } from '@tio/core';
import {
  ConnectionAccessError,
  repairTree,
  createDefaultRegistry,
  type ObjectRegistry,
  assertAccess,
  HostError,
  type SyncRepository,
} from '@tio/core';
import type { WorkspaceContentPort, TioObject } from '@tio/core';
import { merge } from '@tio/merge';
import { canonical } from '@tio/serialization';
import { StorageError } from '@tio/storage';
export interface SyncIssue {
  id?: string;
  path: string;
  code: 'permission' | 'missing' | 'object' | 'connection';
  error: unknown;
  retryAt?: number;
}
export function syncIssue(path: string, error: unknown, id?: string): SyncIssue {
  return {
    path,
    id,
    error,
    code:
      error instanceof ConnectionAccessError
        ? 'connection'
        : (error instanceof HostError || error instanceof StorageError) &&
            error.code === 'permission'
          ? 'permission'
          : error instanceof DomainError && error.code === 'missing'
            ? 'missing'
            : 'object',
    retryAt: error instanceof ConnectionAccessError ? error.retryAt : undefined,
  };
}
export class SyncCore {
  issues: SyncIssue[] = [];
  stopped = false;
  onDirty = () => {};
  onProgress = (_loaded: number, _total: number) => {};
  constructor(
    readonly store: SyncRepository,
    readonly content: WorkspaceContentPort,
    readonly endpoint: string,
    readonly workspaceId: string,
    readonly types: ObjectRegistry = createDefaultRegistry(),
  ) {}
  async run() {
    if (this.content.snapshot) {
      for (let attempt = 0; attempt < 3; attempt++) {
        const snapshot = await this.content.snapshot();
        const objects = new Map<string, TioObject>();
        const assets = new Map<string, Uint8Array>();
        const acknowledgements: Parameters<SyncRepository['acknowledge']>[] = [];
        const store = new Proxy(this.store, {
          get: (target, key) => {
            if (key === 'acknowledge')
              return async (...args: Parameters<SyncRepository['acknowledge']>) => {
                acknowledgements.push(args);
              };
            const value = Reflect.get(target, key);
            return typeof value === 'function' ? value.bind(target) : value;
          },
        });
        const content: WorkspaceContentPort = {
          attachmentPolicy: snapshot.content.attachmentPolicy,
          authorize: () => snapshot.content.authorize(),
          list: () => snapshot.content.list(),
          read: (id, options) => snapshot.content.read(id, options),
          readAsset: (object) => snapshot.content.readAsset(object),
          writeAsset: async (object, bytes) => {
            assets.set(object.id, bytes);
          },
          write: async (object) => {
            objects.set(object.id, object);
          },
        };
        const pass = new SyncCore(store, content, this.endpoint, this.workspaceId, this.types);
        Object.defineProperty(pass, 'stopped', { get: () => this.stopped });
        pass.lazyAssets = this.store.assetPolicy === 'on-demand';
        pass.onDirty = this.onDirty;
        pass.onProgress = this.onProgress;
        await pass.run();
        this.issues = pass.issues;
        if (this.stopped) return;
        if (await snapshot.publish([...objects.values()], assets)) {
          for (const args of acknowledgements) await this.store.acknowledge(...args);
          return;
        }
      }
      throw new Error('Remote version changed repeatedly; synchronization will retry');
    }
    return this.runDirect();
  }
  /** Initial replica acquisition: progressive local receipts, never remote publication. */
  async pull(targetId?: string) {
    this.issues = [];
    const content = this.content.snapshot ? (await this.content.snapshot()).content : this.content;
    if (this.stopped) return;
    const ids = new Set(await content.list());
    const visited = new Set<string>();
    const visiting = new Set<string>();
    const accepted = new Set<string>();
    let loaded = 0;
    this.onProgress(0, ids.size);
    const visit = async (id: string): Promise<boolean> => {
      if (this.stopped) return false;
      if (visited.has(id)) return accepted.has(id);
      // Parent cycles are handled only after the complete acquisition.
      if (visiting.has(id)) return true;
      if (!ids.has(id)) return false;
      visiting.add(id);
      try {
        const remote = await content.read(id);
        if (this.stopped) return false;
        if (!remote) throw new DomainError('missing');
        if (remote.id !== id || remote.workspaceId !== this.workspaceId)
          throw new DomainError('identity');
        let assetStaged = false;
        if (remote.parentId) await visit(remote.parentId);
        if (remote.databaseId && !(await visit(remote.databaseId)))
          throw new DomainError('missing', 'Database dependency unavailable');
        if (!remote.deleted) {
          for (const assetId of assetReferences(remote))
            if (!(await visit(assetId)) || (await this.store.get(assetId))?.object.type !== 'asset')
              throw new DomainError('asset-pending');
          if (remote.type === 'asset' && this.store.assetPolicy !== 'on-demand') {
            if (!(await this.store.readAsset(id))) {
              const bytes = await content.readAsset(remote);
              if (!bytes) throw new DomainError('asset-missing');
              if (this.stopped) return false;
              await this.store.stageAsset(id, {
                name: remote.filename ?? '',
                mime: remote.mime!,
                bytes,
              });
              assetStaged = true;
            }
          }
        }
        for (let attempt = 0; attempt < 32; attempt++) {
          if (this.stopped) return false;
          const entry = await this.store.get(id);
          if (this.stopped) return false;
          const base = entry?.sync[this.endpoint]?.base;
          const result = entry
            ? merge(base, entry.object, remote, this.types)
            : { merged: remote, recovered: [] };
          if (
            !assetStaged &&
            canonical(entry?.object) === canonical(result.merged) &&
            canonical(base) === canonical(remote)
          ) {
            accepted.add(id);
            return true;
          }
          if (
            (await this.store.receiveRemote(
              result.merged,
              entry?.revision ?? 0,
              this.endpoint,
              remote,
              result.recovered,
            )) !== null
          ) {
            if (canonical(result.merged) !== canonical(remote)) this.onDirty();
            accepted.add(id);
            return true;
          }
        }
        throw new HostError('conflict');
      } catch (error) {
        this.issue(id, error);
        return false;
      } finally {
        visiting.delete(id);
        visited.add(id);
        this.onProgress(++loaded, ids.size);
      }
    };
    await visit(this.workspaceId);
    if (!accepted.has(this.workspaceId) && !this.stopped && !ids.has(this.workspaceId))
      this.issue(this.workspaceId, new DomainError('missing'));
    if (targetId) await visit(targetId);
    for (const id of [...ids].sort()) await visit(id);
    if (this.stopped || this.issues.length) return;
    const entries = await this.store.entries();
    const objects = new Map(entries.map((entry) => [entry.object.id, entry.object]));
    if (
      entries.some(
        (entry) => canonical(entry.object) !== canonical(entry.sync[this.endpoint]?.base),
      )
    )
      this.onDirty();
    for (const entry of entries) {
      if (entry.sync[this.endpoint] && !ids.has(entry.object.id))
        this.issue(entry.object.id, new DomainError('missing'));
      if (!entry.object.deleted && entry.object.parentId && !objects.has(entry.object.parentId))
        this.issue(entry.object.id, new DomainError('missing', 'Parent unavailable'));
    }
    if (this.issues.length) return;
    const originals = new Map(entries.map((entry) => [entry.object.id, entry]));
    for (const object of repairTree(entries.map((entry) => entry.object))) {
      const original = originals.get(object.id)!;
      if (this.stopped) return;
      if (object === original.object) continue;
      if (
        (await this.store.reconcile(object, original.revision, [
          { reason: 'parent-cycle', object: original.object },
        ])) === null
      )
        throw new HostError('conflict');
      this.onDirty();
    }
  }
  private lazyAssets = false;
  private async runDirect() {
    const ids = new Set(await this.content.list());
    const entries = await this.store.entries();
    for (const e of entries) ids.add(e.object.id);
    const local = new Map(entries.map((entry) => [entry.object.id, entry]));
    const snapshots = new Map<string, TioObject | undefined>();
    let loaded = 0;
    this.onProgress(loaded, ids.size);
    for (const id of ids) {
      if (this.stopped) return;
      try {
        snapshots.set(id, await this.content.read(id));
      } catch (error) {
        this.issue(id, error);
      }
      this.onProgress(++loaded, ids.size);
    }
    const ordered = [...snapshots.keys()].sort(
      (a, b) =>
        Number((snapshots.get(b) ?? local.get(b)?.object)?.type === 'asset') -
          Number((snapshots.get(a) ?? local.get(a)?.object)?.type === 'asset') ||
        a.localeCompare(b),
    );
    const failedAssets = new Set<string>();
    let treeChanged = false;
    for (const path of ordered) {
      if (this.stopped) return;
      try {
        const originalRemote = snapshots.get(path);
        const remote = originalRemote;
        if (remote && (remote.workspaceId !== this.workspaceId || remote.id !== path))
          throw new DomainError('identity', '文件路径与对象身份不匹配');
        if (remote && !this.types.supports(remote)) {
          if (!(await this.store.get(remote.id))) await this.store.reconcile(remote, 0);
          throw new Error('未注册的对象类型，保留只读');
        }
        let entry = remote ? await this.store.get(remote.id) : local.get(path);
        if (!remote && entry?.object.deleted && entry.sync[this.endpoint]?.base.deleted) continue;
        if (!remote && entry?.sync[this.endpoint]) {
          this.issues.push({
            id: entry.object.id,
            path,
            code: 'missing',
            error: new DomainError('missing'),
          });
          continue;
        }
        if (!remote && !entry) continue;
        if (entry) entry = await this.store.get(entry.object.id);
        const baseline = entry?.sync[this.endpoint]?.base;
        const result =
          remote && entry
            ? merge(baseline, entry.object, remote, this.types)
            : { merged: remote ?? entry!.object, recovered: [], warnings: [] };
        const target = result.merged;
        // Authorization is refreshed for each publication; denied local content stays intact.
        if (!remote || canonical(target) !== canonical(remote)) {
          const access = await this.content.authorize();
          assertAccess(access, remote, target);
        }
        if (!this.types.supports(target))
          throw new DomainError('future-version', '对象版本不支持写入');
        let assetRepaired = false;
        if (target.type === 'asset') {
          let blob = await this.store.readAsset(target.id);
          if (!blob && !target.deleted && !this.lazyAssets) {
            const remoteBlob = await this.content.readAsset(target);
            if (!remoteBlob) throw new DomainError('asset-missing');
            blob = { name: target.filename ?? '', mime: target.mime!, bytes: remoteBlob };
            await this.store.stageAsset(target.id, blob);
            assetRepaired = true;
          }
          if (blob && !target.deleted && (!this.lazyAssets || !remote))
            await this.content.writeAsset(target, blob.bytes);
          if (this.lazyAssets && !remote && !target.deleted && !blob)
            throw new DomainError('asset-missing');
        } else {
          for (const id of assetReferences(target))
            if (
              failedAssets.has(id) ||
              (!this.lazyAssets && !(await this.store.readAsset(id))) ||
              (this.lazyAssets && !snapshots.get(id) && !(await this.store.readAsset(id)))
            )
              throw new DomainError('asset-pending', `Asset unavailable: ${id}`);
        }
        let rev = entry?.revision ?? 0;
        if (assetRepaired || !entry || canonical(entry.object) !== canonical(target)) {
          const applied = await this.store.reconcile(target, rev, result.recovered);
          if (applied === null) {
            this.onDirty();
            continue;
          }
          rev = applied;
          if (
            ['page', 'database'].includes(target.type) &&
            (!entry || entry.object.parentId !== target.parentId)
          )
            treeChanged = true;
        }
        // Read again before writing: reduce external-editor races without claiming CAS.
        if (!remote || canonical(target) !== canonical(remote)) {
          const latest = await this.content.read(path, { fresh: true });
          if (canonical(latest ?? null) !== canonical(originalRemote ?? null)) {
            this.onDirty();
            continue;
          }
          await this.content.write(target);
        }
        if (
          entry?.sync[this.endpoint]?.revision !== rev ||
          canonical(baseline) !== canonical(target)
        )
          await this.store.acknowledge(target.id, this.endpoint, target, rev);
        const newer = await this.store.get(target.id);
        if (newer && newer.revision !== rev) this.onDirty();
      } catch (error) {
        if ((snapshots.get(path) ?? local.get(path)?.object)?.type === 'asset')
          failedAssets.add(path);
        this.issue(path, error);
      }
    }
    if (treeChanged && !this.issues.length && !this.stopped) {
      const entries = await this.store.entries();
      const originals = new Map(entries.map((entry) => [entry.object.id, entry]));
      for (const object of repairTree(entries.map((entry) => entry.object))) {
        const original = originals.get(object.id)!;
        if (object === original.object) continue;
        await this.store.reconcile(object, original.revision, [
          { reason: 'parent-cycle', object: original.object },
        ]);
        this.onDirty();
      }
    }
  }
  private issue(id: string, error: unknown) {
    if ((error as { retryAt?: number } | null)?.retryAt) throw error;
    if (
      error instanceof ConnectionAccessError ||
      (error instanceof StorageError && error.code === 'permission')
    )
      throw error;
    this.issues.push(syncIssue(id, error, id));
  }
}
function assetReferences(value: unknown): Set<string> {
  const ids = new Set<string>();
  const visit = (value: unknown) => {
    if (typeof value === 'string' && value.startsWith('asset:')) ids.add(value.slice(6));
    else if (Array.isArray(value)) value.forEach(visit);
    else if (value && typeof value === 'object') Object.values(value).forEach(visit);
  };
  visit(value);
  return ids;
}
