import {
  HostError,
  type SyncEntry,
  type TioObject,
  type AssetData,
  type CommitRequest,
} from '@tio/core';
import { canonical } from '@tio/serialization';

import { NativeRepository } from './native-repository';

export class ReplicaRepository extends NativeRepository {
  remoteAssets = true;
  readonly assetPolicy = 'on-demand' as const;
  private client = crypto.randomUUID();
  private sequence = 0;
  constructor(
    readonly instanceId: string,
    space: string,
    execute: <T>(space: string, action: string, args?: Record<string, unknown>) => Promise<T>,
  ) {
    super(space, execute, instanceId);
  }
  async entries() {
    return (await this.readSnapshot()).entries as SyncEntry[];
  }
  async all() {
    return (await this.entries()).map((e) => e.object);
  }
  async get(id: string) {
    return (await this.readObjects([id])).entries[0] as SyncEntry | undefined;
  }
  cacheAsset(id: string, asset: AssetData) {
    return this.execute<void>(this.space, 'cacheAsset', {
      id,
      name: asset.name,
      mime: asset.mime,
      bytes: Array.from(asset.bytes),
    });
  }
  acknowledge(id: string, endpoint: string, base: TioObject, revision: number) {
    return this.execute<void>(this.space, 'baseline', { id, endpoint, value: { base, revision } });
  }
  clearBaseline(id: string, endpoint: string) {
    return this.execute<void>(this.space, 'baseline', { id, endpoint });
  }
  recover(items: unknown) {
    return this.execute<void>(this.space, 'recover', { items });
  }
  private async internal(
    request: CommitRequest,
    baseline?: { endpoint: string; base: TioObject; clean: boolean },
  ) {
    const sequence = ++this.sequence;
    const result = await this.commit({ ...request, clientId: this.client, sequence }, baseline);
    if (result.status === 'committed') await this.acknowledgeCommits(this.client, sequence);
    return result;
  }
  reconcile(object: TioObject, revision: number, recovery?: unknown[]) {
    return this.receive(object, revision, recovery);
  }
  receiveRemote(
    object: TioObject,
    revision: number,
    endpoint: string,
    base: TioObject,
    recovery?: unknown[],
  ) {
    if (object.id !== base.id || object.workspaceId !== base.workspaceId)
      throw new HostError('invalid');
    return this.receive(object, revision, recovery, {
      endpoint,
      base,
      clean: canonical(object) === canonical(base),
    });
  }
  private async receive(
    object: TioObject,
    revision: number,
    recovery?: unknown[],
    baseline?: { endpoint: string; base: TioObject; clean: boolean },
  ) {
    const snapshot = await this.readObjects([object.id]);
    if ((snapshot.entries[0]?.revision ?? 0) !== revision) return null;
    const staged =
      object.type === 'asset' &&
      (await this.execute<boolean>(this.space, 'staged', { id: object.id }));
    const result = await this.internal(
      {
        id: crypto.randomUUID(),
        expectedVersion: snapshot.version,
        origin: 'sync',
        changes: [object],
        assetIds: staged ? [object.id] : [],
        recovery,
      },
      baseline,
    );
    return result.status === 'committed' ? revision + 1 : null;
  }
  async batch(objects: TioObject[], assets?: Map<string, Blob>, origin = 'host') {
    for (const [id, blob] of assets ?? [])
      await this.stageAsset(id, {
        name: '',
        mime: blob.type,
        bytes: new Uint8Array(await blob.arrayBuffer()),
      });
    for (;;) {
      const snapshot = await this.readObjects([]);
      const result = await this.internal({
        id: crypto.randomUUID(),
        expectedVersion: snapshot.version,
        origin,
        changes: objects,
        assetIds: [...(assets?.keys() ?? [])],
      });
      if (result.status === 'committed') return;
    }
  }
}
