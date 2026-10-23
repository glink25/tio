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
  type WorkspaceSnapshot,
  type TioObject,
} from '@tio/core';
import type { IDBPDatabase } from 'idb';

import { openHostDatabase } from './database';
export interface Entry {
  object: TioObject;
  revision: number;
  sync: Record<string, { base: TioObject; revision: number }>;
}
export class LocalStore {
  db: Promise<IDBPDatabase>;
  private channel?: BroadcastChannel;
  private listeners = new Set<(event: WorkspaceEvent) => void>();
  private internalClientId = crypto.randomUUID();
  private internalSequence = 0;
  constructor(
    readonly instanceId: string,
    dbName = 'tio-workspaces',
    readonly access: AccessPolicy = fullAccess,
  ) {
    this.db = openHostDatabase(dbName);
    if (typeof BroadcastChannel !== 'undefined') {
      this.channel = new BroadcastChannel(dbName);
      this.channel.onmessage = (e) => {
        if (e.data.instanceId === instanceId) this.emit(e.data.event, false);
      };
    }
  }
  private key(id: string) {
    return `${this.instanceId}/${id}`;
  }
  subscribe = (fn: (event: WorkspaceEvent) => void) => {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  };
  private emit(event: WorkspaceEvent, broadcast = true) {
    for (const fn of this.listeners) fn(event);
    if (broadcast) this.channel?.postMessage({ instanceId: this.instanceId, event });
  }
  async entries(): Promise<Entry[]> {
    const db = await this.db;
    return db.getAll(
      'objects',
      IDBKeyRange.bound(this.instanceId + '/', this.instanceId + '/\uffff'),
    );
  }
  async all() {
    return (await this.entries()).map((e) => e.object);
  }
  async get(id: string): Promise<Entry | undefined> {
    return (await this.db).get('objects', this.key(id));
  }
  subscribeChanges = this.subscribe;
  async readSnapshot(): Promise<WorkspaceSnapshot> {
    const tx = (await this.db).transaction(['objects', 'settings']);
    const entries: Entry[] = await tx
      .objectStore('objects')
      .getAll(IDBKeyRange.bound(this.instanceId + '/', this.instanceId + '/\uffff'));
    const version = (await tx.objectStore('settings').get(this.key('$version'))) ?? 0;
    await tx.done;
    return {
      version,
      entries: entries.flatMap(({ object, revision }) => {
        const readable = readableObject(this.access, object);
        return readable ? [{ object: readable, revision }] : [];
      }),
    };
  }
  private readableResult(result: CommitResult): CommitResult {
    if (result.status !== 'committed') return result;
    return {
      ...result,
      entries: result.entries.flatMap((entry) => {
        const object = readableObject(this.access, entry.object);
        return object ? [{ ...entry, object }] : [];
      }),
    };
  }
  async getCommitResult(id: string): Promise<CommitResult | undefined> {
    const receipt = (await (await this.db).get('settings', this.key('$commit/' + id)))?.result;
    return receipt ? this.readableResult(receipt) : undefined;
  }
  async commit(request: CommitRequest): Promise<CommitResult> {
    const tx = (await this.db).transaction(['objects', 'assets', 'settings'], 'readwrite');
    try {
      const settings = tx.objectStore('settings');
      const signature = JSON.stringify(request);
      const receipt = await settings.get(this.key('$commit/' + request.id));
      if (receipt) {
        if (receipt.signature !== signature) throw new HostError('invalid', 'Commit ID reused');
        await tx.done;
        return this.readableResult(receipt.result);
      }
      if (
        request.clientId &&
        request.sequence &&
        request.sequence <= ((await settings.get(this.key('$watermark/' + request.clientId))) ?? 0)
      ) {
        await tx.done;
        return { status: 'compacted', version: (await this.readSnapshot()).version };
      }
      const version = (await settings.get(this.key('$version'))) ?? 0;
      if (version !== request.expectedVersion) {
        await tx.done;
        return { status: 'conflict', version };
      }
      const previous: Entry[] = await tx
        .objectStore('objects')
        .getAll(IDBKeyRange.bound(this.instanceId + '/', this.instanceId + '/\uffff'));
      const effective = {
        ...request,
        changes: request.changes.map((object) =>
          preservePrivateFields(
            this.access,
            previous.find((e) => e.object.id === object.id)?.object,
            object,
          ),
        ),
      };
      for (const object of effective.changes) {
        try {
          assertAccess(
            this.access,
            previous.find((e) => e.object.id === object.id)?.object,
            object,
          );
        } catch {
          throw new HostError('permission');
        }
      }
      const entries = applyCommit({ version, entries: previous }, effective);
      for (const id of request.assetIds) {
        const staged = await settings.get(this.key('$asset/' + id));
        if (staged)
          await tx
            .objectStore('assets')
            .put(new Blob([staged.bytes], { type: staged.mime }), this.key(id));
        else if (!(await tx.objectStore('assets').get(this.key(id))))
          throw new HostError('invalid', 'Missing staged asset');
      }
      for (const object of request.changes) {
        if (
          object.type === 'asset' &&
          !object.deleted &&
          !(await tx.objectStore('assets').get(this.key(object.id)))
        )
          throw new HostError('invalid', 'Missing asset');
        const entry = entries.find((e) => e.object.id === object.id)!;
        const old = previous.find((e) => e.object.id === object.id);
        await tx
          .objectStore('objects')
          .put({ ...entry, sync: old?.sync ?? {} }, this.key(object.id));
      }
      const changed = entries.filter((e) => request.changes.some((o) => o.id === e.object.id));
      const result: CommitResult = { status: 'committed', version: version + 1, entries: changed };
      for (const entry of changed)
        await settings.put(
          { version: version + 1, entry },
          this.key('$changes/' + entry.object.id),
        );
      await settings.put(version + 1, this.key('$version'));
      await settings.put(
        { signature, result, clientId: request.clientId, sequence: request.sequence },
        this.key('$commit/' + request.id),
      );
      for (const id of request.assetIds) await settings.delete(this.key('$asset/' + id));
      await tx.done;
      this.emit({
        version: version + 1,
        commitId: request.id,
        origin: request.origin ?? 'host',
        changedIds: request.changes.map((o) => o.id),
      });
      return this.readableResult(result);
    } catch (error) {
      try {
        tx.abort();
      } catch {
        /* Already aborted. */
      }
      await tx.done.catch(() => {});
      throw error;
    }
  }
  async acknowledgeCommits(clientId: string, sequence: number) {
    const tx = (await this.db).transaction('settings', 'readwrite');
    const watermark = (await tx.store.get(this.key('$watermark/' + clientId))) ?? 0;
    await tx.store.put(Math.max(watermark, sequence), this.key('$watermark/' + clientId));
    let cursor = await tx.store.openCursor(
      IDBKeyRange.bound(this.key('$commit/'), this.key('$commit/\uffff')),
    );
    while (cursor) {
      if (cursor.value.clientId === clientId && cursor.value.sequence <= sequence)
        await cursor.delete();
      cursor = await cursor.continue();
    }
    await tx.done;
  }
  async readChanges(since: number): Promise<WorkspaceSnapshot> {
    const tx = (await this.db).transaction('settings');
    const version = (await tx.store.get(this.key('$version'))) ?? 0;
    const changes: { version: number; entry: WorkspaceSnapshot['entries'][number] }[] =
      await tx.store.getAll(IDBKeyRange.bound(this.key('$changes/'), this.key('$changes/\uffff')));
    await tx.done;
    return {
      version,
      entries: changes
        .filter((c) => c.version > since)
        .flatMap((c) => {
          const object = readableObject(this.access, c.entry.object);
          return object ? [{ ...c.entry, object }] : [];
        }),
    };
  }
  async stageAsset(id: string, asset: AssetData) {
    if (!/^[a-zA-Z0-9_-]+$/.test(id) || asset.bytes.byteLength > 20 * 1024 * 1024)
      throw new HostError('invalid');
    await (await this.db).put('settings', asset, this.key('$asset/' + id));
  }
  async readAsset(id: string): Promise<AssetData | undefined> {
    const db = await this.db;
    const blob: Blob | undefined = await db.get('assets', this.key(id));
    if (blob) return { name: '', mime: blob.type, bytes: new Uint8Array(await blob.arrayBuffer()) };
    return undefined;
  }
  async releaseAsset(id: string) {
    await (await this.db).delete('settings', this.key('$asset/' + id));
  }
  private async internalCommit(request: CommitRequest) {
    const sequence = ++this.internalSequence;
    const result = await this.commit({
      ...request,
      clientId: this.internalClientId,
      sequence,
    });
    if (result.status === 'committed')
      await this.acknowledgeCommits(this.internalClientId, sequence);
    return result;
  }
  /** Host writes use the same commit path and compact their acknowledged receipts. */
  async put(value: TioObject, expectedRevision?: number) {
    return this.change(value.id, () => value, expectedRevision);
  }
  async change(
    id: string,
    fn: (current: TioObject | undefined) => TioObject,
    expectedRevision?: number,
  ): Promise<TioObject> {
    for (;;) {
      const snapshot = await this.readSnapshot();
      const old = snapshot.entries.find((e) => e.object.id === id);
      if (expectedRevision !== undefined && (old?.revision ?? 0) !== expectedRevision)
        throw new Error('内容已在另一个窗口更新，请重试');
      const value = fn(old && structuredClone(old.object));
      const result = await this.internalCommit({
        id: crypto.randomUUID(),
        expectedVersion: snapshot.version,
        changes: [value],
        assetIds: [],
      });
      if (result.status === 'committed') return value;
    }
  }
  async batch(objects: TioObject[], assets = new Map<string, Blob>()) {
    for (const [id, blob] of assets)
      await this.stageAsset(id, {
        name: '',
        mime: blob.type,
        bytes: new Uint8Array(await blob.arrayBuffer()),
      });
    for (;;) {
      const snapshot = await this.readSnapshot();
      const result = await this.internalCommit({
        id: crypto.randomUUID(),
        expectedVersion: snapshot.version,
        changes: objects,
        assetIds: [...assets.keys()],
      });
      if (result.status === 'committed') return;
    }
  }
  async reconcile(value: TioObject, revision: number): Promise<number | null> {
    const snapshot = await this.readSnapshot();
    if ((snapshot.entries.find((e) => e.object.id === value.id)?.revision ?? 0) !== revision)
      return null;
    const asset =
      value.type === 'asset'
        ? ((await this.readAsset(value.id)) ??
          (await (await this.db).get('settings', this.key('$asset/' + value.id))))
        : undefined;
    const result = await this.internalCommit({
      id: crypto.randomUUID(),
      expectedVersion: snapshot.version,
      changes: [value],
      origin: 'sync',
      assetIds: asset ? [value.id] : [],
    });
    return result.status === 'committed' ? revision + 1 : null;
  }
  /** ACK records the actual uploaded snapshot; later edits remain dirty. */
  async acknowledge(id: string, endpoint: string, base: TioObject, revision: number) {
    const db = await this.db;
    const tx = db.transaction('objects', 'readwrite');
    const key = this.key(id);
    const entry: Entry = await tx.store.get(key);
    if (entry) {
      entry.sync[endpoint] = { base, revision };
      await tx.store.put(entry, key);
    }
    await tx.done;
  }
  async clearBaseline(id: string, endpoint: string) {
    const db = await this.db;
    const tx = db.transaction('objects', 'readwrite');
    const key = this.key(id);
    const e: Entry = await tx.store.get(key);
    delete e.sync[endpoint];
    await tx.store.put(e, key);
    await tx.done;
  }
  async blob(id: string): Promise<Blob | undefined> {
    return (await this.db).get('assets', this.key(id));
  }

  async recover(value: unknown) {
    const db = await this.db;
    const tx = db.transaction('recovery', 'readwrite');
    await tx.store.add({ instanceId: this.instanceId, value, date: Date.now() });
    const keys = await tx.store.getAllKeys();
    for (const key of keys.slice(0, -100)) await tx.store.delete(key);
    await tx.done;
  }
  close() {
    void this.db.then((db) => db.close());
    this.channel?.close();
    this.listeners.clear();
  }
}

export { LocalCatalog } from './catalog';
