import {
  id,
  mentionReferences,
  createFieldRegistry,
  isDateValue,
  isDerivedField,
  validateValue,
  validateFieldReference,
  type Field,
  type TioObject,
} from '@tio/core';

import { createEvaluator, displayValue } from './index';

const choices = (type: string) => ['select', 'multiSelect', 'status'].includes(type);
export function parseNumber(text: string): number | null {
  const value = text.trim();
  if (!/^[+-]?(?:0|[1-9]\d*)(?:\.\d+)?(?:e[+-]?\d+)?$/i.test(value)) return null;
  const n = Number(value);
  return Number.isFinite(n) &&
    Math.abs(n) <= Number.MAX_SAFE_INTEGER &&
    value.replace(/[^0-9]/g, '').replace(/^0+/, '').length <= 15
    ? n
    : null;
}
export function parseDate(value: unknown) {
  if (isDateValue(value)) return value;
  if (typeof value !== 'string') return null;
  // Exported dates include ranges and zones without relying on locale parsing.
  if (value.startsWith('{')) {
    try {
      const parsed: unknown = JSON.parse(value);
      return isDateValue(parsed) ? parsed : null;
    } catch {
      return null;
    }
  }
  const date = { start: value.trim() };
  return isDateValue(date) ? date : null;
}
export function inferColumn(values: unknown[]): Field['type'] {
  const items = values.filter((v) => v != null && !(typeof v === 'string' && v.trim() === ''));
  if (!items.length) return 'text';
  if (
    items.every(
      (v) => typeof v === 'boolean' || (typeof v === 'string' && /^(true|false)$/i.test(v.trim())),
    )
  )
    return 'boolean';
  if (
    items.every(
      (v) => (typeof v === 'string' || typeof v === 'number') && parseNumber(String(v)) !== null,
    )
  )
    return 'number';
  if (
    items.every(
      (v) => isDateValue(v) || (typeof v === 'string' && isDateValue({ start: v.trim() })),
    )
  )
    return 'date';
  return 'text';
}
/** Conversion mutates only the supplied draft's options, never the source field. */
export function convertValue(
  value: unknown,
  source: Field,
  target: Field,
  objects: TioObject[] = [],
  record?: TioObject,
): unknown {
  if (isDerivedField(target)) return undefined;
  if (value == null || value === '')
    return target.type === 'mention' && target.multiple !== false ? [] : null;
  const text = displayValue(value, source, objects, 'en');
  let next: unknown = null;
  if (['text', 'title'].includes(target.type)) next = text;
  else if (target.type === 'number')
    next =
      typeof value === 'number'
        ? Number.isFinite(value)
          ? value
          : null
        : typeof value === 'boolean'
          ? Number(value)
          : parseNumber(text);
  else if (target.type === 'boolean') {
    const token = text.trim().toLowerCase();
    next =
      typeof value === 'boolean'
        ? value
        : ['true', '1'].includes(token)
          ? true
          : ['false', '0'].includes(token)
            ? false
            : null;
  } else if (target.type === 'date') next = parseDate(value) ?? parseDate(text);
  else if (choices(target.type)) {
    const labels = choices(source.type)
      ? (Array.isArray(value) ? value : [value])
          .map((v) => source.options?.find((o) => o.id === v)?.label)
          .filter((v): v is string => v !== undefined)
      : target.type === 'multiSelect'
        ? text
            .split(/[,\n]/)
            .map((v) => v.trim())
            .filter(Boolean)
        : [text];
    const ids = [...new Set(labels)].map((label) => {
      target.options ??= [];
      let option = target.options.find((o) => o.label === label);
      if (!option) {
        option = {
          id: id('option'),
          label,
          color: 'gray',
          ...(target.type === 'status' ? { group: 'todo' as const } : {}),
        };
        target.options.push(option);
      }
      return option.id;
    });
    next = target.type === 'multiSelect' ? ids : (ids[0] ?? null);
  } else if (['url', 'email', 'phone'].includes(target.type)) next = text.trim();
  else if (target.type === 'mention') {
    const refs = source.type === 'mention' ? mentionReferences(value) : [];
    next = target.multiple === false ? (refs[0] ?? null) : refs;
  } else if (target.type === 'relation' && source.type === 'relation') {
    const refs = Array.isArray(value) ? value : [value];
    next = target.multiple === false ? (refs[0] ?? null) : refs;
  } else if (['relation', 'files'].includes(target.type)) next = value;
  try {
    validateValue(target, next);
    if (record) validateFieldReference(target, next, record, objects);
    else if (['relation', 'mention', 'files'].includes(target.type)) return null;
    return next;
  } catch {
    return null;
  }
}
export function convertColumn(
  database: TioObject,
  source: Field,
  target: Field,
  objects: TioObject[],
) {
  if (!createFieldRegistry().get(source.type) || !createFieldRegistry().get(target.type))
    throw new Error('Unsupported field conversion');
  if (source.type === 'title' || target.type === 'title') throw new Error('Title type is fixed');
  const field = structuredClone(target);
  const evaluator = createEvaluator(objects);
  let cleared = 0;
  const records = objects.filter(
    (o) => o.type === 'record' && o.databaseId === database.id && !o.deleted,
  );
  const changes = records.map((record) => {
    const result = evaluator.read(record, source);
    const previous = result.error ? null : result.value;
    const value = convertValue(previous, source, field, objects, record);
    if (previous != null && previous !== '' && value == null && !isDerivedField(field)) cleared++;
    const properties = { ...record.properties };
    if (value === undefined) delete properties[field.id];
    else properties[field.id] = value;
    return { ...record, properties };
  });
  return {
    cleared,
    changes: [
      { ...database, fields: database.fields?.map((f) => (f.id === field.id ? field : f)) },
      ...changes,
    ],
  };
}
