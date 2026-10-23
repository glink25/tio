import {
  ConnectionAccessError,
  repairTree,
  supportedFormat,
  assertAccess,
  HostError,
  type SyncRepository,
} from '@tio/core';
import { merge } from '@tio/merge';
import { canonical } from '@tio/serialization';

import type { WorkspaceContentPort } from './content';
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
  constructor(
    readonly store: SyncRepository,
    readonly content: WorkspaceContentPort,
    readonly endpoint: string,
    readonly workspaceId: string,
  ) {}
  async run() {
    const ids = new Set(await this.content.list());
    const entries = await this.store.entries();
    for (const e of entries) ids.add(e.object.id);
    const assets: string[] = [],
      other: string[] = [];
    for (const id of ids) {
      const remote = await this.content.read(id);
      (remote?.type === 'asset' ||
      entries.some((e) => e.object.id === id && e.object.type === 'asset')
        ? assets
        : other
      ).push(id);
    }
    let assetsFailed = false;
    for (const path of [...assets.sort(), ...other.sort()]) {
      if (this.stopped) return;
      try {
        const originalRemote = await this.content.read(path);
        const remote = originalRemote;
        if (remote && (remote.workspaceId !== this.workspaceId || remote.id !== path))
          throw new Error('文件路径与对象身份不匹配');
        if (remote && !supportedFormat(remote)) {
          if (!(await this.store.get(remote.id))) await this.store.reconcile(remote, 0);
          throw new Error('对象版本高于当前支持版本，保留只读');
        }
        let entry = remote
          ? await this.store.get(remote.id)
          : entries.find((e) => e.object.id === path);
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
            ? merge(baseline, entry.object, remote)
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
        if (!supportedFormat(target)) throw new Error('对象版本不支持写入');
        if (result.recovered.length) await this.store.recover(result.recovered);
        let assetRepaired = false;
        if (target.type === 'asset') {
          let blob = await this.store.readAsset(target.id);
          const remoteBlob = await this.content.readAsset(target);
          if (!blob && remoteBlob) {
            blob = {
              name: target.filename ?? '',
              mime: target.mime ?? 'application/octet-stream',
              bytes: remoteBlob,
            };
            await this.store.stageAsset(target.id, blob);
            assetRepaired = true;
          }
          if (!blob && !target.deleted) throw new Error('附件二进制缺失');
          if (blob && !remoteBlob) await this.content.writeAsset(target, blob.bytes);
        } else if (assetsFailed) throw new Error('附件尚未完成同步，暂缓发布业务对象');
        let rev = entry?.revision ?? 0;
        if (assetRepaired || !entry || canonical(entry.object) !== canonical(target)) {
          const applied = await this.store.reconcile(target, rev);
          if (applied === null) {
            this.onDirty();
            continue;
          }
          rev = applied;
        }
        // Read again before writing: reduce external-editor races without claiming CAS.
        if (!remote || canonical(target) !== canonical(remote)) {
          const latest = await this.content.read(path);
          if (canonical(latest ?? null) !== canonical(originalRemote ?? null)) {
            this.onDirty();
            continue;
          }
          await this.content.write(target);
        }
        await this.store.acknowledge(target.id, this.endpoint, target, rev);
        const newer = await this.store.get(target.id);
        if (newer && newer.revision !== rev) this.onDirty();
      } catch (e) {
        if (e instanceof ConnectionAccessError || (e as Error).name === 'NotAllowedError') throw e;
        if (assets.includes(path)) assetsFailed = true;
        this.issues.push({
          id: path,
          path,
          code: e instanceof HostError ? e.code : 'object',
          message: (e as Error).message,
        });
      }
    }
    const current = await this.store.all();
    for (const repaired of repairTree(current)) {
      const original = current.find((x) => x.id === repaired.id)!;
      if (canonical(original) !== canonical(repaired)) {
        const e = await this.store.get(repaired.id);
        if (e) await this.store.reconcile(repaired, e.revision);
        this.onDirty();
      }
    }
  }
}
