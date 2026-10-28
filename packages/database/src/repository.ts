import {
  HostError,
  navigationObject,
  recordTitle,
  mentionTitle,
  type MentionQuery,
  type MentionPage,
  type MentionReference,
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
  constructor(private repository: Pick<WorkspaceRepository, 'readSnapshot' | 'readObjects'>) {}
  async metadata(ids: string[]) {
    if (!this.repository.readObjects) throw new HostError('unsupported');
    const result = await this.repository.readObjects(ids);
    const databases = [
      ...new Set(
        result.entries.flatMap(({ object }) =>
          object.type === 'record' && object.databaseId ? [object.databaseId] : [],
        ),
      ),
    ];
    const snapshot = databases.length
      ? await this.repository.readObjects([...new Set([...ids, ...databases])])
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
    const snapshot = await this.repository.readSnapshot();
    const objects = snapshot.entries.map((e) => e.object);
    const visible = visibility(objects);
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
          const reference = {
            workspaceId: object.workspaceId,
            kind: object.type,
            id: object.id,
          } as MentionReference;
          return (mentionTitle(reference, objects) ?? '')
            .toLocaleLowerCase()
            .includes(query.text.toLocaleLowerCase());
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
          title: mentionTitle(reference, objects)!,
          ...(object.type === 'record'
            ? { description: objects.find((o) => o.id === object.databaseId)?.name || 'Untitled' }
            : {}),
        };
      }),
      next: page.next
        ? JSON.stringify({ text: query.text, kind: query.kind, id: page.next })
        : undefined,
    };
  }
  async scan(query: PageQuery) {
    return pageEntries(await this.repository.readSnapshot(), query);
  }
  async navigation(query: import('@tio/core').NavigationQuery) {
    const snapshot = await this.repository.readSnapshot();
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
