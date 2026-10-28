import type { Filter, Json, TioObject } from './index';
import { assertJson } from './json';

export const automationTriggers = [
  'page.created',
  'page.deleted',
  'record.created',
  'record.properties',
  'record.body',
  'record.deleted',
  'record.entersCondition',
] as const;
export const automationActions = ['record.create', 'record.update', 'record.delete'] as const;
export type AutomationTriggerKind = (typeof automationTriggers)[number];
export type AutomationActionKind = (typeof automationActions)[number];
export type AutomationValue =
  | { kind: 'literal'; value: Json }
  | { kind: 'reference'; path: string };
export interface AutomationCondition {
  mode: 'all' | 'any';
  filters: {
    fieldId: string;
    op: Filter['op'];
    value?: AutomationValue;
    endValue?: AutomationValue;
  }[];
}
export interface AutomationTrigger {
  kind: AutomationTriggerKind;
  databaseId?: string;
  parentId?: string | null;
  fieldIds?: string[];
}
export type AutomationTarget =
  | { kind: 'trigger' }
  | { kind: 'record'; id: AutomationValue }
  | { kind: 'matching'; condition: AutomationCondition };
export interface AutomationAction {
  id: string;
  kind: AutomationActionKind;
  databaseId: string;
  target?: AutomationTarget;
  properties?: Record<string, AutomationValue>;
  body?: { mode: 'append' | 'replace'; template: string };
}
export interface AutomationRule extends TioObject {
  type: 'automation';
  name: string;
  enabled: boolean;
  trigger: AutomationTrigger;
  condition?: AutomationCondition;
  actions: AutomationAction[];
}
export interface AutomationChain {
  rootEventId: string;
  parentRunId: string;
  rulePath: string[];
}
export type MutationSource =
  | { kind: 'editor' | 'ai' | 'import' | 'sync' | 'undo' | 'redo' }
  | { kind: 'automation'; chain: AutomationChain; actionId: string };
export interface CommittedMutation {
  commitId: string;
  source: MutationSource;
  timestamp: string;
  changes: { before?: TioObject; after: TioObject }[];
}
export type AutomationErrorCode =
  | 'invalid'
  | 'unsupported'
  | 'unavailable'
  | 'permission'
  | 'conflict'
  | 'timeout'
  | 'closed'
  | 'cycle'
  | 'limit'
  | 'variable'
  | 'io';
export interface AutomationRun {
  id: string;
  ruleId: string;
  ruleName: string;
  eventId: string;
  rootEventId: string;
  parentRunId?: string;
  status: 'running' | 'success' | 'skipped' | 'failed' | 'interrupted';
  startedAt: string;
  error?: AutomationErrorCode;
  steps: {
    actionId: string;
    status: AutomationRun['status'];
    recordIds: string[];
    error?: AutomationErrorCode;
  }[];
}
export interface AutomationCapabilities {
  triggers: AutomationTriggerKind[];
  actions: AutomationActionKind[];
  execution: 'session' | 'server';
  eventSources: MutationSource['kind'][];
  dependencies: 'on-demand';
  interruption: 'abandon' | 'provider-managed';
  history: 'session' | 'provider-managed';
  limits: { depth: number; runs: number; writes: number };
}
export interface AutomationProvider {
  readonly capabilities: AutomationCapabilities;
  getRuns(): readonly AutomationRun[];
  subscribeRuns(listener: () => void): () => void;
  dispose(): void;
}
const plain = (value: unknown): value is Record<string, any> =>
  !!value && typeof value === 'object' && !Array.isArray(value);
const identifier = (value: unknown): value is string =>
  typeof value === 'string' && /^[A-Za-z0-9_-]+$/.test(value);
export function validAutomationPath(path: unknown): path is string {
  return (
    typeof path === 'string' &&
    /^(event\.(id|time)|steps\.[A-Za-z0-9_-]+\.ids|(trigger|before|after)\.(id|title|body|mention|mentions|properties\.[A-Za-z0-9_-]+))$/.test(
      path,
    )
  );
}
function value(input: unknown) {
  if (
    !plain(input) ||
    !(input.kind === 'literal'
      ? Object.hasOwn(input, 'value')
      : input.kind === 'reference' && validAutomationPath(input.path))
  )
    throw new Error('Invalid automation value');
  if (input.kind === 'literal') assertJson(input.value);
}
function condition(input: unknown) {
  if (!plain(input) || !['all', 'any'].includes(input.mode) || !Array.isArray(input.filters))
    throw new Error('Invalid automation condition');
  for (const filter of input.filters) {
    if (
      !plain(filter) ||
      !identifier(filter.fieldId) ||
      !['contains', 'eq', 'notEmpty', 'empty', 'gt', 'gte', 'lt', 'lte', 'between'].includes(
        filter.op,
      )
    )
      throw new Error('Invalid automation filter');
    if (!['empty', 'notEmpty'].includes(filter.op)) value(filter.value);
    if (filter.op === 'between') value(filter.endValue);
  }
}
export function validateAutomation(input: TioObject): AutomationRule {
  if (
    typeof input.name !== 'string' ||
    typeof input.enabled !== 'boolean' ||
    !plain(input.trigger) ||
    !automationTriggers.includes(input.trigger.kind) ||
    !Array.isArray(input.actions) ||
    !input.actions.length
  )
    throw new Error('Invalid automation rule');
  const trigger = input.trigger;
  if (trigger.kind.startsWith('record.') && !identifier(trigger.databaseId))
    throw new Error('Invalid trigger database');
  if (trigger.parentId !== undefined && trigger.parentId !== null && !identifier(trigger.parentId))
    throw new Error('Invalid trigger parent');
  if (
    trigger.fieldIds !== undefined &&
    (!Array.isArray(trigger.fieldIds) ||
      !trigger.fieldIds.every(identifier) ||
      new Set(trigger.fieldIds).size !== trigger.fieldIds.length)
  )
    throw new Error('Invalid trigger fields');
  if (input.condition !== undefined) condition(input.condition);
  if (
    trigger.kind === 'record.entersCondition' &&
    (!plain(input.condition) || !input.condition.filters.length)
  )
    throw new Error('Condition required');
  const ids = new Set<string>();
  for (const action of input.actions) {
    if (
      !plain(action) ||
      !identifier(action.id) ||
      ids.has(action.id) ||
      !automationActions.includes(action.kind) ||
      !identifier(action.databaseId)
    )
      throw new Error('Invalid automation action');
    ids.add(action.id);
    if (action.kind !== 'record.create') {
      if (!plain(action.target) || !['trigger', 'record', 'matching'].includes(action.target.kind))
        throw new Error('Invalid automation target');
      if (action.target.kind === 'record') value(action.target.id);
      if (action.target.kind === 'matching') condition(action.target.condition);
    }
    if (action.properties !== undefined) {
      if (!plain(action.properties)) throw new Error('Invalid automation properties');
      for (const [key, entry] of Object.entries(action.properties)) {
        if (!identifier(key)) throw new Error('Invalid field');
        value(entry);
      }
    }
    if (action.body !== undefined) {
      if (
        !plain(action.body) ||
        !['append', 'replace'].includes(action.body.mode) ||
        typeof action.body.template !== 'string'
      )
        throw new Error('Invalid automation body');
      const template = action.body.template;
      const rest = template.replace(/\{\{\s*([^{}]+?)\s*\}\}/g, (_: string, path: string) => {
        if (!validAutomationPath(path.trim())) throw new Error('Invalid template variable');
        return '';
      });
      if (rest.includes('{{') || rest.includes('}}')) throw new Error('Invalid template');
    }
  }
  return input as AutomationRule;
}

/** Validate source metadata at persistence/transport boundaries; identity remains host-owned. */
export function validMutationSource(source: unknown): source is MutationSource {
  if (!plain(source)) return false;
  if (['editor', 'ai', 'import', 'sync', 'undo', 'redo'].includes(source.kind)) return true;
  return (
    source.kind === 'automation' &&
    typeof source.actionId === 'string' &&
    plain(source.chain) &&
    typeof source.chain.rootEventId === 'string' &&
    typeof source.chain.parentRunId === 'string' &&
    Array.isArray(source.chain.rulePath) &&
    source.chain.rulePath.length <= 8 &&
    source.chain.rulePath.every(identifier)
  );
}
export function validAutomationState(
  state: unknown,
): state is { capabilities: AutomationCapabilities; runs: AutomationRun[] } {
  if (!plain(state) || !plain(state.capabilities) || !Array.isArray(state.runs)) return false;
  const c = state.capabilities;
  if (
    !Array.isArray(c.triggers) ||
    !c.triggers.every((v: any) => automationTriggers.includes(v)) ||
    !Array.isArray(c.actions) ||
    !c.actions.every((v: any) => automationActions.includes(v)) ||
    !['session', 'server'].includes(c.execution) ||
    !['abandon', 'provider-managed'].includes(c.interruption) ||
    !['session', 'provider-managed'].includes(c.history) ||
    c.dependencies !== 'on-demand' ||
    !Array.isArray(c.eventSources) ||
    !c.eventSources.every((kind: string) =>
      ['editor', 'ai', 'import', 'sync', 'undo', 'redo', 'automation'].includes(kind),
    ) ||
    !plain(c.limits) ||
    !['depth', 'runs', 'writes'].every(
      (key) => Number.isSafeInteger(c.limits[key]) && c.limits[key] >= 1,
    )
  )
    return false;
  const status = (value: unknown) =>
    typeof value === 'string' &&
    ['running', 'success', 'skipped', 'failed', 'interrupted'].includes(value);
  const error = (value: unknown) =>
    value === undefined ||
    [
      'invalid',
      'unsupported',
      'unavailable',
      'permission',
      'conflict',
      'timeout',
      'closed',
      'cycle',
      'limit',
      'variable',
      'io',
    ].includes(typeof value === 'string' ? value : '');
  return state.runs.every(
    (run: unknown) =>
      plain(run) &&
      ['id', 'ruleId', 'ruleName', 'eventId', 'rootEventId', 'startedAt'].every(
        (key) => typeof run[key] === 'string',
      ) &&
      (run.parentRunId === undefined || typeof run.parentRunId === 'string') &&
      status(run.status) &&
      error(run.error) &&
      Array.isArray(run.steps) &&
      run.steps.every(
        (step: unknown) =>
          plain(step) &&
          typeof step.actionId === 'string' &&
          status(step.status) &&
          error(step.error) &&
          Array.isArray(step.recordIds) &&
          step.recordIds.every((id: unknown) => typeof id === 'string'),
      ),
  );
}
