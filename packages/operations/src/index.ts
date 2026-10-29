import { createFlowModel } from '@tio/automation/model';
import {
  assertJson,
  blockMentions,
  createDomain,
  id,
  object,
  readableObject,
  validate,
  visible,
  validateFieldReference,
  validateValue,
  type Block,
  type Field,
  type TioObject,
  type AutomationRule,
} from '@tio/core';
import { type WorkspaceRuntime } from '@tio/workspace';

import { definition, definitions, parseInput, type OperationName } from './contracts';
import { OperationError, errorResult } from './errors';
import {
  changeFields,
  changeRecord,
  changeView,
  createDatabase,
  flatten,
  updateBlock,
  removeViewField,
} from './mutations';
export { definitions, definition, toolArguments } from './contracts';
export { OperationError, errorResult } from './errors';
export type { OperationName } from './contracts';
export interface ObjectRead {
  object: TioObject;
  version: string;
}
export interface ConfirmedWrite {
  objects: ObjectRead[];
  persistence: 'confirmed';
  remoteSync: 'host-managed';
}
export type OperationResult =
  | { status: 'completed'; value: unknown }
  | { status: 'failed'; error: ReturnType<typeof errorResult> }
  | { status: 'pending'; requestId: string };
export interface OperationOptions {
  runtime: WorkspaceRuntime;
  workspaceId: string;
  isActive?: () => boolean;
  /** Platform-neutral current navigation context. */
  context?: () => Record<string, unknown>;
  /** Host injects the shared editor schema validator, loaded only for content writes. */
  validateBlocks?: (before: Block[], after: Block[]) => Promise<void>;
  describeContent?: () => Promise<unknown>;
}
interface Receipt {
  signature: string;
  result?: OperationResult;
  promise: Promise<OperationResult>;
}
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const canonical = (v: unknown): string =>
  JSON.stringify(v, (_k, x) =>
    x && typeof x === 'object' && !Array.isArray(x)
      ? Object.fromEntries(Object.entries(x).sort(([a], [b]) => a.localeCompare(b)))
      : x,
  );
const flow = createFlowModel((key) => key);
/** A host-bound application service, sharing the editor's live runtime and persistence queue. */
export class WorkspaceOperations {
  readonly sessionId = crypto.randomUUID();
  private closed = false;
  private versions = new Map<string, { id: string; signature: string }>();
  private receipts = new Map<string, Receipt>();
  private tail: Promise<unknown> = Promise.resolve();
  constructor(private options: OperationOptions) {}
  dispose() {
    this.closed = true;
    this.versions.clear();
  }
  private live(check: () => void) {
    if (this.closed || this.options.isActive?.() === false) throw new OperationError('closed');
    check();
  }
  async describe(name?: string) {
    if (
      name &&
      (name.startsWith('blocks.') || name === 'pages.create' || name === 'records.create')
    )
      return { ...definition(name), contentSchema: await this.options.describeContent?.() };
    return name
      ? (definition(name) ?? null)
      : definitions.map(({ name, write, description }) => ({ name, write, description }));
  }
  private signature(o: TioObject) {
    const db = o.databaseId
      ? this.options.runtime.snapshot().find((d) => d.id === o.databaseId)
      : undefined;
    return canonical([o, db]);
  }
  private output(o: TioObject) {
    if (o.workspaceId !== this.options.workspaceId) throw new OperationError('permission');
    const readable = readableObject(this.options.runtime.access, o);
    if (!readable) throw new OperationError('permission');
    const signature = this.signature(o);
    let token = [...this.versions].find(([, v]) => v.id === o.id && v.signature === signature)?.[0];
    if (!token) {
      token = crypto.randomUUID();
      this.versions.set(token, { id: o.id, signature });
    }
    if (this.versions.size > 10000) this.versions.delete(this.versions.keys().next().value!);
    return { object: structuredClone(readable), version: token };
  }
  private async get(objectId: string, check: () => void) {
    await this.options.runtime.ensure([objectId]);
    this.live(check);
    let o = this.options.runtime
      .snapshot()
      .find((o) => o.id === objectId && o.workspaceId === this.options.workspaceId);
    if (!o) throw new OperationError('unavailable');
    if (o.databaseId) {
      await this.options.runtime.ensure([o.databaseId]);
      this.live(check);
      o = this.options.runtime.snapshot().find((x) => x.id === objectId)!;
    }
    if (!readableObject(this.options.runtime.access, o)) throw new OperationError('permission');
    if (!o.deleted && !visible(o, this.options.runtime.snapshot()))
      throw new OperationError('unavailable');
    return o;
  }
  private checkVersion(o: TioObject, token: string) {
    const saved = this.versions.get(token);
    if (!saved || saved.id !== o.id || saved.signature !== this.signature(o))
      throw new OperationError('conflict');
  }
  async result(requestId: string, check: () => void): Promise<OperationResult> {
    this.live(check);
    const receipt = this.receipts.get(requestId);
    return (
      receipt?.result ??
      (receipt
        ? { status: 'pending', requestId }
        : {
            status: 'failed',
            error: { code: 'unavailable', message: 'Request is not in this session' },
          })
    );
  }
  async invoke(
    name: string,
    input: unknown,
    requestId: string | undefined,
    check: () => void,
  ): Promise<OperationResult> {
    try {
      this.live(check);
      const def = definition(name);
      if (!def) throw new OperationError('unsupported');
      assertJson(input);
      if (canonical(input).length > 2_000_000) throw new OperationError('limit');
      const parsed = parseInput(name as OperationName, input);
      if (!def.write) {
        const value = await this.execute(name as OperationName, parsed, check);
        this.live(check);
        return { status: 'completed', value };
      }
      if (!requestId || requestId.length > 200)
        throw new OperationError('invalid', 'A stable requestId is required');
      const signature = canonical([name, parsed]);
      const old = this.receipts.get(requestId);
      if (old) {
        if (old.signature !== signature)
          throw new OperationError('invalid', 'requestId reused with different input');
        return this.awaitResult(old, requestId, check);
      }
      if (this.receipts.size >= 10000) throw new OperationError('limit');
      const receipt: Receipt = {
        signature,
        promise: Promise.resolve({ status: 'pending', requestId }),
      };
      receipt.promise = this.tail
        .then(async (): Promise<OperationResult> => {
          try {
            this.live(check);
            const value = await this.execute(name as OperationName, parsed, check);
            this.live(check);
            return { status: 'completed', value };
          } catch (error) {
            return { status: 'failed', error: errorResult(error) };
          }
        })
        .then((result) => {
          receipt.result = result;
          return result;
        });
      this.tail = receipt.promise;
      this.receipts.set(requestId, receipt);
      return this.awaitResult(receipt, requestId, check);
    } catch (error) {
      return { status: 'failed', error: errorResult(error) };
    }
  }
  private async awaitResult(
    receipt: Receipt,
    requestId: string,
    check: () => void,
  ): Promise<OperationResult> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const result = await Promise.race([
        receipt.promise,
        new Promise<OperationResult>((resolve) => {
          timer = setTimeout(() => resolve({ status: 'pending', requestId }), 12000);
        }),
      ]);
      this.live(check);
      return result;
    } catch (error) {
      return { status: 'failed', error: errorResult(error) };
    } finally {
      clearTimeout(timer);
    }
  }
  private async commit(
    expected: TioObject[],
    changes: TioObject[],
    check: () => void,
    expectedWorkspaceVersion?: number,
  ) {
    const runtime = this.options.runtime;
    const dependencies = new Map(expected.map((o) => [o.id, o]));
    const need = new Set<string>();
    for (const next of changes) {
      if (next.workspaceId !== this.options.workspaceId) throw new OperationError('permission');
      if (next.parentId) need.add(next.parentId);
      if (next.databaseId) need.add(next.databaseId);
      for (const ref of blockMentions(next.blocks ?? [])) {
        if (ref.workspaceId !== this.options.workspaceId)
          throw new OperationError('invalid', 'Cross-workspace mention');
        // Existing broken mentions remain valid opaque references.
        if (
          !blockMentions(expected.find((o) => o.id === next.id)?.blocks ?? []).some((old) =>
            same(old, ref),
          ) &&
          ref.kind !== 'github-user'
        )
          need.add(ref.id);
      }
      for (const field of next.fields ?? [])
        if (field.targetDatabaseId) need.add(field.targetDatabaseId);
      if (next.type === 'record') {
        const db = await this.get(next.databaseId!, check);
        for (const field of db.fields ?? []) {
          const value = next.properties?.[field.id];
          const before = expected.find((o) => o.id === next.id)?.properties?.[field.id];
          if (same(value, before)) continue;
          if (field.targetDatabaseId) need.add(field.targetDatabaseId);
          if (field.type === 'relation')
            for (const ref of Array.isArray(value) ? value : [value])
              if (typeof ref === 'string') need.add(ref);
          if (field.type === 'files')
            for (const ref of Array.isArray(value) ? value : [])
              if (typeof ref === 'string') need.add(ref.slice(6));
        }
      }
      if (next.type === 'automation' && !next.deleted) {
        validate(next);
        if (!runtime.automation) throw new OperationError('unsupported');
        if ((next as AutomationRule).trigger?.parentId)
          need.add((next as AutomationRule).trigger.parentId!);
        const dbs = await runtime.queryObjects({ type: 'database' });
        this.live(check);
        for (const db of dbs) dependencies.set(db.id, db);
        const issues = flow.flowIssues(
          flow.editFlow(next as AutomationRule),
          dbs,
          runtime.automation.capabilities,
        );
        if (Object.keys(issues).length)
          throw new OperationError('invalid', Object.values(issues)[0], Object.keys(issues)[0]);
      }
      const before = expected.find((o) => o.id === next.id);
      if (next.blocks && !same(next.blocks, before?.blocks)) {
        if (next.blocks.length && !this.options.validateBlocks)
          throw new OperationError('unsupported', 'Content validation is not available');
        await this.options.validateBlocks?.(before?.blocks ?? [], next.blocks);
        for (const b of flatten(next.blocks)) {
          if (flatten(before?.blocks ?? []).some((old) => same(old, b))) continue;
          if (b.type === 'databaseView') {
            for (const ref of [b.props.databaseId, b.props.viewId])
              if (typeof ref === 'string') need.add(ref);
              else throw new OperationError('invalid', 'Invalid database embed');
          }
          for (const value of Object.values(b.props))
            if (typeof value === 'string' && value.startsWith('asset:')) need.add(value.slice(6));
        }
      }
      validate(next);
      for (const image of [next.icon, next.cover])
        if (
          image &&
          typeof image === 'object' &&
          'url' in image &&
          typeof image.url === 'string' &&
          image.url.startsWith('asset:')
        )
          need.add(image.url.slice(6));
    }
    for (const dep of need) {
      if (changes.some((o) => o.id === dep)) continue;
      const o = await this.get(dep, check);
      if (!dependencies.has(dep)) dependencies.set(dep, o);
    }
    this.live(check);
    const candidate = [
      ...runtime.snapshot().filter((o) => !changes.some((n) => n.id === o.id)),
      ...changes,
    ];
    for (const next of changes) {
      if (!createDomain().objects.supports(next)) throw new OperationError('unsupported');
      if (next.type === 'record' && !next.deleted) {
        const db = candidate.find(
          (o) => o.id === next.databaseId && o.type === 'database' && !o.deleted,
        );
        if (!db) throw new OperationError('invalid', 'Database unavailable');
        for (const [fieldId, value] of Object.entries(next.properties ?? {})) {
          if (same(expected.find((o) => o.id === next.id)?.properties?.[fieldId], value)) continue;
          const field = db.fields?.find((f) => f.id === fieldId);
          if (!field)
            throw new OperationError('invalid', 'Field unavailable', '/properties/' + fieldId);
          validateValue(field, value);
          validateFieldReference(field, value, next, candidate);
        }
      }
      if (next.type === 'database' && !next.deleted)
        for (const field of next.fields ?? []) {
          if (
            field.type === 'relation' &&
            (!field.targetDatabaseId ||
              !candidate.some(
                (o) => o.id === field.targetDatabaseId && o.type === 'database' && !o.deleted,
              ))
          )
            throw new OperationError('invalid', 'Invalid relation database', '/fields/' + field.id);
        }
      if (next.type === 'databaseView' && !next.deleted) {
        const db = candidate.find(
          (o) => o.id === next.databaseId && o.type === 'database' && !o.deleted,
        );
        if (!db) throw new OperationError('invalid');
        const ids = new Set(db.fields?.map((f) => f.id));
        const refs = [
          ...(next.visibleFieldIds ?? []),
          ...(next.fieldOrder ?? []),
          ...(next.filters ?? []).map((f) => f.fieldId),
          ...(next.sorts ?? []).map((s) => s.fieldId),
          ...(next.groupBy ? [next.groupBy] : []),
        ];
        if (refs.some((ref) => !ids.has(ref)))
          throw new OperationError('invalid', 'View refers to missing field');
      }
    }
    for (const next of changes)
      for (const b of flatten(next.blocks ?? [])) {
        if (b.type !== 'databaseView') continue;
        const db = candidate.find((o) => o.id === b.props.databaseId);
        const view = candidate.find((o) => o.id === b.props.viewId);
        const before = expected.find((o) => o.id === next.id);
        if (flatten(before?.blocks ?? []).some((old) => same(old, b))) continue;
        if (
          db?.type !== 'database' ||
          db.deleted ||
          view?.type !== 'databaseView' ||
          view.deleted ||
          view.databaseId !== db.id
        )
          throw new OperationError('invalid', 'Invalid database embed');
      }
    // Both dependencies and edited objects are checked again at the authoritative commit boundary.
    const originals = [...dependencies.values()];
    await runtime.externalWrite(
      originals,
      changes,
      () => this.live(check),
      expectedWorkspaceVersion,
    );
    return {
      objects: changes.map((next) =>
        this.output(runtime.snapshot().find((o) => o.id === next.id) ?? next),
      ),
      persistence: 'confirmed',
      remoteSync: 'host-managed',
    };
  }
  private async execute(
    name: OperationName,
    p: Record<string, any>,
    check: () => void,
  ): Promise<unknown> {
    const { runtime, workspaceId } = this.options;
    this.live(check);
    if (name === 'context.get') {
      const workspace = await this.get(workspaceId, check);
      return {
        sessionId: this.sessionId,
        workspace: this.output(workspace),
        ...this.options.context?.(),
        writable: runtime.state.getState().writable,
        automation: runtime.automation?.capabilities ?? null,
      };
    }
    if (name === 'objects.get') return this.output(await this.get(p.id, check));
    if (name === 'objects.list') {
      let cursor = p.cursor as string | undefined;
      const rows: TioObject[] = [];
      let nextCursor: string | null = null;
      do {
        const page = await runtime.queryObjectPage({
          scope: p.databaseId ? { databaseId: p.databaseId } : { type: p.type },
          after: cursor,
          limit: p.limit + 1,
        });
        this.live(check);
        for (const entry of page.entries) {
          const o = entry.object;
          if (
            o.workspaceId !== workspaceId ||
            o.type !== p.type ||
            (!p.includeDeleted && o.deleted) ||
            (!o.deleted && !visible(o, [...runtime.snapshot(), o]))
          )
            continue;
          if (rows.length === p.limit) {
            nextCursor = rows.at(-1)!.id;
            break;
          }
          rows.push(o);
        }
        if (nextCursor || !page.next) break;
        if (page.next === cursor) throw new OperationError('invalid');
        cursor = page.next;
      } while (cursor !== undefined);
      if (p.databaseId) await this.get(p.databaseId, check);
      return { objects: rows.map((o) => this.output(o)), nextCursor };
    }
    if (name === 'objects.search') {
      const result = await runtime.search({ text: p.text, after: p.cursor, limit: p.limit });
      this.live(check);
      return {
        ...result,
        items: result.items.flatMap((o) => {
          if (o.workspaceId !== workspaceId) return [];
          const readable = readableObject(runtime.access, o);
          return readable ? [readable] : [];
        }),
      };
    }
    if (name === 'automations.runs')
      return {
        capabilities: runtime.automation?.capabilities ?? null,
        runs: runtime.automation?.getRuns() ?? [],
      };
    if (name === 'records.query') {
      const db = await this.get(p.databaseId, check);
      if (db.type !== 'database' || db.deleted) throw new OperationError('invalid');
      const view = p.viewId ? await this.get(p.viewId, check) : { ...db, filters: [], sorts: [] };
      if (p.viewId && view.databaseId !== db.id) throw new OperationError('invalid');
      const result = await runtime.records({
        databaseId: db.id,
        view: { ...view, filters: p.filters ?? view.filters, sorts: p.sorts ?? view.sorts },
        after: p.cursor,
        limit: p.limit,
      });
      this.live(check);
      return {
        objects: result.entries.map((e) => this.output(e.object)),
        nextCursor: result.next ?? null,
      };
    }
    let expectedWorkspaceVersion: number | undefined;
    const associatedChanges: TioObject[] = [];
    const expected: TioObject[] = [];
    let changes: TioObject[] = [];
    const target = p.id ? await this.get(p.id, check) : undefined;
    if (target) {
      if (target.type === 'workspace' || target.type === 'asset')
        throw new OperationError('unsupported');
      this.checkVersion(target, p.version);
      expected.push(target);
      if (target.deleted && name !== 'objects.restore') throw new OperationError('unavailable');
    }
    if (name === 'pages.create')
      changes = [
        object('page', workspaceId, {
          title: p.title,
          parentId: p.parentId ?? null,
          blocks: p.blocks,
        }),
      ];
    else if (name === 'databases.create') {
      const fields = p.fields?.map((f: Field) => ({ ...f, id: f.id ?? id('field') }));
      const pair = createDatabase(workspaceId, p.name, fields, p.parentId ?? null);
      changes = [pair.database, pair.view];
    } else if (name === 'records.create') {
      const db = await this.get(p.databaseId, check);
      if (db.type !== 'database' || db.deleted) throw new OperationError('invalid');
      expected.push(db);
      changes = [{ ...changeRecord(workspaceId, db.id, p.properties), blocks: p.blocks }];
    } else if (name === 'automations.create') {
      changes = [object('automation', workspaceId, { ...p, enabled: p.enabled ?? false })];
      if (changes[0].condition === null) delete changes[0].condition;
    } else if (name === 'views.create') {
      const db = await this.get(p.databaseId, check);
      if (db.type !== 'database' || db.deleted) throw new OperationError('invalid');
      expected.push(db);
      changes = [changeView(db, p.changes)];
    } else if (target) {
      let next = structuredClone(target);
      if (name === 'objects.delete') next.deleted = true;
      else if (name === 'objects.restore') next.deleted = false;
      else if (name === 'pages.update') {
        if (
          !['page', 'record'].includes(target.type) ||
          (target.type === 'record' && ('title' in p.changes || 'appMode' in p.changes))
        )
          throw new OperationError('invalid');
        next = { ...next, ...p.changes };
      } else if (name.startsWith('blocks.')) {
        if (!['page', 'record'].includes(target.type)) throw new OperationError('invalid');
        if (name === 'blocks.update')
          next.blocks = updateBlock(next.blocks ?? [], p.blockId, p.changes);
        else if (name === 'blocks.remove') next.blocks = updateBlock(next.blocks ?? [], p.blockId);
        else {
          const insert = (items: Block[]) => {
            const at = p.beforeId ? items.findIndex((b) => b.id === p.beforeId) : items.length;
            if (at < 0) throw new OperationError('invalid');
            return [...items.slice(0, at), ...p.blocks, ...items.slice(at)];
          };
          next.blocks = p.parentBlockId
            ? updateBlock(next.blocks ?? [], p.parentBlockId, {
                children: insert(
                  flatten(next.blocks ?? []).find((b) => b.id === p.parentBlockId)?.children ?? [],
                ),
              })
            : insert(next.blocks ?? []);
        }
      } else if (name === 'databases.update') {
        if (target.type !== 'database') throw new OperationError('invalid');
        next.name = p.name;
      } else if (name === 'records.update') {
        if (target.type !== 'record') throw new OperationError('invalid');
        next = changeRecord(workspaceId, target.databaseId!, p.properties, target);
      } else if (name.startsWith('fields.')) {
        expectedWorkspaceVersion = (
          await runtime.queryObjectPage({ scope: { type: 'database' }, limit: 1 })
        ).version;
        this.live(check);
        if (target.type !== 'database') throw new OperationError('invalid');
        next.fields = changeFields(target, name, {
          field: p.field,
          id: p.fieldId,
          changes: p.changes,
        });
        const rules = await runtime.queryObjects({ type: 'automation' });
        const databases = await runtime.queryObjects({ type: 'database' });
        this.live(check);
        for (const rule of rules) {
          if (rule.deleted) continue;
          const typed = rule as AutomationRule;
          if (
            typed.trigger.databaseId !== target.id &&
            !typed.actions.some((a) => a.databaseId === target.id)
          )
            continue;
          const candidateDbs = databases.map((db) => (db.id === next.id ? next : db));
          const issues = flow.flowIssues(
            flow.editFlow(typed),
            candidateDbs,
            runtime.automation?.capabilities,
          );
          if (Object.keys(issues).length)
            throw new OperationError(
              'invalid',
              'Field change invalidates automation ' + rule.id,
              Object.keys(issues)[0],
            );
          expected.push(rule);
        }
        if (name === 'fields.delete') {
          const views = await runtime.queryObjects({ type: 'databaseView' });
          this.live(check);
          for (const view of views.filter((v) => v.databaseId === target.id && !v.deleted)) {
            const nextView = removeViewField(view, p.fieldId);
            if (!same(view, nextView)) {
              expected.push(view);
              associatedChanges.push(nextView);
            }
          }
        }
        // Validate retained values and rule dependencies for changed field definitions.
        const records = await runtime.queryObjects({ databaseId: target.id });
        this.live(check);
        for (const row of records)
          if (row.type === 'record' && !row.deleted) {
            expected.push(row);
            for (const field of next.fields ?? []) {
              if (
                same(
                  field,
                  target.fields?.find((f) => f.id === field.id),
                )
              )
                continue;
              const value = row.properties?.[field.id];
              if (value !== undefined) validateValue(field, value);
            }
          }
      } else if (name === 'views.update') {
        if (target.type !== 'databaseView') throw new OperationError('invalid');
        next = changeView(await this.get(target.databaseId!, check), p.changes, target);
      } else if (name === 'automations.update') {
        if (target.type !== 'automation') throw new OperationError('invalid');
        next = { ...next, ...p.changes };
        if (next.condition === null) delete next.condition;
      } else throw new OperationError('unsupported');
      changes = [next, ...associatedChanges];
    } else throw new OperationError('unsupported');
    for (const next of changes) {
      if (next.parentId) {
        const parent = await this.get(next.parentId, check);
        if (parent.deleted || parent.type !== 'page')
          throw new OperationError('invalid', 'Invalid parent');
      }
    }
    return this.commit(expected, changes, check, expectedWorkspaceVersion);
  }
}
