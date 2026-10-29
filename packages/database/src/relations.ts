import {
  HostError,
  visibility,
  type WorkspaceRepository,
  type RelationsProvider,
  type RelationPage,
  type ReferenceGroup,
  type ReferenceOccurrence,
  type ReferenceNode,
  type ReferenceQuery,
  type OccurrenceQuery,
  type GraphQuery,
  type GraphItem,
} from '@tio/core';

import { extractReferences, targetOf, titleOfContent } from './content-index';

/** Provider-owned derived index. Never installs bodies into the editor's working set. */
export class ScanningRelations implements RelationsProvider {
  private listeners = new Set<Parameters<RelationsProvider['subscribe']>[0]>();
  private stop?: () => void;
  private generation = 0;
  private version = '';
  private dirty = true;
  private job?: Promise<void>;
  private nodes = new Map<string, ReferenceNode>();
  private sources = new Map<
    string,
    { revision: number; fields: string; occurrences: ReferenceOccurrence[] }
  >();
  private occurrences: ReferenceOccurrence[] = [];
  private complete = false;
  private graphItems?: GraphItem[];
  private closed = false;
  constructor(
    private repository: Pick<WorkspaceRepository, 'readSnapshot' | 'subscribeChanges'>,
    private isReady: () => boolean = () => true,
  ) {}
  invalidate(reason: 'content' | 'access' | 'ready' = 'content') {
    this.generation++;
    this.dirty = true;
    this.graphItems = undefined;
    if (reason === 'access') {
      this.nodes.clear();
      this.sources.clear();
      this.occurrences = [];
    }
    this.listeners.forEach((fn) => fn(reason));
  }
  subscribe = (fn: Parameters<RelationsProvider['subscribe']>[0]) => {
    this.listen();
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  };
  private listen() {
    this.stop ??= this.repository.subscribeChanges(() => this.invalidate());
  }
  close() {
    this.closed = true;
    this.stop?.();
    this.stop = undefined;
    this.generation++;
    this.listeners.clear();
    this.sources.clear();
    this.nodes.clear();
    this.graphItems = undefined;
    this.occurrences = [];
  }
  private async build(): Promise<void> {
    if (this.closed) throw new HostError('closed');
    this.listen();
    if (!this.dirty) return;
    if (this.job) {
      await this.job;
      return this.build();
    }
    const generation = this.generation;
    this.job = (async () => {
      const snapshot = await this.repository.readSnapshot();
      const objects = snapshot.entries.map((e) => e.object);
      const visible = visibility(objects);
      const byId = new Map(objects.map((o) => [o.id, o]));
      const nodes = new Map<string, ReferenceNode>();
      const sources = new Map<
        string,
        { revision: number; fields: string; occurrences: ReferenceOccurrence[] }
      >();
      let count = 0;
      for (const { object: o, revision } of snapshot.entries) {
        if (!visible(o) || !['page', 'database', 'record'].includes(o.type)) continue;
        nodes.set(o.id, { target: targetOf(o), title: titleOfContent(o, objects) });
        const db = byId.get(o.databaseId ?? '');
        const fields = JSON.stringify(db?.fields ?? []);
        const cached = this.sources.get(o.id);
        sources.set(
          o.id,
          cached?.revision === revision && cached.fields === fields
            ? cached
            : { revision, fields, occurrences: extractReferences(o, db) },
        );
        if (++count % 200 === 0) await new Promise<void>((resolve) => setTimeout(resolve, 0));
      }
      if (generation !== this.generation) return;
      this.nodes = nodes;
      this.sources = sources;
      this.occurrences = [...sources.values()].flatMap((s) => s.occurrences);
      this.complete = this.isReady();
      this.version = `${snapshot.version}:${generation}:${this.complete}`;
      this.dirty = false;
    })().finally(() => {
      this.job = undefined;
    });
    await this.job;
    if (this.dirty) return this.build();
  }
  private page<T>(items: T[], query: GraphQuery, key: string): RelationPage<T> {
    if (!Number.isSafeInteger(query.limit) || query.limit < 1 || query.limit > 1000)
      throw new HostError('invalid');
    let offset = 0;
    if (query.after) {
      let cursor;
      try {
        cursor = JSON.parse(query.after);
      } catch {
        throw new HostError('invalid');
      }
      if (cursor.key !== key || cursor.version !== this.version) throw new HostError('conflict');
      if (!Number.isSafeInteger(cursor.offset) || cursor.offset < 0) throw new HostError('invalid');
      offset = cursor.offset;
    }
    const end = Math.min(items.length, offset + query.limit);
    return {
      version: this.version,
      status: this.complete ? 'ready' : 'partial',
      complete: this.complete,
      items: items.slice(offset, end),
      ...(this.complete ? { total: items.length } : {}),
      ...(end < items.length
        ? { next: JSON.stringify({ key, version: this.version, offset: end }) }
        : {}),
    };
  }
  async queryReferences(query: ReferenceQuery) {
    await this.build();
    if (!['in', 'out'].includes(query.direction) || !this.nodes.has(query.id))
      throw new HostError('permission');
    const groups = new Map<string, ReferenceGroup>();
    for (const o of this.occurrences) {
      if ((query.direction === 'in' ? o.target.id : o.source.id) !== query.id) continue;
      const ref = query.direction === 'in' ? o.source : o.target;
      const node = this.nodes.get(ref.id);
      const valid = node?.target.kind === ref.kind && node.target.workspaceId === ref.workspaceId;
      if (query.direction === 'in' && !valid) continue;
      const key = `${ref.kind}:${ref.id}`;
      const existing = groups.get(key);
      if (existing) existing.count++;
      else
        groups.set(key, {
          node: valid
            ? node
            : { target: { workspaceId: ref.workspaceId, kind: ref.kind, id: ref.id }, title: '' },
          status: valid ? 'ready' : 'unavailable',
          count: 1,
        });
    }
    return this.page(
      [...groups.values()].sort((a, b) => a.node.target.id.localeCompare(b.node.target.id)),
      query,
      `references:${query.id}:${query.direction}`,
    );
  }
  async queryReferenceOccurrences(query: OccurrenceQuery) {
    await this.build();
    if (!this.nodes.has(query.sourceId)) throw new HostError('permission');
    const items = this.occurrences.filter(
      (o) => o.source.id === query.sourceId && o.target.id === query.targetId,
    );
    return this.page(items, query, `occurrences:${query.sourceId}:${query.targetId}`);
  }
  async queryGraph(query: GraphQuery) {
    await this.build();
    if (this.graphItems) return this.page(this.graphItems, query, 'graph');
    const edges = new Map<string, { source: string; target: string; count: number }>();
    for (const o of this.occurrences) {
      const target = this.nodes.get(o.target.id);
      if (
        !target ||
        target.target.kind !== o.target.kind ||
        target.target.workspaceId !== o.target.workspaceId ||
        o.source.id === o.target.id
      )
        continue;
      const key = `${o.source.id}:${o.target.id}`;
      const edge = edges.get(key);
      if (edge) edge.count++;
      else edges.set(key, { source: o.source.id, target: o.target.id, count: 1 });
    }
    const items: GraphItem[] = [...this.nodes.values()]
      .sort((a, b) => a.target.id.localeCompare(b.target.id))
      .map((node) => ({ type: 'node', node }));
    items.push(
      ...[...edges.values()]
        .sort((a, b) => `${a.source}:${a.target}`.localeCompare(`${b.source}:${b.target}`))
        .map((edge) => ({ type: 'edge' as const, edge })),
    );
    this.graphItems = items;
    return this.page(items, query, 'graph');
  }
}
