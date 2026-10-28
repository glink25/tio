import {
  id,
  object,
  isDerivedField,
  validateAutomation,
  validateValue,
  type AutomationAction,
  type AutomationCondition,
  type AutomationRule,
  type AutomationTrigger,
  type AutomationValue,
  type AutomationCapabilities,
  type Field,
  type TioObject,
} from '@tio/core';
import { t, type TranslationKey } from '@tio/i18n';
export type DraftAction = Omit<AutomationAction, 'kind'> & { kind?: AutomationAction['kind'] };
export interface FlowDraft {
  id: string;
  name: string;
  trigger?: AutomationTrigger;
  condition?: AutomationCondition;
  actions: DraftAction[];
  original?: AutomationRule;
}
export interface Variable {
  path: string;
  label: string;
  group: string;
  field: Field;
  recordDatabaseId?: string;
  many?: boolean;
}
export const editableFields = (database?: TioObject) =>
  database?.fields?.filter((field) => !isDerivedField(field)) ?? [];
export const titleField: Field = { id: 'id', name: 'ID', type: 'text' };
export function blankFlow(): FlowDraft {
  return { id: id('automation'), name: t('automation.newRule'), actions: [] };
}
export function editFlow(rule: AutomationRule): FlowDraft {
  return {
    id: rule.id,
    name: rule.name,
    trigger: structuredClone(rule.trigger),
    condition: rule.condition ? structuredClone(rule.condition) : undefined,
    actions: structuredClone(rule.actions),
    original: structuredClone(rule),
  };
}
export function blankAction(): DraftAction {
  return { id: id('step'), databaseId: '' };
}
export function variables(draft: FlowDraft, databases: TioObject[], index = 0): Variable[] {
  if (!draft.trigger) return [];
  const trigger = draft.trigger;
  const database = databases.find((d) => d.id === trigger.databaseId);
  const deleted = trigger.kind.endsWith('.deleted');
  const created = trigger.kind.endsWith('.created');
  const sources = ['trigger', ...(!created ? ['before'] : []), ...(!deleted ? ['after'] : [])];
  const result: Variable[] = [];
  for (const source of sources) {
    const group = `${t('automation.step', { number: 1 })} · ${t(`automation.source.${source}` as TranslationKey)}`;
    for (const key of ['id', 'title', 'body'])
      result.push({
        path: `${source}.${key}`,
        label: t(`automation.page.${key}` as TranslationKey),
        group,
        field: { id: key, name: key, type: 'text' },
        ...(key === 'id' && database ? { recordDatabaseId: database.id } : {}),
      });
    if (trigger.kind.startsWith('page.')) {
      for (const multiple of [false, true]) {
        const key = multiple ? 'mentions' : 'mention';
        result.push({
          path: `${source}.${key}`,
          label: t('automation.triggerPage'),
          group,
          field: { id: key, name: t('automation.triggerPage'), type: 'mention', multiple },
        });
      }
    }
    for (const field of editableFields(database))
      result.push({ path: `${source}.properties.${field.id}`, label: field.name, group, field });
  }
  draft.actions.slice(0, index).forEach((action, i) => {
    if (action.kind && action.kind !== 'record.delete' && action.databaseId)
      result.push({
        path: `steps.${action.id}.ids`,
        label: t('automation.resultRecords'),
        group: t('automation.step', { number: i + 2 }),
        field: titleField,
        recordDatabaseId: action.databaseId,
        many: true,
      });
  });
  result.push(
    {
      path: 'event.time',
      label: t('automation.eventTime'),
      group: t('automation.event'),
      field: { id: 'time', name: 'Time', type: 'text' },
    },
    {
      path: 'event.id',
      label: t('automation.eventId'),
      group: t('automation.event'),
      field: titleField,
    },
  );
  return result;
}
export function compatible(variable: Variable, field: Field, recordDatabaseId?: string) {
  if (recordDatabaseId) return variable.recordDatabaseId === recordDatabaseId;
  if (field.type === 'relation' && variable.recordDatabaseId)
    return (
      field.targetDatabaseId === variable.recordDatabaseId &&
      (field.multiple !== false) === !!variable.many
    );
  if (variable.many) return false;
  const text = ['title', 'text', 'url', 'email', 'phone'];
  if (text.includes(field.type) && text.includes(variable.field.type)) return true;
  if (field.type !== variable.field.type) return false;
  if (['select', 'status', 'multiSelect'].includes(field.type))
    return field.id === variable.field.id;
  if (field.type === 'mention')
    return (field.multiple !== false) === (variable.field.multiple !== false);
  if (field.type === 'relation')
    return (
      field.targetDatabaseId === variable.field.targetDatabaseId &&
      field.multiple === variable.field.multiple
    );
  return true;
}
export function conditionFields(draft: FlowDraft, databases: TioObject[]) {
  return draft.trigger?.kind.startsWith('record.')
    ? editableFields(databases.find((db) => db.id === draft.trigger?.databaseId))
    : ['id', 'title', 'body'].map((key): Field => ({
        id: key,
        name: t(`automation.page.${key}` as TranslationKey),
        type: 'text',
      }));
}
export function operators(field: Field): AutomationCondition['filters'][number]['op'][] {
  const basic: AutomationCondition['filters'][number]['op'][] = ['eq', 'empty', 'notEmpty'];
  if (['number', 'date'].includes(field.type))
    return [...basic, 'gt', 'gte', 'lt', 'lte', 'between'];
  if (['text', 'title', 'url', 'email', 'phone'].includes(field.type))
    return ['eq', 'contains', 'empty', 'notEmpty'];
  return basic;
}
export function comparisonField(
  field: Field,
  op: AutomationCondition['filters'][number]['op'],
): Field {
  if (op !== 'eq') return field;
  if (field.type === 'multiSelect') return { ...field, type: 'select' };
  if (field.type === 'mention' || field.type === 'relation') return { ...field, multiple: false };
  if (field.type === 'files') return { ...field, type: 'text' };
  return field;
}
export function flowIssues(
  draft: FlowDraft,
  databases: TioObject[],
  capabilities?: AutomationCapabilities,
): Record<string, TranslationKey> {
  const issues: Record<string, TranslationKey> = {};
  if (!draft.name.trim()) issues.name = 'automation.requiredName';
  if (!draft.trigger) issues.trigger = 'automation.chooseTrigger';
  else if (!capabilities?.triggers.includes(draft.trigger.kind))
    issues.trigger = 'automation.unsupportedRule';
  else if (
    draft.trigger.kind.startsWith('record.') &&
    !databases.some((d) => d.id === draft.trigger?.databaseId)
  )
    issues.trigger = 'automation.chooseDatabase';
  const checkValue = (
    value: AutomationValue | undefined,
    field: Field,
    vars: Variable[],
    key: string,
    recordDatabaseId?: string,
  ) => {
    if (!value) {
      issues[key] = 'automation.invalidInput';
      return;
    }
    if (value.kind === 'reference') {
      const variable = vars.find((v) => v.path === value.path);
      if (!variable || !compatible(variable, field, recordDatabaseId))
        issues[key] = 'automation.invalidReference';
    } else if (recordDatabaseId) {
      if (typeof value.value !== 'string' || !value.value.trim())
        issues[key] = 'automation.chooseRecord';
    } else {
      try {
        validateValue(field, value.value);
      } catch {
        issues[key] = 'automation.invalidInput';
      }
    }
  };
  const checkCondition = (
    condition: AutomationCondition | undefined,
    fields: Field[],
    vars: Variable[],
    key: string,
  ) =>
    condition?.filters.forEach((filter, i) => {
      const field = fields.find((f) => f.id === filter.fieldId);
      const path = `${key}.${i}`;
      if (!field) {
        issues[path] = 'automation.missingField';
        return;
      }
      if (!operators(field).includes(filter.op)) issues[path] = 'automation.invalidInput';
      const input = comparisonField(field, filter.op);
      if (!['empty', 'notEmpty'].includes(filter.op))
        checkValue(filter.value, input, vars, `${path}.value`);
      if (filter.op === 'between') checkValue(filter.endValue, input, vars, `${path}.endValue`);
    });
  const triggerVars = variables(draft, databases);
  if (draft.trigger?.kind === 'record.entersCondition' && !draft.condition?.filters.length)
    issues.condition = 'automation.requiredCondition';
  checkCondition(draft.condition, conditionFields(draft, databases), triggerVars, 'condition');
  if (
    draft.trigger?.fieldIds?.some(
      (id) => !conditionFields(draft, databases).some((f) => f.id === id),
    )
  )
    issues.trigger = 'automation.missingField';
  if (!draft.actions.length) issues.actions = 'automation.chooseAction';
  draft.actions.forEach((action, index) => {
    const key = `actions.${action.id}`;
    if (!action.kind) {
      issues[key] = 'automation.chooseAction';
      return;
    }
    if (!capabilities?.actions.includes(action.kind)) issues[key] = 'automation.unsupportedRule';
    const database = databases.find((d) => d.id === action.databaseId);
    if (!database) {
      issues[key] = 'automation.chooseDatabase';
      return;
    }
    const vars = variables(draft, databases, index);
    if (action.kind !== 'record.create') {
      const target = action.target;
      if (
        !target ||
        (target.kind === 'trigger' &&
          (!draft.trigger?.kind.startsWith('record.') ||
            draft.trigger.databaseId !== action.databaseId))
      )
        issues[`${key}.target`] = 'automation.chooseRecord';
      if (target?.kind === 'record')
        checkValue(target.id, titleField, vars, `${key}.target`, action.databaseId);
      if (target?.kind === 'matching')
        checkCondition(target.condition, editableFields(database), vars, `${key}.target`);
    }
    if (action.kind !== 'record.delete') {
      for (const [fieldId, value] of Object.entries(action.properties ?? {})) {
        const field = editableFields(database).find((f) => f.id === fieldId);
        if (!field) issues[`${key}.properties.${fieldId}`] = 'automation.missingField';
        else checkValue(value, field, vars, `${key}.properties.${fieldId}`);
      }
      if (action.body) {
        const matches = [...action.body.template.matchAll(/\{\{\s*([^{}]+?)\s*\}\}/g)];
        if (
          matches.some((match) => !vars.some((v) => v.path === match[1].trim())) ||
          /\{\{|\}\}/.test(action.body.template.replace(/\{\{\s*([^{}]+?)\s*\}\}/g, ''))
        )
          issues[`${key}.body`] = 'automation.invalidReference';
      }
    }
  });
  return issues;
}
export function toRule(draft: FlowDraft, workspaceId: string, enabled: boolean): AutomationRule {
  return validateAutomation({
    ...(draft.original ?? object('automation', workspaceId, { id: draft.id })),
    name: draft.name.trim(),
    enabled,
    trigger: draft.trigger,
    condition: draft.condition,
    actions: draft.actions,
  });
}
export function flowSummary(draft: Pick<FlowDraft, 'trigger' | 'actions'>, databases: TioObject[]) {
  if (!draft.trigger) return t('automation.summaryEmpty');
  const database = databases.find((d) => d.id === draft.trigger?.databaseId);
  const trigger = t(`automation.${draft.trigger.kind}` as TranslationKey);
  const actions = draft.actions
    .filter((a) => a.kind)
    .map((a) => t(`automation.${a.kind!}` as TranslationKey))
    .join(t('automation.then'));
  return `${database?.name ? `${database.name} · ` : ''}${trigger} → ${actions || t('automation.chooseAction')}`;
}
