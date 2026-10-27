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
export interface SyncIssue {
  id?: string;
  path: string;
  code: string;
  message: string;
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
          throw new Error('文件路径与对象身份不匹配');
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
            message: '已同步文件被移除；可恢复文件',
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
          try {
            assertAccess(access, remote, target);
          } catch {
            throw new HostError('permission');
          }
        }
        if (!this.types.supports(target)) throw new Error('对象版本不支持写入');
        let assetRepaired = false;
        if (target.type === 'asset') {
          let blob = await this.store.readAsset(target.id);
          if (!blob && !target.deleted && !this.lazyAssets) {
            const remoteBlob = await this.content.readAsset(target);
            if (!remoteBlob) throw new Error('Missing asset binary');
            blob = { name: target.filename ?? '', mime: target.mime!, bytes: remoteBlob };
            await this.store.stageAsset(target.id, blob);
            assetRepaired = true;
          }
          if (blob && !target.deleted && (!this.lazyAssets || !remote))
            await this.content.writeAsset(target, blob.bytes);
          if (this.lazyAssets && !remote && !target.deleted && !blob)
            throw new Error('Missing local asset binary');
        } else {
          for (const id of assetReferences(target))
            if (
              failedAssets.has(id) ||
              (!this.lazyAssets && !(await this.store.readAsset(id))) ||
              (this.lazyAssets && !snapshots.get(id) && !(await this.store.readAsset(id)))
            )
              throw new Error(`Asset unavailable: ${id}`);
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
    if ((error as { retryAt?: number }).retryAt) throw error;
    if (error instanceof ConnectionAccessError || (error as Error).name === 'NotAllowedError')
      throw error;
    this.issues.push({
      id,
      path: id,
      code: error instanceof HostError ? error.code : 'object',
      message: (error as Error).message,
    });
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
