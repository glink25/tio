import {
  blockMentions,
  isMentionReference,
  mentionKey,
  id,
  object,
  readableObject,
  validate,
  validateValue,
  type Block,
  type Field,
  type TioObject,
} from '@tio/core';
import type { EditorSession } from '@tio/workspace';

import { SliceError, type WebSlicePermission } from './types';

export const flatten = (blocks: Block[]): Block[] =>
  blocks.flatMap((b) => [b, ...flatten(b.children)]);
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const fail = (code: string): never => {
  throw new SliceError(code);
};
const only = (input: Record<string, unknown>, keys: string[]) => {
  if (
    !input ||
    typeof input !== 'object' ||
    Array.isArray(input) ||
    Object.keys(input).some((k) => !keys.includes(k))
  )
    fail('INVALID_INPUT');
};
export interface BrokerOptions {
  runtime: EditorSession;
  pageId: string;
  blockId: string;
  workspaceId: string;
  permission: () => WebSlicePermission;
  readOnly: () => boolean;
  context: () => Record<string, unknown>;
  resize: (height: number) => void;
}
/** No caller-supplied identity can expand this instance's page-derived authority. */
export class SliceBroker {
  private closed = false;
  private receipts = new Map<string, { input: string; result: Promise<unknown> }>();
  private tokens = new Map<string, { value: string; id: string }>();
  private tail: Promise<unknown> = Promise.resolve();
  private listeners = new Set<(event: unknown) => void>();
  private stop: () => void;
  private last = '';
  private origin: string | undefined;
  constructor(private options: BrokerOptions) {
    this.last = this.signature();
    this.stop = options.runtime.state.subscribe(() => {
      const next = this.signature();
      if (next !== this.last) {
        this.last = next;
        for (const listener of this.listeners)
          listener({ type: 'changed', origin: this.origin ?? null });
      }
    });
  }
  dispose() {
    this.closed = true;
    this.stop();
    this.listeners.clear();
  }
  subscribe(listener: (event: unknown) => void) {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }
  private objects() {
    return this.options.runtime.state
      .getState()
      .objects.filter((o) => o.workspaceId === this.options.workspaceId && !o.deleted);
  }
  private page() {
    if (this.closed) return fail('CLOSED');
    const page = this.objects().find(
      (o) => o.id === this.options.pageId && ['page', 'record'].includes(o.type),
    );
    if (
      !page ||
      !this.options.runtime.can(page, 'read') ||
      !flatten(page.blocks ?? []).some(
        (b) => b.id === this.options.blockId && b.type === 'webSlice',
      )
    )
      return fail('RESOURCE_REMOVED');
    return page;
  }
  private references() {
    const page = this.page();
    const refs = blockMentions(page.blocks ?? []);
    if (page.type === 'record') {
      const db = this.objects().find((o) => o.id === page.databaseId);
      for (const field of db ? (this.readable(db).fields ?? []) : []) {
        const value = this.readable(page).properties?.[field.id];
        if (field.type === 'mention' && isMentionReference(value)) refs.push(value);
      }
    }
    return refs.filter((ref) => ref.workspaceId === this.options.workspaceId);
  }
  private databaseIds() {
    return new Set([
      ...flatten(this.page().blocks ?? [])
        .filter((b) => b.type === 'databaseView')
        .map((b) => String(b.props.databaseId)),
      ...this.references()
        .filter((ref) => ref.kind === 'database')
        .map((ref) => ref.id),
    ]);
  }
  private databases() {
    const ids = this.databaseIds();
    return this.objects().filter(
      (o) => o.type === 'database' && ids.has(o.id) && this.options.runtime.can(o, 'read'),
    );
  }
  private targetPage(id: string) {
    if (!this.references().some((ref) => ref.kind === 'page' && ref.id === id))
      fail('PERMISSION_DENIED');
    return (
      this.objects().find(
        (o) => o.id === id && o.type === 'page' && this.options.runtime.can(o, 'read'),
      ) ?? fail('PERMISSION_DENIED')
    );
  }
  private validateMentions(
    refs: import('@tio/core').MentionReference[],
    previous: import('@tio/core').MentionReference[] = [],
  ) {
    const allowed = new Set([...this.references(), ...previous].map(mentionKey));
    for (const id of this.databaseIds())
      allowed.add(mentionKey({ workspaceId: this.options.workspaceId, kind: 'database', id }));
    for (const ref of refs) if (!allowed.has(mentionKey(ref))) fail('PERMISSION_DENIED');
  }
  private db(id: string) {
    return this.databases().find((o) => o.id === id) ?? fail('PERMISSION_DENIED');
  }
  private readable(o: TioObject) {
    const projected = readableObject(this.options.runtime.access, o);
    if (!projected) return fail('PERMISSION_DENIED');
    return projected;
  }
  private version(o: TioObject) {
    const value = JSON.stringify(o);
    for (const [token, saved] of this.tokens)
      if (saved.id === o.id && saved.value === value) return token;
    const token = crypto.randomUUID();
    this.tokens.set(token, { id: o.id, value });
    if (this.tokens.size > 10_000) this.tokens.delete(this.tokens.keys().next().value!);
    return token;
  }
  private output(o: TioObject) {
    const p = this.readable(o);
    const version = this.version(o);
    if (o.type === 'record') {
      const db = this.readable(this.db(o.databaseId!));
      const allowed = new Set(
        db.fields
          ?.filter((f) => !['formula', 'rollup', 'createdTime', 'lastEditedTime'].includes(f.type))
          .map((f) => f.id),
      );
      return {
        id: o.id,
        databaseId: o.databaseId,
        properties: Object.fromEntries(
          Object.entries(p.properties ?? {}).filter(([key]) => allowed.has(key)),
        ),
        version,
      };
    }
    if (o.type === 'database') return { id: o.id, name: p.name, fields: p.fields, version };
    if (o.type === 'databaseView')
      return {
        id: o.id,
        databaseId: o.databaseId,
        name: p.name,
        layout: p.layout,
        filters: p.filters,
        sorts: p.sorts,
        visibleFieldIds: p.visibleFieldIds,
        version,
      };
    return { id: o.id, title: p.title, type: o.type, version };
  }
  private signature() {
    try {
      const dbs = this.databases();
      const ids = new Set(dbs.map((d) => d.id));
      const visible = (o: TioObject) => {
        const result: Record<string, unknown> = { ...this.output(o) };
        delete result.version;
        return result;
      };
      return JSON.stringify([
        this.page().title,
        this.page().blocks,
        this.references(),
        ...this.objects()
          .filter(
            (o) =>
              o.type === 'page' &&
              this.references().some((r) => r.kind === 'page' && r.id === o.id) &&
              this.options.runtime.can(o, 'read'),
          )
          .map((o) => this.readable(o)),
        ...dbs.map(visible),
        ...this.objects()
          .filter(
            (o) => o.databaseId && ids.has(o.databaseId) && this.options.runtime.can(o, 'read'),
          )
          .map(visible),
      ]);
    } catch {
      return '';
    }
  }
  private writable() {
    this.page();
    if (this.options.readOnly() || this.options.permission().data !== 'readWrite')
      fail('PERMISSION_DENIED');
  }
  private checkVersion(o: TioObject, version: unknown) {
    const saved = this.tokens.get(String(version));
    if (!saved || saved.id !== o.id || saved.value !== JSON.stringify(o)) fail('CONFLICT');
  }
  private async commit(expected: TioObject[], changes: TioObject[]) {
    this.writable();
    const page = this.page();
    for (const o of changes) {
      if (o.id === page.id && o.deleted) fail('PERMISSION_DENIED');
      validate(o);
    }
    const existing = new Set(this.objects().map((o) => o.id));
    const recheck = () => {
      this.writable();
      for (const next of changes) {
        const old = expected.find((o) => o.id === next.id);
        if (next.type === 'page' && next.id !== this.options.pageId) this.targetPage(next.id);
        if (
          next.databaseId &&
          next.id !== this.options.pageId &&
          !changes.some(
            (o) => o.id === next.databaseId && o.type === 'database' && !existing.has(o.id),
          )
        )
          this.db(next.databaseId);
        if (next.type === 'database' && existing.has(next.id)) this.db(next.id);
        if (next.blocks && !changes.some((o) => o.type === 'database' && !existing.has(o.id)))
          this.validateBlocks(old?.blocks ?? [], next.blocks);
        const db = next.databaseId
          ? this.objects().find((o) => o.id === next.databaseId)
          : undefined;
        for (const field of db?.fields ?? []) {
          const value = next.properties?.[field.id],
            previous = old?.properties?.[field.id];
          if (field.type === 'mention' && isMentionReference(value))
            this.validateMentions([value], isMentionReference(previous) ? [previous] : []);
        }
        if (next.type === 'database' && old) {
          for (const field of next.fields ?? []) {
            const before = old.fields?.find((f) => f.id === field.id);
            if (
              field.type === 'mention' &&
              before?.type !== 'mention' &&
              page.databaseId === next.id
            ) {
              const value = page.properties?.[field.id];
              if (isMentionReference(value)) this.validateMentions([value]);
            }
          }
        }
      }
    };
    this.origin = this.options.blockId;
    try {
      await this.options.runtime.checked(
        [...new Map([page, ...expected].map((o) => [o.id, o])).values()],
        changes,
        recheck,
      );
    } catch (error) {
      if (error instanceof SliceError) throw error;
      const code = (error as { code?: string }).code;
      throw new SliceError(
        code === 'conflict'
          ? 'CONFLICT'
          : code === 'permission'
            ? 'PERMISSION_DENIED'
            : 'INVALID_INPUT',
        String(error),
      );
    } finally {
      this.origin = undefined;
    }
  }
  private validateBlocks(before: Block[], after: Block[]) {
    const allowed = this.databaseIds();
    this.validateMentions(blockMentions(after), blockMentions(before));
    const protectedBefore = flatten(before).filter((b) => b.type === 'webSlice');
    const protectedAfter = flatten(after).filter((b) => b.type === 'webSlice');
    if (!same(protectedBefore, protectedAfter)) fail('PERMISSION_DENIED');
    for (const b of flatten(after)) {
      if (
        b.type === 'databaseView' &&
        !allowed.has(String(b.props.databaseId)) &&
        !flatten(before).some((old) => same(old, b))
      )
        fail('PERMISSION_DENIED');
    }
  }
  invoke(method: string, input: unknown = {}, requestId = crypto.randomUUID()): Promise<unknown> {
    const encoded = JSON.stringify([method, input]);
    if (encoded.length > 2_000_000) return Promise.reject(new SliceError('INVALID_INPUT'));
    try {
      this.page();
      const p = input as Record<string, unknown>;
      if (p?.databaseId !== undefined) {
        if (typeof p.databaseId !== 'string') fail('INVALID_INPUT');
        this.db(p.databaseId as string);
      }
      if (/\.(create|update|delete|insertBlocks|updateBlock|removeBlock)$/.test(method))
        this.writable();
    } catch (error) {
      return Promise.reject(error);
    }
    const previous = this.receipts.get(requestId);
    if (previous)
      return previous.input === encoded
        ? previous.result
        : Promise.reject(new SliceError('INVALID_INPUT'));
    if (this.receipts.size >= 10_000)
      return Promise.reject(
        new SliceError('RATE_LIMITED', 'Restart this slice to begin a new request session'),
      );
    const result = this.tail.then(() => this.execute(method, input as Record<string, any>));
    this.tail = result.catch(() => undefined);
    this.receipts.set(requestId, { input: encoded, result });
    return result;
  }
  private async execute(method: string, p: Record<string, any>) {
    this.page();
    if (!p || typeof p !== 'object' || Array.isArray(p)) fail('INVALID_INPUT');
    if (method === 'context.get')
      return {
        ...this.options.context(),
        apiVersion: 1,
        pageId: this.options.pageId,
        instanceId: this.options.blockId,
        permissions: this.options.permission(),
      };
    if (method === 'ui.resize') {
      if (!Number.isFinite(p.height)) fail('INVALID_INPUT');
      this.options.resize(Math.max(160, Math.min(1200, p.height)));
      return null;
    }
    if (this.page().databaseId) await this.options.runtime.ensure([this.page().databaseId!]);
    if (method.startsWith('pages.')) {
      if (
        typeof p.pageId !== 'string' ||
        !this.references().some((ref) => ref.kind === 'page' && ref.id === p.pageId)
      )
        fail('PERMISSION_DENIED');
      await this.options.runtime.ensure([p.pageId]);
      this.targetPage(p.pageId);
    }
    const pageTarget = () =>
      method.startsWith('pages.') ? this.targetPage(p.pageId) : this.page();
    const pageMethod = method.replace(/^pages\./, 'page.');
    if (pageMethod === 'page.get') {
      const page = pageTarget();
      return { id: page.id, type: page.type, title: page.title, version: this.version(page) };
    }
    if (pageMethod === 'page.getBlocks')
      return {
        blocks: structuredClone(this.readable(pageTarget()).blocks ?? []),
        version: this.version(pageTarget()),
      };
    if (pageMethod.startsWith('page.')) {
      this.writable();
      const page = pageTarget();
      this.checkVersion(page, p.version);
      let next = structuredClone(page);
      if (pageMethod === 'page.update') {
        only(p.changes, ['title']);
        if (typeof p.changes.title !== 'string') fail('INVALID_INPUT');
        next.title = p.changes.title;
      } else {
        const blocks = next.blocks ?? [];
        if (pageMethod === 'page.insertBlocks') {
          if (!Array.isArray(p.blocks)) fail('INVALID_INPUT');
          next.blocks = [...blocks, ...p.blocks];
        } else if (pageMethod === 'page.updateBlock' || pageMethod === 'page.removeBlock') {
          if (!flatten(blocks).some((b) => b.id === p.id)) fail('RESOURCE_REMOVED');
          if (pageMethod === 'page.updateBlock')
            only(p.changes, ['props', 'content', 'type', 'children']);
          const edit = (items: Block[]): Block[] =>
            items.flatMap((b) =>
              b.id === p.id
                ? pageMethod === 'page.removeBlock'
                  ? []
                  : [{ ...b, ...p.changes, id: b.id }]
                : [{ ...b, children: edit(b.children) }],
            );
          next.blocks = edit(blocks);
        } else return fail('INVALID_INPUT');
        this.validateBlocks(page.blocks ?? [], next.blocks ?? []);
      }
      await this.commit([page], [next]);
      return { id: next.id, type: next.type, title: next.title, version: this.version(next) };
    }
    if (method === 'databases.list') {
      await this.options.runtime.ensure([...this.databaseIds()]);
      return this.databases().map((d) => this.output(d));
    }
    if (method === 'databases.create') {
      this.writable();
      only(p, ['name', 'fields']);
      const db = object('database', this.options.workspaceId, {
        name: p.name,
        parentId: this.page().id,
        fields: p.fields ?? [{ id: id('field'), name: 'Name', type: 'title' }],
      });
      const view = object('databaseView', db.workspaceId, {
        databaseId: db.id,
        name: 'All',
        layout: 'table',
        visibleFieldIds: db.fields?.map((f) => f.id) ?? [],
        filters: [],
        sorts: [],
      });
      const page = this.page();
      const next = {
        ...page,
        blocks: [
          ...(page.blocks ?? []),
          {
            id: id('block'),
            type: 'databaseView',
            props: { databaseId: db.id, viewId: view.id },
            content: [],
            children: [],
          },
        ],
      };
      await this.commit([page], [db, view, next]);
      return this.output(db);
    }
    if (!this.databaseIds().has(p.databaseId)) fail('PERMISSION_DENIED'); // Scope before fetch.
    await this.options.runtime.loadDatabase(p.databaseId);
    if (typeof p.id === 'string' && method.startsWith('records.'))
      await this.options.runtime.ensure([p.id]);
    const db = this.db(p.databaseId); // Recheck grants and references after the asynchronous read.
    const readableDb = this.readable(db);
    if (method === 'databases.get') return this.output(db);
    const records = this.objects().filter(
      (o) => o.type === 'record' && o.databaseId === db.id && this.options.runtime.can(o, 'read'),
    );
    const views = this.objects().filter(
      (o) =>
        o.type === 'databaseView' && o.databaseId === db.id && this.options.runtime.can(o, 'read'),
    );
    if (method === 'fields.list') return { fields: readableDb.fields, version: this.version(db) };
    if (method === 'views.list') return views.map((v) => this.output(v));
    if (method === 'records.get')
      return this.output(records.find((r) => r.id === p.id) ?? fail('RESOURCE_REMOVED'));
    if (method === 'records.query') {
      const view = p.viewId
        ? (views.find((v) => v.id === p.viewId) ?? fail('RESOURCE_REMOVED'))
        : { ...db, filters: [], sorts: [] };
      const limit = p.limit ?? 100;
      if (
        !Number.isSafeInteger(limit) ||
        limit < 1 ||
        limit > 1000 ||
        (p.cursor !== undefined && typeof p.cursor !== 'string')
      )
        fail('INVALID_INPUT');
      const page = await this.options.runtime.records({
        databaseId: db.id,
        view: { ...view, filters: p.filters ?? view.filters, sorts: p.sorts ?? view.sorts },
        after: p.cursor,
        limit,
      });
      this.db(db.id);
      return {
        records: page.entries.map((e) => this.output(e.object)),
        nextCursor: page.next ?? null,
      };
    }
    this.writable();
    if (method.startsWith('records.')) {
      const old =
        method === 'records.create'
          ? undefined
          : (records.find((r) => r.id === p.id) ?? fail('RESOURCE_REMOVED'));
      if (old) this.checkVersion(old, p.version);
      if (!['records.create', 'records.update', 'records.delete'].includes(method))
        fail('INVALID_INPUT');
      const values = p.properties ?? {};
      if (typeof values !== 'object' || Array.isArray(values)) fail('INVALID_INPUT');
      for (const [key, value] of Object.entries(values)) {
        const field = readableDb.fields?.find((f) => f.id === key) ?? fail('PERMISSION_DENIED');
        if (['formula', 'rollup', 'createdTime', 'lastEditedTime'].includes(field.type))
          fail('INVALID_INPUT');
        validateValue(field, value);
        if (field.type === 'mention' && isMentionReference(value)) {
          const previous = old?.properties?.[key];
          this.validateMentions([value], isMentionReference(previous) ? [previous] : []);
        }
      }
      const next = old
        ? {
            ...old,
            ...(method === 'records.delete'
              ? { deleted: true }
              : { properties: { ...old.properties, ...values } }),
          }
        : object('record', db.workspaceId, { databaseId: db.id, properties: values, blocks: [] });
      await this.commit([db, ...(old ? [old] : [])], [next]);
      return method === 'records.delete'
        ? null
        : this.output(this.objects().find((o) => o.id === next.id) ?? next);
    }
    if (method.startsWith('fields.')) {
      this.checkVersion(db, p.version);
      const fields = db.fields ?? [];
      let nextFields: Field[];
      if (method === 'fields.create')
        nextFields = [...fields, { ...p.field, id: p.field?.id ?? id('field') }];
      else {
        if (!fields.some((f) => f.id === p.id)) fail('RESOURCE_REMOVED');
        if (method === 'fields.delete') nextFields = fields.filter((f) => f.id !== p.id);
        else if (method === 'fields.update')
          nextFields = fields.map((f) => (f.id === p.id ? { ...f, ...p.changes, id: f.id } : f));
        else return fail('INVALID_INPUT');
      }
      const next = { ...db, fields: nextFields };
      await this.commit([db], [next]);
      return this.output(this.objects().find((o) => o.id === next.id) ?? next);
    }
    if (method.startsWith('views.')) {
      const old =
        method === 'views.create'
          ? undefined
          : (views.find((v) => v.id === p.id) ?? fail('RESOURCE_REMOVED'));
      if (old) this.checkVersion(old, p.version);
      if (!['views.create', 'views.update', 'views.delete'].includes(method)) fail('INVALID_INPUT');
      const changes = p.changes ?? {};
      only(changes, [
        'name',
        'layout',
        'filters',
        'sorts',
        'visibleFieldIds',
        'fieldOrder',
        'columnWidths',
        'groupBy',
      ]);
      const next = old
        ? { ...old, ...changes, ...(method === 'views.delete' ? { deleted: true } : {}) }
        : object('databaseView', db.workspaceId, {
            name: 'View',
            layout: 'table',
            visibleFieldIds: db.fields?.map((f) => f.id) ?? [],
            filters: [],
            sorts: [],
            ...changes,
            databaseId: db.id,
          });
      await this.commit([db, ...(old ? [old] : [])], [next]);
      return method === 'views.delete' ? null : this.output(next);
    }
    return fail('INVALID_INPUT');
  }
}
