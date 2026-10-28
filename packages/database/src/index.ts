import {
  isMentionReference,
  mentionKey,
  mentionReferences,
  mentionTitle,
  isDateValue,
  isDerivedField,
  valueText,
} from '@tio/core';
import type { Field, TioObject, RollupOperation } from '@tio/core';

import { localTimeZone } from './dates';
import { evaluateFormula, isEmpty, parseFormula } from './formula';
export * from './formula';
export * from './dates';
export { validateValue } from '@tio/core';
export interface FieldError {
  fieldError: string;
}
export const isFieldError = (value: unknown): value is FieldError =>
  !!value && typeof value === 'object' && 'fieldError' in value;
export type FieldResult =
  | { value: unknown; error?: undefined }
  | { value?: undefined; error: string };
export function allowedRollups(field: Field | undefined): RollupOperation[] {
  const base: RollupOperation[] = ['values', 'unique', 'count', 'countNotEmpty'];
  if (field?.type === 'number' || field?.type === 'formula' || field?.type === 'rollup')
    base.push('sum', 'average', 'min', 'max');
  if (['date', 'createdTime', 'lastEditedTime', 'formula', 'rollup'].includes(field?.type ?? ''))
    base.push('earliest', 'latest');
  return base;
}
/** One evaluator per immutable snapshot and clock tick; references share the same cache. */
export function createEvaluator(objects: TioObject[], now = new Date()) {
  const byId = new Map(objects.map((o) => [o.id, o]));
  const cache = new Map<string, FieldResult>(),
    active = new Set<string>();
  const compiled = new Map<string, ReturnType<typeof parseFormula>>();
  const read = (record: TioObject, field: Field): FieldResult => {
    const key = `${record.id}:${field.id}`;
    const cached = cache.get(key);
    if (cached) return cached;
    if (active.has(key) || active.size >= 100)
      return { error: 'Circular or excessive field dependency' };
    active.add(key);
    let result: FieldResult;
    try {
      const database = byId.get(record.databaseId ?? '');
      const resolve = (id: string) => {
        const target = database?.fields?.find((f) => f.id === id);
        if (!target) throw new Error(`Missing field: ${id}`);
        const value = read(record, target);
        if (value.error) throw new Error(value.error);
        if (['select', 'status'].includes(target.type))
          return target.options?.find((o) => o.id === value.value)?.label ?? null;
        if (target.type === 'multiSelect')
          return (Array.isArray(value.value) ? value.value : []).map(
            (id) => target.options?.find((o) => o.id === id)?.label ?? String(id),
          );
        return value.value;
      };
      let value: unknown;
      if (field.type === 'createdTime' || field.type === 'lastEditedTime') {
        const time = field.type === 'createdTime' ? record.createdAt : record.updatedAt;
        value = typeof time === 'string' ? { start: time, timeZone: localTimeZone() } : null;
      } else if (field.type === 'formula') {
        const source = field.formula ?? '';
        let node = compiled.get(source);
        if (!node) {
          node = parseFormula(source);
          compiled.set(source, node);
        }
        value = evaluateFormula(node, resolve, now);
      } else if (field.type === 'rollup') {
        const config = field.rollup;
        if (!config) throw new Error('Configure this rollup');
        const relation = database?.fields?.find(
          (f) => f.id === config.relationFieldId && f.type === 'relation',
        );
        const targetDb = byId.get(relation?.targetDatabaseId ?? '');
        const target = targetDb?.fields?.find((f) => f.id === config.targetFieldId);
        if (
          !relation ||
          !target ||
          !targetDb ||
          targetDb.deleted ||
          targetDb.workspaceId !== record.workspaceId
        )
          throw new Error('Missing rollup field or database');
        if (!allowedRollups(target).includes(config.operation))
          throw new Error('Invalid aggregation for this field');
        const refs = record.properties?.[relation.id];
        const linked = (Array.isArray(refs) ? refs : refs ? [refs] : []).flatMap((id) => {
          const row = byId.get(String(id));
          return row && !row.deleted && row.type === 'record' && row.databaseId === targetDb.id
            ? [row]
            : [];
        });
        const values = linked.map((row) => {
          const v = read(row, target);
          if (v.error) throw new Error(v.error);
          return v.value;
        });
        const filled = values.filter((v) => !isEmpty(v));
        switch (config.operation) {
          case 'values':
            value = values;
            break;
          case 'unique':
            value = [
              ...new Map(
                filled
                  .flatMap((v) => (Array.isArray(v) ? v : [v]))
                  .map((v) => [JSON.stringify(v), v]),
              ).values(),
            ];
            break;
          case 'count':
            value = linked.length;
            break;
          case 'countNotEmpty':
            value = filled.length;
            break;
          case 'earliest':
          case 'latest': {
            if (!filled.every(isDateValue)) throw new Error('Expected date values');
            const dates = filled.sort((a, b) => Date.parse(a.start) - Date.parse(b.start));
            value = (config.operation === 'earliest' ? dates[0] : dates.at(-1)) ?? null;
            break;
          }
          default: {
            if (!filled.every((v): v is number => typeof v === 'number' && Number.isFinite(v)))
              throw new Error('Expected numeric values');
            const sum = filled.reduce((a, b) => a + b, 0);
            value =
              config.operation === 'sum'
                ? sum
                : !filled.length
                  ? null
                  : config.operation === 'average'
                    ? sum / filled.length
                    : config.operation === 'min'
                      ? Math.min(...filled)
                      : Math.max(...filled);
          }
        }
      } else if (field.type === 'relation') {
        const raw = record.properties?.[field.id];
        const refs = (Array.isArray(raw) ? raw : raw ? [raw] : []).filter((id) => {
          const row = byId.get(String(id));
          return (
            row &&
            !row.deleted &&
            row.type === 'record' &&
            row.databaseId === field.targetDatabaseId &&
            row.workspaceId === record.workspaceId
          );
        });
        value = field.multiple === false ? (refs[0] ?? null) : refs;
      } else value = record.properties?.[field.id] ?? null;
      result = { value };
    } catch (error) {
      result = { error: error instanceof Error ? error.message : String(error) };
    }
    active.delete(key);
    cache.set(key, result);
    return result;
  };
  return {
    read,
    value(record: TioObject, field: Field) {
      const result = read(record, field);
      return result.error ? ({ fieldError: result.error } satisfies FieldError) : result.value;
    },
    project(record: TioObject, fields: Field[]) {
      return {
        ...record,
        properties: {
          ...record.properties,
          ...Object.fromEntries(
            fields.filter(isDerivedField).map((f) => [f.id, this.value(record, f)]),
          ),
        },
      };
    },
  };
}
export function displayValue(
  value: unknown,
  field: Field,
  objects: TioObject[] = [],
  language: 'en' | 'zh' = 'zh',
): string {
  if (value == null) return '';
  if (field.type === 'mention')
    return mentionReferences(value)
      .map(
        (ref) =>
          mentionTitle(ref, objects) ??
          (language === 'zh' ? '引用不可用' : 'Unavailable reference'),
      )
      .join(', ');
  if (isFieldError(value)) return `⚠ ${value.fieldError}`;
  if (['select', 'multiSelect', 'status'].includes(field.type))
    return (Array.isArray(value) ? value : [value])
      .map(
        (id) =>
          field.options?.find((o) => o.id === id)?.label ??
          (language === 'zh' ? `未知选项 ${id}` : `Unknown option ${id}`),
      )
      .join(', ');
  if (field.type === 'relation')
    return (Array.isArray(value) ? value : [value])
      .map((id) => {
        const record = objects.find((o) => o.id === id && !o.deleted);
        if (!record) return language === 'zh' ? '引用已失效' : 'Missing reference';
        const title = objects
          .find((o) => o.id === record.databaseId)
          ?.fields?.find((f) => f.type === 'title');
        return valueText(
          record.properties?.[title?.id ?? ''] ??
            (language === 'zh' ? '未命名记录' : 'Untitled record'),
        );
      })
      .join(', ');
  if (field.type === 'files')
    return (Array.isArray(value) ? value : [])
      .map(
        (ref) =>
          objects.find((o) => o.id === String(ref).slice(6) && !o.deleted)?.filename ??
          (language === 'zh' ? '附件不可用' : 'Missing attachment'),
      )
      .join(', ');
  if (field.type === 'boolean')
    return language === 'zh' ? (value ? '是' : '否') : value ? 'Yes' : 'No';
  if (isDateValue(value)) {
    const format = (part: string) =>
      part.includes('T')
        ? new Intl.DateTimeFormat(language === 'zh' ? 'zh-CN' : 'en-US', {
            timeZone: value.timeZone ?? localTimeZone(),
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit',
            hourCycle: 'h23',
          }).format(new Date(part))
        : part;
    return format(value.start) + (value.end ? ` → ${format(value.end)}` : '');
  }
  if (field.type === 'rollup' && Array.isArray(value) && field.rollup) {
    const owner = objects.find(
      (o) => o.type === 'database' && o.fields?.some((f) => f.id === field.id),
    );
    const relation = owner?.fields?.find((f) => f.id === field.rollup?.relationFieldId);
    const target = objects
      .find((o) => o.id === relation?.targetDatabaseId)
      ?.fields?.find((f) => f.id === field.rollup?.targetFieldId);
    if (target && !['rollup', 'formula'].includes(target.type))
      return value.map((v) => displayValue(v, target, objects, language)).join(', ');
  }
  if (typeof value === 'number')
    return new Intl.NumberFormat(
      language === 'zh' ? 'zh-CN' : 'en-US',
      field.numberFormat === 'currency'
        ? { style: 'currency', currency: field.currency ?? 'CNY' }
        : field.numberFormat === 'percent'
          ? { style: 'percent', maximumFractionDigits: 2 }
          : { maximumFractionDigits: 10 },
    ).format(value);
  if (Array.isArray(value))
    return value
      .map((v) => displayValue(v, { ...field, type: 'text' }, objects, language))
      .join(', ');
  return valueText(value);
}
const comparable = (v: unknown): string | number | boolean | null =>
  isDateValue(v)
    ? Date.parse(v.start)
    : typeof v === 'number' || typeof v === 'boolean' || typeof v === 'string'
      ? v
      : v == null
        ? null
        : valueText(v);
export function queryRecords(
  objects: TioObject[],
  database: TioObject,
  view: TioObject,
  evaluator = createEvaluator(objects),
) {
  let rows = objects
    .filter((o) => o.type === 'record' && o.databaseId === database.id && !o.deleted)
    .map((r) => evaluator.project(r, database.fields ?? []));
  for (const filter of view.filters ?? [])
    rows = rows.filter((record) => {
      const field = database.fields?.find((f) => f.id === filter.fieldId);
      if (!field) return true;
      const value = record.properties?.[field.id];
      if (isFieldError(value)) return false;
      const a = comparable(value),
        b = comparable(filter.value),
        end = comparable(filter.endValue);
      switch (filter.op) {
        case 'empty':
          return isEmpty(value);
        case 'notEmpty':
          return !isEmpty(value);
        case 'eq':
          if (field.type === 'mention') {
            const target = filter.value;
            return (
              isMentionReference(target) &&
              mentionReferences(value).some((ref) => mentionKey(ref) === mentionKey(target))
            );
          }
          return Array.isArray(value) ? value.includes(filter.value) : a === b;
        case 'gt':
        case 'gte':
        case 'lt':
        case 'lte':
        case 'between': {
          if (a == null || b == null || typeof a !== typeof b || typeof a === 'boolean')
            return false;
          const c = typeof a === 'number' ? a - Number(b) : a.localeCompare(String(b));
          if (filter.op === 'between')
            return (
              c >= 0 &&
              end != null &&
              typeof end === typeof a &&
              (typeof a === 'number' ? a <= Number(end) : a.localeCompare(String(end)) <= 0)
            );
          return filter.op === 'gt'
            ? c > 0
            : filter.op === 'gte'
              ? c >= 0
              : filter.op === 'lt'
                ? c < 0
                : c <= 0;
        }
        default:
          return displayValue(value, field, objects)
            .toLocaleLowerCase()
            .includes(valueText(filter.value ?? '').toLocaleLowerCase());
      }
    });
  return rows.sort((a, b) => {
    for (const sort of view.sorts ?? []) {
      const field = database.fields?.find((f) => f.id === sort.fieldId);
      if (!field) continue;
      const av = a.properties?.[field.id],
        bv = b.properties?.[field.id];
      const x = isFieldError(av) ? null : comparable(av),
        y = isFieldError(bv) ? null : comparable(bv);
      if (x == null || y == null) {
        if (x !== y) return x == null ? 1 : -1;
        continue;
      }
      const c =
        typeof x === 'number' && typeof y === 'number'
          ? x - y
          : displayValue(av, field, objects).localeCompare(
              displayValue(bv, field, objects),
              'zh-CN',
              { numeric: true },
            );
      if (c) return sort.direction === 'asc' ? c : -c;
    }
    return a.id.localeCompare(b.id);
  });
}
export function groups(records: TioObject[], field: Field | undefined) {
  const options = field?.options ?? [];
  return [
    ...options.map((o) => ({
      id: o.id,
      label: o.label,
      records: records.filter((r) => r.properties?.[field!.id] === o.id),
    })),
    {
      id: '',
      label: '未分组',
      records: records.filter(
        (r) => !field || !options.some((o) => o.id === r.properties?.[field.id]),
      ),
    },
  ];
}
