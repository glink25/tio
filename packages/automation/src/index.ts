import {
  automationTriggers,
  automationActions,
  validateAutomation,
  object,
  textBlock,
  id,
  isDerivedField,
  valueText,
  resourceOf,
  readableObject,
  type AutomationRule,
  type AutomationCondition,
  type AutomationAction,
  type AutomationProvider,
  type AutomationCapabilities,
  type AutomationRun,
  type AutomationTriggerKind,
  type CommittedMutation,
  type TioObject,
  type Filter,
  type Field,
} from '@tio/core';
import { queryRecords } from '@tio/database';
import type { WorkspaceRuntime } from '@tio/workspace';

import { AutomationError, errorCode } from './errors';
import { resolve, bodyText, renderTemplate, type EventContext } from './values';
export { AutomationError } from './errors';
export { bodyText, reference, resolve, renderTemplate, type EventContext } from './values';
export const sessionAutomationCapabilities: AutomationCapabilities = {
  triggers: [...automationTriggers],
  actions: [...automationActions],
  execution: 'session',
  eventSources: ['editor', 'ai', 'automation', 'undo', 'redo'],
  dependencies: 'on-demand',
  interruption: 'abandon',
  history: 'session',
  limits: { depth: 8, runs: 100, writes: 1000 },
};
export function ruleUnsupported(rule: AutomationRule, capabilities?: AutomationCapabilities) {
  return (
    !capabilities ||
    !capabilities.triggers.includes(rule.trigger.kind) ||
    rule.actions.some((a) => !capabilities.actions.includes(a.kind))
  );
}
export function eventKinds(
  before: TioObject | undefined,
  after: TioObject,
): AutomationTriggerKind[] {
  if (!['page', 'record'].includes(after.type)) return [];
  if (!before)
    return after.deleted ? [] : [after.type === 'page' ? 'page.created' : 'record.created'];
  if (before.deleted) return [];
  if (after.deleted) return [after.type === 'page' ? 'page.deleted' : 'record.deleted'];
  if (after.type === 'page') return [];
  const kinds: AutomationTriggerKind[] = [];
  if (JSON.stringify(before.properties) !== JSON.stringify(after.properties))
    kinds.push('record.properties');
  if (JSON.stringify(before.blocks) !== JSON.stringify(after.blocks)) kinds.push('record.body');
  if (kinds.length) kinds.push('record.entersCondition');
  return kinds;
}
/** Conditions share the table's filter evaluator. Missing/derived fields are explicit errors. */
export function matchesCondition(
  condition: AutomationCondition | undefined,
  record: TioObject,
  database: TioObject | undefined,
  context: EventContext,
): boolean {
  if (!condition || !condition.filters.length) return true;
  const pageFields: Field[] = ['id', 'title', 'body'].map((key) => ({
    id: key,
    name: key,
    type: 'text',
  }));
  const db = database ?? { ...record, type: 'database', fields: pageFields };
  const row = database
    ? { ...record, deleted: false }
    : {
        ...record,
        type: 'record',
        databaseId: db.id,
        deleted: false,
        properties: { id: record.id, title: record.title ?? '', body: bodyText(record.blocks) },
      };
  const results = condition.filters.map((filter) => {
    const field = db.fields?.find((f) => f.id === filter.fieldId);
    if (!field || isDerivedField(field)) throw new AutomationError('invalid');
    const resolved: Filter = {
      ...filter,
      value: filter.value ? resolve(filter.value, context) : undefined,
      endValue: filter.endValue ? resolve(filter.endValue, context) : undefined,
    };
    return queryRecords([db, row], db, { ...db, filters: [resolved], sorts: [] }).length > 0;
  });
  return condition.mode === 'all' ? results.every(Boolean) : results.some(Boolean);
}
interface Budget {
  runs: number;
  writes: number;
}
/** Provider-owned session driver. Servers may feed authoritative mutations with observe=false. */
export class AutomationRunner implements AutomationProvider {
  readonly capabilities: AutomationCapabilities;
  private runs: AutomationRun[] = [];
  private listeners = new Set<() => void>();
  private seen = new Set<string>();
  private budgets = new Map<string, Budget>();
  private queue: CommittedMutation[] = [];
  private working?: Promise<void>;
  private closed = false;
  private unsubscribe: () => void;
  constructor(
    private runtime: WorkspaceRuntime,
    private workspaceId: string,
    options: { capabilities?: AutomationCapabilities; observe?: boolean } = {},
  ) {
    this.capabilities = structuredClone(options.capabilities ?? sessionAutomationCapabilities);
    for (const key of ['depth', 'runs', 'writes'] as const) {
      const limit = this.capabilities.limits[key];
      if (
        !Number.isSafeInteger(limit) ||
        limit < 1 ||
        limit > sessionAutomationCapabilities.limits[key]
      )
        throw new AutomationError('invalid');
    }
    this.unsubscribe =
      options.observe === false
        ? () => {}
        : runtime.subscribeCommits((event) => this.accept(event));
  }
  getRuns = () => this.runs;
  subscribeRuns = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  private publish() {
    this.runs = [...this.runs];
    for (const listener of this.listeners) listener();
  }
  accept(mutation: CommittedMutation) {
    if (
      this.closed ||
      !this.capabilities.eventSources.includes(mutation.source.kind) ||
      this.seen.has(mutation.commitId)
    )
      return;
    this.seen.add(mutation.commitId);
    this.queue.push(structuredClone(mutation));
    this.schedule();
  }
  private schedule() {
    if (this.working || this.closed) return;
    this.working = Promise.resolve()
      .then(async () => {
        while (this.queue.length && !this.closed) await this.process(this.queue.shift()!);
      })
      .finally(() => {
        this.working = undefined;
        if (this.queue.length && !this.closed) this.schedule();
      });
  }
  async idle() {
    do {
      await this.working;
    } while (this.working);
  }
  private assertOpen() {
    if (this.closed) throw new AutomationError('closed');
  }
  private async read(id: string) {
    this.assertOpen();
    await this.runtime.ensure([id]);
    this.assertOpen();
    const load = this.runtime.state.getState().loads[id];
    if (load === 'denied') throw new AutomationError('permission');
    const result = this.runtime.snapshot().find((o) => o.id === id);
    if (
      !result ||
      result.workspaceId !== this.workspaceId ||
      !this.runtime.access.allows(resourceOf(result), 'read')
    )
      throw new AutomationError('unavailable');
    return readableObject(this.runtime.access, result)!;
  }
  private async database(id: string) {
    const database = await this.read(id);
    if (database.type !== 'database' || database.deleted) throw new AutomationError('unavailable');
    return database;
  }
  private async process(mutation: CommittedMutation) {
    let rules: AutomationRule[];
    try {
      rules = (await this.runtime.queryObjects({ type: 'automation' }))
        .filter((o) => !o.deleted && o.workspaceId === this.workspaceId)
        .map(validateAutomation);
    } catch (error) {
      this.runs.unshift({
        id: id('run'),
        ruleId: '',
        ruleName: '',
        eventId: mutation.commitId,
        rootEventId: mutation.commitId,
        status: this.closed ? 'interrupted' : 'failed',
        startedAt: new Date().toISOString(),
        error: errorCode(error),
        steps: [],
      });
      this.runs = this.runs.slice(0, 100);
      this.publish();
      return;
    }
    for (const change of mutation.changes) {
      if (change.after.workspaceId !== this.workspaceId) continue;
      for (const kind of eventKinds(change.before, change.after)) {
        const eventId = `${mutation.commitId}:${change.after.id}:${kind}`;
        for (const rule of rules) {
          if (this.closed) return;
          if (!rule.enabled || rule.trigger.kind !== kind) continue;
          const triggerObject = change.after.deleted ? change.before! : change.after;
          if (kind.startsWith('record.') && triggerObject.databaseId !== rule.trigger.databaseId)
            continue;
          if (
            kind.startsWith('page.') &&
            rule.trigger.parentId !== undefined &&
            (triggerObject.parentId ?? null) !== rule.trigger.parentId
          )
            continue;
          await this.run(rule, { id: eventId, mutation, ...change, steps: new Map() });
        }
      }
    }
  }
  private async run(rule: AutomationRule, context: EventContext) {
    const source = context.mutation.source;
    const parent = source.kind === 'automation' ? source.chain : undefined;
    const rootEventId = parent?.rootEventId ?? context.id;
    const path = parent?.rulePath ?? [];
    const run: AutomationRun = {
      id: id('run'),
      ruleId: rule.id,
      ruleName: rule.name,
      eventId: context.id,
      rootEventId,
      parentRunId: parent?.parentRunId,
      status: 'running',
      startedAt: new Date().toISOString(),
      steps: [],
    };
    this.runs.unshift(run);
    this.runs = this.runs.slice(0, 100);
    this.publish();
    try {
      if (ruleUnsupported(rule, this.capabilities)) throw new AutomationError('unsupported');
      if (path.includes(rule.id)) throw new AutomationError('cycle');
      const budget = this.budgets.get(rootEventId) ?? { runs: 0, writes: 0 };
      this.budgets.set(rootEventId, budget);
      if (
        path.length >= this.capabilities.limits.depth ||
        budget.runs >= this.capabilities.limits.runs
      )
        throw new AutomationError('limit');
      budget.runs++;
      const database = rule.trigger.databaseId
        ? await this.database(rule.trigger.databaseId)
        : undefined;
      if (database) {
        const titleId = database.fields?.find((field) => field.type === 'title')?.id;
        const titled = (record: TioObject) => ({
          ...record,
          title: valueText(record.properties?.[titleId ?? ''] ?? ''),
        });
        context = {
          ...context,
          before: context.before ? titled(context.before) : undefined,
          after: titled(context.after),
        };
      }
      if (rule.trigger.kind === 'record.properties') {
        const fields = rule.trigger.fieldIds?.length
          ? rule.trigger.fieldIds
          : (database?.fields?.filter((f) => !isDerivedField(f)).map((f) => f.id) ?? []);
        if (
          fields.some((key) => !database?.fields?.some((f) => f.id === key && !isDerivedField(f)))
        )
          throw new AutomationError('invalid');
        if (
          !fields.some(
            (key) =>
              JSON.stringify(context.before?.properties?.[key]) !==
              JSON.stringify(context.after.properties?.[key]),
          )
        ) {
          run.status = 'skipped';
          return;
        }
      }
      const target = context.after.deleted ? context.before! : context.after;
      const matches = matchesCondition(rule.condition, target, database, context);
      if (
        !matches ||
        (rule.trigger.kind === 'record.entersCondition' &&
          matchesCondition(rule.condition, context.before!, database, context))
      ) {
        run.status = 'skipped';
        return;
      }
      for (const action of rule.actions) {
        this.assertOpen();
        const step: AutomationRun['steps'][number] = {
          actionId: action.id,
          status: 'running',
          recordIds: [],
        };
        run.steps.push(step);
        this.publish();
        try {
          await this.action(action, context, run, [...path, rule.id], budget, step.recordIds);
          context.steps.set(action.id, [...step.recordIds]);
          step.status = step.recordIds.length ? 'success' : 'skipped';
        } catch (error) {
          step.error = errorCode(error);
          step.status = this.closed ? 'interrupted' : 'failed';
          throw error;
        }
        this.publish();
      }
      run.status = 'success';
    } catch (error) {
      run.error = errorCode(error);
      run.status =
        this.closed || run.error === 'closed'
          ? 'interrupted'
          : ['cycle', 'limit'].includes(run.error)
            ? 'skipped'
            : 'failed';
    } finally {
      this.publish();
    }
  }
  private async action(
    action: AutomationAction,
    context: EventContext,
    run: AutomationRun,
    rulePath: string[],
    budget: Budget,
    written: string[],
  ) {
    const database = await this.database(action.databaseId);
    let ids: string[];
    if (action.kind === 'record.create') ids = [id('record')];
    else if (action.target?.kind === 'trigger') {
      if (context.after.type !== 'record' || context.after.databaseId !== database.id)
        throw new AutomationError('invalid');
      ids = [context.after.id];
    } else if (action.target?.kind === 'record') {
      const value = resolve(action.target.id, context);
      if (typeof value === 'string') ids = [value];
      else if (Array.isArray(value) && value.every((id) => typeof id === 'string')) ids = value;
      else throw new AutomationError('variable');
    } else if (action.target?.kind === 'matching') {
      const condition = action.target.condition;
      ids = (await this.runtime.queryObjects({ databaseId: database.id }))
        .filter(
          (record) =>
            record.type === 'record' &&
            !record.deleted &&
            matchesCondition(condition, record, database, context),
        )
        .map((o) => o.id);
    } else throw new AutomationError('invalid');
    ids = [...new Set(ids)];
    const properties = Object.fromEntries(
      Object.entries(action.properties ?? {}).map(([key, value]) => {
        const field = database.fields?.find((f) => f.id === key);
        if (!field || isDerivedField(field)) throw new AutomationError('invalid');
        const resolved = resolve(value, context);
        try {
          this.runtime.domain.fields.validate(field, resolved);
        } catch {
          throw new AutomationError('invalid');
        }
        return [key, resolved];
      }),
    );
    const body = action.body
      ? renderTemplate(action.body.template, context)
          .split('\n')
          .map((line) => textBlock(line))
      : undefined;
    for (const recordId of ids) {
      this.assertOpen();
      if (budget.writes >= this.capabilities.limits.writes) throw new AutomationError('limit');
      const previous = action.kind === 'record.create' ? undefined : await this.read(recordId);
      if (previous && (previous.type !== 'record' || previous.databaseId !== database.id))
        throw new AutomationError('invalid');
      if (previous?.deleted) {
        if (action.kind === 'record.delete') continue;
        throw new AutomationError('unavailable');
      }
      const next = previous
        ? structuredClone(previous)
        : object('record', this.workspaceId, {
            id: recordId,
            databaseId: database.id,
            properties: {},
            blocks: [],
          });
      if (action.kind === 'record.delete') next.deleted = true;
      else {
        next.properties = { ...next.properties, ...properties };
        if (body)
          next.blocks =
            action.body!.mode === 'append'
              ? [...(next.blocks ?? []), ...structuredClone(body)]
              : structuredClone(body);
      }
      for (const [fieldId, value] of Object.entries(properties)) {
        const field = database.fields?.find((field) => field.id === fieldId);
        if (value == null) continue;
        if (field?.type === 'relation') {
          await this.database(field.targetDatabaseId!);
          for (const reference of Array.isArray(value) ? value : [value])
            await this.read(typeof reference === 'string' ? reference : '');
        } else if (field?.type === 'files') {
          for (const reference of value as string[]) await this.read(reference.slice(6));
        }
      }
      budget.writes++;
      await this.runtime.automationWrite(previous ? [database, previous] : [database], [next], {
        kind: 'automation',
        actionId: `${run.id}:${action.id}:${recordId}`,
        chain: { rootEventId: run.rootEventId, parentRunId: run.id, rulePath },
      });
      written.push(recordId);
      this.assertOpen();
    }
  }
  dispose() {
    this.closed = true;
    this.queue = [];
    this.unsubscribe();
    for (const run of this.runs)
      if (run.status === 'running') {
        run.status = 'interrupted';
        run.error = 'closed';
      }
    this.publish();
    this.listeners.clear();
  }
}
