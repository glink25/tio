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
  type WorkspaceSnapshot,
  type ObjectQuery,
  type ObjectPage,
  type TioObject,
} from '@tio/core';
import { ScanningQueries } from '@tio/database/repository';
import type { IDBPDatabase, IDBPObjectStore } from 'idb';

import { openHostDatabase } from './database';
export interface Entry {
  object: TioObject;
  revision: number;
  sync: Record<string, { base: TioObject; revision: number }>;
}
export class LocalStore {
  readonly storageCapabilities: RepositoryCapabilities = {
    persistence: 'atomic',
    offline: true,
    prefetch: 'none',
  };
  private queries = new ScanningQueries(this);
  queryNavigation(query: PageQuery) {
    return this.queries.navigation(query);
  }
  queryRecords(query: RecordQuery) {
    return this.queries.records(query);
  }
  scan(query: PageQuery) {
    return this.queries.scan(query);
  }

  db: Promise<IDBPDatabase>;
  private channel?: BroadcastChannel;
  private listeners = new Set<(event: WorkspaceEvent) => void>();
  private internalClientId = crypto.randomUUID();
  private internalSequence = 0;
  constructor(
    readonly instanceId: string,
    dbName = 'tio-workspaces',
    readonly access: AccessPolicy = fullAccess,
    readonly domain: Domain = createDomain(),
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
  async readObjects(ids: string[]): Promise<WorkspaceSnapshot> {
    const tx = (await this.db).transaction(['objects', 'settings']);
    const version = (await tx.objectStore('settings').get(this.key('$version'))) ?? 0;
    const entries: WorkspaceSnapshot['entries'] = [];
    const missing: string[] = [],
      denied: string[] = [];
    for (const id of ids) {
      const entry: Entry | undefined = await tx.objectStore('objects').get(this.key(id));
      const object = entry && readableObject(this.access, entry.object);
      if (entry && object) entries.push({ object, revision: entry.revision });
      else (entry ? denied : missing).push(id);
    }
    await tx.done;
    return { version, entries, missing, denied };
  }
  async queryObjects(query: ObjectQuery): Promise<ObjectPage> {
    if (!Number.isSafeInteger(query.limit) || query.limit < 1 || query.limit > 1000)
      throw new HostError('invalid', 'Query limit must be 1..1000');
    const tx = (await this.db).transaction(['objects', 'settings']);
    const version = (await tx.objectStore('settings').get(this.key('$version'))) ?? 0;
    const name = 'type' in query.scope ? 'type' : 'database';
    const scope = 'type' in query.scope ? query.scope.type : query.scope.databaseId;
    const range = IDBKeyRange.bound(
      [this.instanceId, scope, query.after ?? ''],
      [this.instanceId, scope, '\uffff'],
      !!query.after,
    );
    let cursor = await tx.objectStore('objects').index(name).openCursor(range);
    const entries: ObjectPage['entries'] = [];
    let next: string | undefined;
    while (cursor) {
      const entry: Entry = cursor.value;
      const object = readableObject(this.access, entry.object);
      if (object) {
        if (entries.length === query.limit) {
          next = entries[entries.length - 1].object.id;
          break;
        }
        entries.push({ object, revision: entry.revision });
      }
      cursor = await cursor.continue();
    }
    await tx.done;
    return { version, entries, next };
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
    const tx = (await this.db).transaction(
      ['objects', 'assets', 'settings', 'recovery'],
      'readwrite',
    );
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
      const workspaceId: string | undefined = await settings.get(this.key('$workspaceId'));
      if (workspaceId && request.changes.some((object) => object.workspaceId !== workspaceId))
        throw new HostError('invalid', 'Cross-workspace write');
      const needed = new Set(
        request.changes.flatMap((object) => [
          object.id,
          ...(object.databaseId ? [object.databaseId] : []),
        ]),
      );
      const previous: Entry[] = [];
      for (const id of needed) {
        const entry = await tx.objectStore('objects').get(this.key(id));
        if (entry) previous.push(entry);
      }
      const originals = new Map(previous.map((entry) => [entry.object.id, entry]));
      const effective = {
        ...request,
        changes: request.changes.map((object) =>
          preservePrivateFields(this.access, originals.get(object.id)?.object, object),
        ),
      };
      for (const object of effective.changes) {
        try {
          assertAccess(this.access, originals.get(object.id)?.object, object);
        } catch {
          throw new HostError('permission');
        }
      }
      const entries = applyCommit({ version, entries: previous }, effective, this.domain);
      const byId = new Map(entries.map((entry) => [entry.object.id, entry]));
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
        const entry = byId.get(object.id)!;
        const old = originals.get(object.id);
        await tx
          .objectStore('objects')
          .put(
            { ...entry, instanceId: this.instanceId, version: version + 1, sync: old?.sync ?? {} },
            this.key(object.id),
          );
      }
      const changed = request.changes.map((object) => byId.get(object.id)!);
      const result: CommitResult = { status: 'committed', version: version + 1, entries: changed };
      if (!workspaceId && request.changes.length)
        await settings.put(request.changes[0].workspaceId, this.key('$workspaceId'));
      if (request.recovery?.length)
        await this.appendRecovery(tx.objectStore('recovery'), request.recovery);
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
    const tx = (await this.db).transaction(['objects', 'settings']);
    const version = (await tx.objectStore('settings').get(this.key('$version'))) ?? 0;
    const changed: Entry[] = await tx
      .objectStore('objects')
      .index('version')
      .getAll(IDBKeyRange.bound([this.instanceId, since], [this.instanceId, Infinity], true));
    await tx.done;
    return {
      version,
      entries: changed.flatMap((entry) => {
        const object = readableObject(this.access, entry.object);
        return object ? [{ object, revision: entry.revision }] : [];
      }),
    };
  }
  async stageAsset(id: string, asset: AssetData) {
    if (!/^[a-zA-Z0-9_-]+$/.test(id) || asset.bytes.byteLength > 20 * 1024 * 1024)
      throw new HostError('invalid');
    await (await this.db).put('settings', asset, this.key('$asset/' + id));
  }
  async readAsset(id: string): Promise<AssetData | undefined> {
    const entry = await this.get(id);
    if (entry && !this.access.allows(resourceOf(entry.object), 'read'))
      throw new HostError('permission');
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
      const snapshot = await this.readObjects([id]);
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
      const snapshot = await this.readObjects([]);
      const result = await this.internalCommit({
        id: crypto.randomUUID(),
        expectedVersion: snapshot.version,
        changes: objects,
        assetIds: [...assets.keys()],
      });
      if (result.status === 'committed') return;
    }
  }
  async reconcile(
    value: TioObject,
    revision: number,
    recovery?: unknown[],
  ): Promise<number | null> {
    const snapshot = await this.readObjects([value.id]);
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
      recovery,
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

  private async appendRecovery(store: IDBPObjectStore<any, any, any, 'readwrite'>, value: unknown) {
    await store.add({
      instanceId: this.instanceId,
      value,
      date: Date.now(),
      bytes: new TextEncoder().encode(JSON.stringify(value)).length,
    });
    let cursor = await store.index('instance').openCursor(this.instanceId, 'prev');
    let count = 0,
      bytes = 0;
    while (cursor) {
      count++;
      bytes += cursor.value.bytes;
      // Always retain the newest recovery event; older events obey both retention budgets.
      if (count > 1 && (count > 100 || bytes > 8 * 1024 * 1024)) await cursor.delete();
      cursor = await cursor.continue();
    }
  }
  async recover(value: unknown) {
    const tx = (await this.db).transaction('recovery', 'readwrite');
    await this.appendRecovery(tx.store, value);
    await tx.done;
  }
  close() {
    void this.db.then((db) => db.close());
    this.channel?.close();
    this.listeners.clear();
  }
}

export { LocalCatalog } from './catalog';
export { RecoveryJournal } from './journal';
