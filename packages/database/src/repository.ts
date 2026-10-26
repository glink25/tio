import {
  HostError,
  navigationObject,
  visibility,
  type WorkspaceRepository,
  type PageQuery,
  type RecordQuery,
  type WorkspaceSnapshot,
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
/** Provider-side scanning implementation. Remote providers implement these queries directly. */
export class ScanningQueries {
  constructor(private repository: Pick<WorkspaceRepository, 'readSnapshot'>) {}
  async scan(query: PageQuery) {
    return pageEntries(await this.repository.readSnapshot(), query);
  }
  async navigation(query: import('@tio/core').NavigationQuery) {
    const snapshot = await this.repository.readSnapshot();
    const visible = visibility(snapshot.entries.map((e) => e.object));
    const page = pageEntries(
      {
        ...snapshot,
        entries: snapshot.entries.filter(
          (e) =>
            (query.mentionsOnly
              ? ['page', 'database']
              : ['workspace', 'page', 'database', 'databaseView']
            ).includes(e.object.type) &&
            (!query.mentionsOnly || (!e.object.deleted && visible(e.object))) &&
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
      complete: !page.next,
    };
  }
  async records(query: RecordQuery) {
    const snapshot = await this.repository.readSnapshot();
    const objects = snapshot.entries.map((e) => e.object);
    const db = objects.find((o) => o.id === query.databaseId && !o.deleted);
    if (!db) throw new HostError('unavailable', 'Database unavailable');
    if (!Number.isSafeInteger(query.limit) || query.limit < 1 || query.limit > 1000)
      throw new HostError('invalid');
    const visible = visibility(objects);
    const rows = queryRecords(
      objects.filter(visible),
      db,
      query.view ?? { ...db, filters: [], sorts: [] },
    ).filter(
      (o) =>
        !query.text ||
        JSON.stringify(o.properties).toLocaleLowerCase().includes(query.text.toLocaleLowerCase()),
    );
    const offset = query.after ? rows.findIndex((o) => o.id === query.after) + 1 : 0;
    if (query.after && offset === 0) throw new HostError('conflict', 'Query cursor changed');
    const selected = rows.slice(offset, offset + query.limit);
    const byId = new Map(snapshot.entries.map((e) => [e.object.id, e]));
    return {
      version: snapshot.version,
      entries: selected.map((o) => byId.get(o.id)!),
      next: offset + selected.length < rows.length ? selected.at(-1)!.id : undefined,
    };
  }
}
