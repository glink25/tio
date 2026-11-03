import {
  HostError,
  navigationObject,
  recordTitle,
  type MentionQuery,
  type MentionPage,
  type MentionReference,
  visibility,
  type WorkspaceRepository,
  type PageQuery,
  type RecordQuery,
  type WorkspaceSnapshot,
  type QueryPage,
  type ProjectionQuery,
  type TioObject,
} from '@tio/core';

import { queryRecords } from './index';

export function pageEntries(snapshot: WorkspaceSnapshot, query: PageQuery) {
  if (!Number.isSafeInteger(query.limit) || query.limit < 1 || query.limit > 1000)
    throw new HostError('invalid', 'Query limit must be 1..1000');
  const matched = snapshot.entries
    .filter((e) => !query.after || e.object.id > query.after)
    .sort((a, b) => (a.object.id < b.object.id ? -1 : a.object.id > b.object.id ? 1 : 0));
  const entries = matched.slice(0, query.limit);
  return {
    version: snapshot.version,
    entries,
    next: matched.length > entries.length ? entries.at(-1)!.object.id : undefined,
  };
}
/** Shared query semantics over provider-owned projections; never reads a full body snapshot. */
export class ProjectionQueries {
  private worker?: Worker;
  private sequence = 0;
  private pending = new Map<
    number,
    { resolve: (ids: string[]) => void; reject: (error: Error) => void }
  >();
  close() {
    this.stop?.();
    this.orders.clear();
    this.worker?.terminate();
    this.worker = undefined;
    this.stop = undefined;
    for (const request of this.pending.values()) request.reject(new HostError('closed'));
    this.pending.clear();
  }
  constructor(
    private repository: Pick<
      WorkspaceRepository,
      'readObjects' | 'readRecordOrder' | 'subscribeChanges' | 'queryAccessVersion'
    > & {
      readProjection(query: ProjectionQuery): Promise<QueryPage>;
      readonly queryIndexState?: import('@tio/core').QueryIndexState;
    },
  ) {}
  private stop?: () => void;
  private epoch = 0;
  private plainOrders = new Map<string, string>();
  private orders = new Map<string, Promise<{ version: number; ids: string[] }>>();
  private async order(query: RecordQuery) {
    this.stop ??= this.repository.subscribeChanges((event) => {
      this.epoch++;
      for (const [key, previous] of this.orders) {
        const databaseId = this.plainOrders.get(key);
        if (!databaseId || event.changedIds.length > 1000) {
          this.orders.delete(key);
          continue;
        }
        const update = previous
          .then(async (order) => {
            const page = await this.repository.readProjection({ ids: event.changedIds });
            if (
              page.version !== event.version ||
              page.entries.some((e) => e.projection.type !== 'record')
            )
              throw new HostError('conflict');
            const ids = new Set(order.ids);
            event.changedIds.forEach((id) => ids.delete(id));
            for (const { projection: o } of page.entries)
              if (o.databaseId === databaseId && !o.deleted) ids.add(o.id);
            return { version: page.version, ids: [...ids].sort() };
          })
          .catch((error) => {
            if (this.orders.get(key) === update) this.orders.delete(key);
            throw error;
          });
        // Invalidated caches may no longer have a consumer.
        void update.catch(() => {});
        this.orders.set(key, update);
      }
    });
    const accessVersion = await this.repository.queryAccessVersion?.();
    const key = JSON.stringify([
      accessVersion,
      query.databaseId,
      query.view?.filters,
      query.view?.sorts,
      query.text,
    ]);
    if (!query.text && !query.view?.filters?.length && !query.view?.sorts?.length)
      this.plainOrders.set(key, query.databaseId);
    let work = this.orders.get(key);
    if (!work) {
      const epoch = this.epoch;
      work = this.buildOrder(query)
        .then((result) => {
          if (epoch !== this.epoch) throw new HostError('conflict');
          return result;
        })
        .catch((error) => {
          if (this.orders.get(key) === work) this.orders.delete(key);
          throw error;
        });
      this.orders.set(key, work);
      while (this.orders.size > 4) {
        const key = this.orders.keys().next().value!;
        this.orders.delete(key);
        this.plainOrders.delete(key);
      }
    }
    return work;
  }
  async window(
    query: import('@tio/core').RecordWindowQuery,
  ): Promise<import('@tio/core').RecordWindow> {
    if (
      !Number.isSafeInteger(query.offset) ||
      query.offset < 0 ||
      !Number.isSafeInteger(query.limit) ||
      query.limit < 1 ||
      query.limit > 1000 ||
      (query.expectedVersion !== undefined &&
        (!Number.isSafeInteger(query.expectedVersion) || query.expectedVersion < 0))
    )
      throw new HostError('invalid');
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const accessVersion = await this.repository.queryAccessVersion?.();
        const order = await this.order(query);
        if (query.expectedVersion !== undefined && order.version !== query.expectedVersion)
          throw new HostError('conflict');
        const page = await this.repository.readProjection({
          ids: order.ids.slice(query.offset, query.offset + query.limit),
        });
        if (
          page.version !== order.version ||
          accessVersion !== (await this.repository.queryAccessVersion?.())
        ) {
          this.orders.clear();
          throw new HostError('conflict');
        }
        const byId = new Map(page.entries.map((e) => [e.projection.id, e]));
        return {
          version: page.version,
          offset: query.offset,
          total: order.ids.length,
          entries: order.ids.slice(query.offset, query.offset + query.limit).flatMap((id) => {
            const entry = byId.get(id);
            return entry
              ? [{ projection: entry.projection, revision: entry.revision, references: [] }]
              : [];
          }),
        };
      } catch (error) {
        if (
          !(error instanceof HostError) ||
          error.code !== 'conflict' ||
          query.expectedVersion !== undefined ||
          attempt === 2
        )
          throw error;
        this.orders.clear();
      }
    }
    throw new HostError('conflict');
  }
  private async snapshot(query: ProjectionQuery = {}): Promise<WorkspaceSnapshot> {
    const page = await this.repository.readProjection(query);
    return {
      ...page,
      entries: page.entries.map(({ projection: object, revision }) => ({ object, revision })),
    };
  }
  private async navigationSnapshot() {
    for (let attempt = 0; attempt < 3; attempt++) {
      const pages = await Promise.all(
        ['workspace', 'page', 'database', 'databaseView'].map((type) => this.snapshot({ type })),
      );
      if (pages.every((page) => page.version === pages[0].version))
        return { version: pages[0].version, entries: pages.flatMap((page) => page.entries) };
    }
    throw new HostError('conflict', 'Navigation changed during query');
  }
  private evaluate(
    objects: TioObject[],
    database: TioObject,
    view: TioObject,
    text?: string,
  ): Promise<string[]> {
    if (typeof Worker === 'undefined')
      return Promise.resolve(
        queryRecords(objects, database, view)
          .filter(
            (o) =>
              !text ||
              JSON.stringify(o.properties).toLocaleLowerCase().includes(text.toLocaleLowerCase()),
          )
          .map((o) => o.id),
      );
    if (!this.worker) {
      this.worker = new Worker(new URL('./query-worker.ts', import.meta.url), { type: 'module' });
      this.worker.onmessage = ({ data }) => {
        const request = this.pending.get(data.id);
        this.pending.delete(data.id);
        if (data.error) request?.reject(new HostError('invalid', data.error));
        else request?.resolve(data.ids);
      };
      this.worker.onerror = () => this.close();
    }
    const id = ++this.sequence;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.worker!.postMessage({ id, objects, database, view, text });
    });
  }
  async metadata(ids: string[]) {
    if (!this.repository.readObjects) throw new HostError('unsupported');
    const result = await this.snapshot({ ids });
    const databases = [
      ...new Set(
        result.entries.flatMap(({ object }) =>
          object.type === 'record' && object.databaseId ? [object.databaseId] : [],
        ),
      ),
    ];
    const snapshot = databases.length
      ? await this.snapshot({ ids: [...new Set([...ids, ...databases])] })
      : result;
    const selected = new Set(ids);
    return {
      ...snapshot,
      missing: snapshot.missing?.filter((id) => selected.has(id)),
      denied: snapshot.denied?.filter((id) => selected.has(id)),
      entries: snapshot.entries
        .filter((e) => selected.has(e.object.id))
        .map((e) => ({
          ...e,
          object: {
            ...navigationObject(e.object),
            ...(e.object.type === 'record'
              ? {
                  title: recordTitle(
                    e.object,
                    snapshot.entries.map((entry) => entry.object),
                  ),
                }
              : {}),
          },
        })),
    };
  }

  async mentions(query: MentionQuery): Promise<MentionPage> {
    let after: string | undefined;
    if (query.after) {
      try {
        const cursor = JSON.parse(query.after);
        if (
          cursor.text !== query.text ||
          cursor.kind !== query.kind ||
          typeof cursor.id !== 'string'
        )
          throw new HostError('invalid');
        after = cursor.id;
      } catch {
        throw new HostError('invalid', 'Invalid mention cursor');
      }
    }
    const snapshot = await this.snapshot();
    const objects = snapshot.entries.map((e) => e.object);
    const visible = visibility(objects);
    const byId = new Map(objects.map((o) => [o.id, o]));
    const title = (o: TioObject) =>
      o.type === 'record'
        ? recordTitle(o, [byId.get(o.databaseId ?? '')!].filter(Boolean))
        : o.title || o.name || 'Untitled';
    const page = pageEntries(
      {
        ...snapshot,
        entries: snapshot.entries.filter(({ object }) => {
          if (
            !['page', 'database', 'record'].includes(object.type) ||
            (query.kind && object.type !== query.kind) ||
            !visible(object)
          )
            return false;
          return (title(object) ?? '').toLocaleLowerCase().includes(query.text.toLocaleLowerCase());
        }),
      },
      { ...query, after },
    );
    return {
      items: page.entries.map(({ object }) => {
        const reference = {
          workspaceId: object.workspaceId,
          kind: object.type,
          id: object.id,
        } as MentionReference;
        return {
          reference,
          title: title(object),
          ...(object.type === 'record'
            ? { description: byId.get(object.databaseId ?? '')?.name || 'Untitled' }
            : {}),
        };
      }),
      next: page.next
        ? JSON.stringify({ text: query.text, kind: query.kind, id: page.next })
        : undefined,
    };
  }
  private async fullPage(scope: ProjectionQuery, query: PageQuery) {
    if (!Number.isSafeInteger(query.limit) || query.limit < 1 || query.limit > 1000)
      throw new HostError('invalid');
    const entries: QueryPage['entries'] = [];
    let after = query.after;
    do {
      const page = await this.repository.readProjection({
        ...scope,
        after,
        limit: query.limit + 1,
      });
      entries.push(...page.entries);
      after = page.next;
    } while (after && entries.length <= query.limit);
    const selected = entries.slice(0, query.limit);
    const snapshot = await this.repository.readObjects!(selected.map((e) => e.projection.id));
    return {
      ...snapshot,
      next: entries.length > query.limit ? selected.at(-1)!.projection.id : undefined,
    };
  }
  objects(query: import('@tio/core').ObjectQuery) {
    return this.fullPage(
      'type' in query.scope ? { type: query.scope.type } : { databaseId: query.scope.databaseId },
      query,
    );
  }
  scan(query: PageQuery) {
    return this.fullPage({}, query);
  }
  async navigation(query: import('@tio/core').NavigationQuery) {
    const snapshot = await this.navigationSnapshot();
    const page = pageEntries(
      {
        ...snapshot,
        entries: snapshot.entries.filter(
          (e) =>
            ['workspace', 'page', 'database', 'databaseView'].includes(e.object.type) &&
            (!query.text ||
              (e.object.title || e.object.name || '')
                .toLocaleLowerCase()
                .includes(query.text.toLocaleLowerCase())),
        ),
      },
      query,
    );
    return {
      version: page.version,
      items: page.entries.map((e) => navigationObject(e.object)),
      next: page.next,
      complete: !page.next && this.repository.queryIndexState?.status !== 'building',
    };
  }
  async records(query: RecordQuery): Promise<QueryPage> {
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        return await this.recordsAtVersion(query);
      } catch (error) {
        if (!(error instanceof HostError) || error.code !== 'conflict' || attempt === 2)
          throw error;
      }
    }
    throw new HostError('conflict');
  }
  private async plainRecords(query: RecordQuery): Promise<QueryPage> {
    const navigation = await this.navigationSnapshot();
    const db = navigation.entries.find(
      (e) => e.object.id === query.databaseId && !e.object.deleted,
    )?.object;
    if (!db) throw new HostError('unavailable', 'Database unavailable');
    const visible = visibility(navigation.entries.map((e) => e.object));
    if (!visible(db)) return { version: navigation.version, entries: [] };
    if (query.after) {
      const cursor = await this.repository.readProjection({ ids: [query.after] });
      if (cursor.version !== navigation.version) throw new HostError('conflict');
      const o = cursor.entries[0]?.projection;
      if (!o || o.deleted || o.type !== 'record' || o.databaseId !== query.databaseId)
        throw new HostError('conflict', 'Query cursor changed');
    }
    const entries: QueryPage['entries'] = [];
    let after = query.after;
    do {
      const page = await this.repository.readProjection({
        databaseId: query.databaseId,
        after,
        limit: Math.max(250, query.limit + 1),
      });
      if (page.version !== navigation.version) throw new HostError('conflict');
      entries.push(
        ...page.entries.filter((e) => e.projection.type === 'record' && !e.projection.deleted),
      );
      after = page.next;
    } while (after && entries.length <= query.limit);
    const selected = entries.slice(0, query.limit);
    return {
      version: navigation.version,
      entries: selected.map(({ projection, revision }) => ({
        projection,
        revision,
        references: [],
      })),
      next: entries.length > query.limit ? selected.at(-1)!.projection.id : undefined,
    };
  }
  private async recordsAtVersion(query: RecordQuery): Promise<QueryPage> {
    if (!query.text && !query.view?.filters?.length && !query.view?.sorts?.length)
      return this.plainRecords(query);
    const order = await this.order(query);
    const offset = query.after ? order.ids.indexOf(query.after) + 1 : 0;
    if (query.after && !offset) throw new HostError('conflict');
    const page = await this.window({ ...query, offset, expectedVersion: order.version });
    return {
      ...page,
      next:
        offset + page.entries.length < page.total ? page.entries.at(-1)?.projection.id : undefined,
    };
  }
  private async buildOrder(query: RecordQuery): Promise<{ version: number; ids: string[] }> {
    if (!Number.isSafeInteger(query.limit) || query.limit < 1 || query.limit > 1000)
      throw new HostError('invalid');
    if (
      !query.text &&
      !query.view?.filters?.length &&
      !query.view?.sorts?.length &&
      this.repository.readRecordOrder
    ) {
      const navigation = await this.navigationSnapshot();
      const db = navigation.entries.find(
        (e) => e.object.id === query.databaseId && !e.object.deleted,
      )?.object;
      if (!db) throw new HostError('unavailable');
      if (!visibility(navigation.entries.map((e) => e.object))(db))
        return { version: navigation.version, ids: [] };
      const result = await this.repository.readRecordOrder(query.databaseId);
      if (result.version !== navigation.version) throw new HostError('conflict');
      return result;
    }
    const [rows, navigation] = await Promise.all([
      this.snapshot({ databaseId: query.databaseId }),
      this.navigationSnapshot(),
    ]);
    if (rows.version !== navigation.version) throw new HostError('conflict');
    const db = navigation.entries.find(
      (e) => e.object.id === query.databaseId && !e.object.deleted,
    )?.object;
    if (!db) throw new HostError('unavailable', 'Database unavailable');
    const entries = new Map([...navigation.entries, ...rows.entries].map((e) => [e.object.id, e]));
    // Resolve property dependencies without hydrating any record body.
    let pending = rows.entries.map((e) => e.object);
    while (pending.length) {
      const ids = new Set<string>();
      for (const row of pending) {
        const database = entries.get(row.databaseId ?? '')?.object;
        for (const field of database?.fields ?? []) {
          const value = row.properties?.[field.id];
          if (field.type === 'relation' || field.type === 'files') {
            for (const id of Array.isArray(value) ? value : value ? [value] : [])
              if (typeof id === 'string')
                ids.add(field.type === 'files' ? id.replace(/^asset:/, '') : id);
          }
          if (field.type === 'mention') {
            for (const reference of Array.isArray(value) ? value : value ? [value] : [])
              if (
                reference &&
                typeof reference === 'object' &&
                'id' in reference &&
                typeof reference.id === 'string'
              )
                ids.add(reference.id);
          }
        }
      }
      const missing = [...ids].filter((id) => !entries.has(id));
      if (!missing.length) break;
      pending = [];
      for (let offset = 0; offset < missing.length; offset += 1000) {
        const page = await this.snapshot({ ids: missing.slice(offset, offset + 1000) });
        if (page.version !== rows.version) throw new HostError('conflict');
        for (const entry of page.entries) {
          entries.set(entry.object.id, entry);
          pending.push(entry.object);
        }
      }
    }
    const objects = [...entries.values()].map((e) => e.object);
    const visible = visibility(objects);
    const ids = await this.evaluate(
      objects.filter(visible),
      db,
      query.view ?? { ...db, filters: [], sorts: [] },
      query.text,
    );
    return { version: rows.version, ids };
  }
}
