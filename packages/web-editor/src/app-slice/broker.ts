import { prepareAsset } from '@tio/assets';
import {
  blockMentions,
  mentionReferences,
  mentionKey,
  id,
  readableObject,
  validate,
  validateValue,
  validateAssetSize,
  type AssetData,
  type Block,
  type TioObject,
} from '@tio/core';
import {
  flatten,
  updateBlock,
  changeFields,
  changeRecord,
  changeView,
  createDatabase,
  removeViewField,
} from '@tio/operations/mutations';
import type { EditorSession } from '@tio/workspace';

import { AppSliceError, type AppSlicePermission } from './types';

export { flatten };
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const fail = (code: string): never => {
  throw new AppSliceError(code);
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
  permission: () => AppSlicePermission;
  readOnly: () => boolean;
  context: () => Record<string, unknown>;
  resize: (height: number) => void;
  download?: (file: AssetData) => void;
}
/** No caller-supplied identity can expand this instance's page-derived authority. */
export class AppSliceBroker {
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
    const stateKey = () => {
      const state = options.runtime.state.getState();
      const page = state.objects.find((o) => o.id === options.pageId);
      return JSON.stringify([
        state.version,
        state.pending,
        state.contentReady,
        state.queryIndexState.status,
        options.runtime.access.version,
        page?.title,
        page?.blocks,
      ]);
    };
    let previousState = stateKey();
    this.stop = options.runtime.state.subscribe(() => {
      const state = stateKey();
      // Query-window publication changes cache coverage, not business content.
      if (state === previousState && !options.runtime.state.getState().pending) return;
      previousState = state;
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
    this.receipts.clear();
    this.tokens.clear();
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
        (b) => b.id === this.options.blockId && b.type === 'appSlice',
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
        if (field.type === 'mention') refs.push(...mentionReferences(value));
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
  private async commit(
    expected: TioObject[],
    changes: TioObject[],
    assets: ReadonlyMap<string, AssetData> = new Map(),
  ) {
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
          if (field.type === 'mention')
            this.validateMentions(mentionReferences(value), mentionReferences(previous));
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
              this.validateMentions(mentionReferences(value));
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
        { assets },
      );
    } catch (error) {
      if (error instanceof AppSliceError) throw error;
      const code = (error as { code?: string }).code;
      throw new AppSliceError(
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
    this.validateAssetRefs(this.blockAssets(after), this.blockAssets(before));
    this.validateMentions(blockMentions(after), blockMentions(before));
    const protectedBefore = flatten(before).filter((b) => b.type === 'appSlice');
    const protectedAfter = flatten(after).filter((b) => b.type === 'appSlice');
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
  private blockAssets(blocks: Block[]) {
    return flatten(blocks).flatMap((block) =>
      Object.values(block.props).filter(
        (value) => typeof value === 'string' && value.startsWith('asset:'),
      ),
    );
  }
  private availableAssets() {
    const refs = new Set<unknown>(this.blockAssets(this.readable(this.page()).blocks ?? []));
    for (const o of this.objects()) {
      if (
        o.type === 'page' &&
        this.references().some((ref) => ref.kind === 'page' && ref.id === o.id) &&
        this.options.runtime.can(o, 'read')
      )
        this.blockAssets(this.readable(o).blocks ?? []).forEach((ref) => refs.add(ref));
      if (
        o.type === 'record' &&
        o.databaseId &&
        this.databaseIds().has(o.databaseId) &&
        this.options.runtime.can(o, 'read')
      ) {
        const db = this.databases().find((db) => db.id === o.databaseId);
        if (!db) continue;
        const readable = this.readable(o);
        for (const field of this.readable(db).fields ?? [])
          if (field.type === 'files') {
            const values = readable.properties?.[field.id];
            if (Array.isArray(values)) values.forEach((ref) => refs.add(ref));
          }
      }
    }
    return refs;
  }
  private validateAssetRefs(refs: unknown[], previous: unknown[] = []) {
    const allowed = this.availableAssets();
    previous.forEach((ref) => allowed.add(ref));
    for (const ref of refs)
      if (typeof ref !== 'string' || !ref.startsWith('asset:') || !allowed.has(ref))
        fail('PERMISSION_DENIED');
  }
  private async attachmentTarget(target: any) {
    if (!target || typeof target !== 'object') return fail('INVALID_INPUT');
    if (target.kind === 'page') {
      only(target, ['kind', 'pageId', 'afterBlockId']);
      const pageId = target.pageId ?? this.options.pageId;
      if (
        typeof pageId !== 'string' ||
        (target.afterBlockId !== undefined && typeof target.afterBlockId !== 'string')
      )
        fail('INVALID_INPUT');
      if (pageId !== this.options.pageId) this.targetPage(pageId);
      await this.options.runtime.loadTarget(pageId);
      this.page();
      const object = pageId === this.options.pageId ? this.page() : this.targetPage(pageId);
      return { object, db: undefined, field: undefined };
    }
    if (target.kind !== 'record') return fail('INVALID_INPUT');
    only(target, ['kind', 'databaseId', 'recordId', 'fieldId']);
    if (
      ![target.databaseId, target.recordId, target.fieldId].every(
        (value) => typeof value === 'string',
      )
    )
      fail('INVALID_INPUT');
    this.db(target.databaseId);
    await this.options.runtime.loadTarget(target.recordId);
    const db = this.db(target.databaseId);
    const object = this.objects().find(
      (o) => o.id === target.recordId && o.type === 'record' && o.databaseId === db.id,
    );
    if (!object || !this.options.runtime.can(object, 'read')) return fail('PERMISSION_DENIED');
    const field = this.readable(db).fields?.find(
      (field) => field.id === target.fieldId && field.type === 'files',
    );
    if (!field || !this.options.runtime.can(object, 'read', field.id))
      return fail('PERMISSION_DENIED');
    return { object, db, field };
  }
  private attachmentRefs(object: TioObject, field?: import('@tio/core').Field) {
    const readable = this.readable(object);
    if (field) {
      const values = readable.properties?.[field.id];
      return (Array.isArray(values) ? values : [])
        .filter((ref): ref is string => typeof ref === 'string' && ref.startsWith('asset:'))
        .map((ref) => ({ ref, fieldId: field.id }));
    }
    return flatten(readable.blocks ?? []).flatMap((block) =>
      typeof block.props.url === 'string' && block.props.url.startsWith('asset:')
        ? [{ ref: block.props.url, blockId: block.id }]
        : [],
    );
  }
  private async attachment(method: string, p: Record<string, any>, binary?: Uint8Array) {
    only(p, ['target', 'file', 'version', 'ref']);
    let { object, db, field } = await this.attachmentTarget(p.target);
    const refs = this.attachmentRefs(object, field);
    if (method === 'attachments.list') {
      const ids = [...new Set(refs.map((item) => item.ref.slice(6)))];
      for (let offset = 0; offset < ids.length; offset += 1000)
        await this.options.runtime.ensure(ids.slice(offset, offset + 1000));
      ({ object, db, field } = await this.attachmentTarget(p.target));
      const assets = new Map(
        this.objects()
          .filter((o) => o.type === 'asset' && this.options.runtime.can(o, 'read'))
          .map((o) => [o.id, this.readable(o)]),
      );
      return {
        version: this.version(object),
        attachments: this.attachmentRefs(object, field).flatMap((item) => {
          const asset = assets.get(item.ref.slice(6));
          return asset
            ? [{ ...item, name: asset.filename, mime: asset.mime, byteSize: asset.byteSize }]
            : [];
        }),
      };
    }
    if (method === 'attachments.read' || method === 'attachments.download') {
      if (typeof p.ref !== 'string' || !refs.some((item) => item.ref === p.ref))
        return fail('PERMISSION_DENIED');
      await this.options.runtime.ensure([p.ref.slice(6)]);
      const metadata = this.objects().find((o) => o.id === p.ref.slice(6) && o.type === 'asset');
      if (!metadata || !this.options.runtime.can(metadata, 'read'))
        return fail('PERMISSION_DENIED');
      if (
        typeof metadata.byteSize === 'number' &&
        metadata.byteSize > this.options.runtime.attachmentPolicy.maxFileBytes
      )
        return fail('ASSET_TOO_LARGE');
      const file = await this.options.runtime.readAsset(p.ref.slice(6));
      if (!file) return fail('RESOURCE_REMOVED');
      if (file.bytes.byteLength > this.options.runtime.attachmentPolicy.maxFileBytes)
        return fail('ASSET_TOO_LARGE');
      ({ object, field } = await this.attachmentTarget(p.target));
      if (
        !this.attachmentRefs(object, field).some((item) => item.ref === p.ref) ||
        !this.options.runtime.can(metadata, 'read')
      )
        return fail('PERMISSION_DENIED');
      if (method === 'attachments.download') {
        if (!this.options.download) return fail('INVALID_INPUT');
        this.options.download(file);
        return null;
      }
      return { name: file.name, mime: file.mime, bytes: file.bytes.slice() };
    }
    if (!['attachments.write', 'attachments.remove'].includes(method)) return fail('INVALID_INPUT');
    this.writable();
    this.checkVersion(object, p.version);
    if (!this.options.runtime.can(object, 'update', field?.id)) return fail('PERMISSION_DENIED');
    let metadata: TioObject | undefined,
      assets = new Map<string, AssetData>(),
      ref: string;
    if (method === 'attachments.write') {
      if (
        !binary ||
        !p.file ||
        typeof p.file.name !== 'string' ||
        !p.file.name ||
        typeof p.file.mime !== 'string'
      )
        return fail('INVALID_INPUT');
      const prepared = prepareAsset(this.options.workspaceId, {
        name: p.file.name,
        mime: p.file.mime,
        bytes: binary,
      });
      metadata = prepared.metadata;
      assets = prepared.assets;
      ref = prepared.ref;
    } else {
      if (typeof p.ref !== 'string' || !refs.some((item) => item.ref === p.ref))
        return fail('PERMISSION_DENIED');
      ref = p.ref;
    }
    let next: TioObject;
    if (field) {
      const values = this.readable(object).properties?.[field.id];
      const before = Array.isArray(values) ? values : [];
      next = changeRecord(
        object.workspaceId,
        db!.id,
        { [field.id]: metadata ? [...before, ref] : before.filter((value) => value !== ref) },
        object,
      );
    } else {
      const blocks = structuredClone(object.blocks ?? []);
      const walk = (items: Block[]): Block[] =>
        items
          .filter(
            (block) =>
              !(
                method === 'attachments.remove' &&
                block.props.url === ref &&
                ['image', 'video', 'audio', 'file'].includes(block.type)
              ),
          )
          .map((block) => ({ ...block, children: walk(block.children) }));
      if (metadata) {
        const type = p.file.mime.startsWith('image/')
          ? 'image'
          : p.file.mime.startsWith('video/')
            ? 'video'
            : p.file.mime.startsWith('audio/')
              ? 'audio'
              : 'file';
        const block: Block = {
          id: id('block'),
          type,
          props: { url: ref, name: p.file.name, caption: '' },
          content: [],
          children: [],
        };
        if (p.target.afterBlockId) {
          let inserted = false;
          const insert = (items: Block[]) => {
            const i = items.findIndex((b) => b.id === p.target.afterBlockId);
            if (i >= 0) {
              items.splice(i + 1, 0, block);
              inserted = true;
            } else for (const b of items) insert(b.children);
          };
          insert(blocks);
          if (!inserted) return fail('INVALID_INPUT');
        } else blocks.push(block);
      }
      next = { ...object, blocks: metadata ? blocks : walk(blocks) };
    }
    // The newly prepared asset is authorized only as part of this target-bound command.
    const recheck = () => {
      this.writable();
      if (field) {
        this.db(db!.id);
        if (!this.options.runtime.can(object, 'update', field.id)) fail('PERMISSION_DENIED');
      } else if (object.id !== this.options.pageId) this.targetPage(object.id);
    };
    if (
      !field &&
      !same(
        flatten(object.blocks ?? []).filter((b) => b.type === 'appSlice'),
        flatten(next.blocks ?? []).filter((b) => b.type === 'appSlice'),
      )
    )
      fail('PERMISSION_DENIED');
    const existing = new Set(this.objects().map((o) => o.id));
    if (metadata && existing.has(metadata.id)) return fail('INVALID_INPUT');
    this.origin = this.options.blockId;
    try {
      await this.options.runtime.checked(
        [...new Map([this.page(), object, ...(db ? [db] : [])].map((o) => [o.id, o])).values()],
        [next, ...(metadata ? [metadata] : [])],
        recheck,
        { assets },
      );
    } finally {
      this.origin = undefined;
    }
    const updated = this.objects().find((o) => o.id === object.id) ?? next;
    return { ref, version: this.version(updated) };
  }
  async invoke(
    method: string,
    input: unknown = {},
    requestId = crypto.randomUUID(),
    binary?: Uint8Array,
  ): Promise<unknown> {
    const encoded = JSON.stringify([method, input]);
    if (encoded.length > 2_000_000) return Promise.reject(new AppSliceError('INVALID_INPUT'));
    try {
      this.page();
      const p = input as Record<string, unknown>;
      if (p?.databaseId !== undefined) {
        if (typeof p.databaseId !== 'string') fail('INVALID_INPUT');
        this.db(p.databaseId as string);
      }
      if (
        /\.(create|update|delete|insertBlocks|updateBlock|removeBlock|write|remove)$/.test(method)
      )
        this.writable();
    } catch (error) {
      return Promise.reject(error);
    }
    const previous = this.receipts.get(requestId);
    if (previous)
      return previous.input === encoded
        ? previous.result
        : Promise.reject(new AppSliceError('INVALID_INPUT'));
    if (binary) {
      if (method !== 'attachments.write') fail('INVALID_INPUT');
      const file = (input as any)?.file;
      try {
        validateAssetSize(binary.byteLength, this.options.runtime.attachmentPolicy.maxFileBytes);
      } catch {
        return fail('ASSET_TOO_LARGE');
      }
      const digest = Array.from(
        new Uint8Array(await crypto.subtle.digest('SHA-256', binary as Uint8Array<ArrayBuffer>)),
        (b) => b.toString(16).padStart(2, '0'),
      ).join('');
      if (!file || file.byteSize !== binary.byteLength || file.digest !== digest)
        fail('INVALID_INPUT');
      // Hashing yields; another retry may already have installed the same receipt.
      const existing = this.receipts.get(requestId);
      if (existing) return existing.input === encoded ? existing.result : fail('INVALID_INPUT');
    }
    if (method === 'attachments.write' && !binary) fail('INVALID_INPUT');
    if (
      method.startsWith('attachments.') &&
      !['attachments.write', 'attachments.remove'].includes(method)
    )
      return this.execute(method, input as Record<string, any>, binary);
    if (this.receipts.size >= 10_000)
      return Promise.reject(
        new AppSliceError('RATE_LIMITED', 'Restart this App Slice to begin a new request session'),
      );
    const result = this.tail.then(() => this.execute(method, input as Record<string, any>, binary));
    this.tail = result.catch(() => undefined);
    this.receipts.set(requestId, { input: encoded, result });
    return result;
  }
  private async execute(method: string, p: Record<string, any>, binary?: Uint8Array) {
    this.page();
    if (!p || typeof p !== 'object' || Array.isArray(p)) fail('INVALID_INPUT');
    if (method.startsWith('attachments.')) return this.attachment(method, p, binary);
    if (method === 'context.get')
      return {
        ...this.options.context(),
        apiVersion: 1,
        attachmentPolicy: this.options.runtime.attachmentPolicy,
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
          next.blocks = updateBlock(
            blocks,
            p.id,
            pageMethod === 'page.removeBlock' ? undefined : p.changes,
          );
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
      const { database: db, view } = createDatabase(
        this.options.workspaceId,
        p.name,
        p.fields,
        this.page().id,
      );
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
        records: page.entries.map((e) => this.output(e.projection)),
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
        if (field.type === 'files')
          this.validateAssetRefs(
            Array.isArray(value) ? value : [],
            Array.isArray(old?.properties?.[key]) ? (old.properties![key] as unknown[]) : [],
          );
        if (field.type === 'mention') {
          const previous = old?.properties?.[key];
          this.validateMentions(mentionReferences(value), mentionReferences(previous));
        }
      }
      const next = changeRecord(db.workspaceId, db.id, values, old, method === 'records.delete');
      await this.commit([db, ...(old ? [old] : [])], [next]);
      return method === 'records.delete'
        ? null
        : this.output(this.objects().find((o) => o.id === next.id) ?? next);
    }
    if (method.startsWith('fields.')) {
      this.checkVersion(db, p.version);
      const nextFields = changeFields(db, method, p);
      const next = { ...db, fields: nextFields };
      const affected =
        method === 'fields.delete'
          ? views
              .map((view) => ({ before: view, after: removeViewField(view, p.id) }))
              .filter((pair) => !same(pair.before, pair.after))
          : [];
      await this.commit(
        [db, ...affected.map((pair) => pair.before)],
        [next, ...affected.map((pair) => pair.after)],
      );
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
      const next = changeView(db, changes, old, method === 'views.delete');
      await this.commit([db, ...(old ? [old] : [])], [next]);
      return method === 'views.delete' ? null : this.output(next);
    }
    return fail('INVALID_INPUT');
  }
}
