import type { DateValue, Field, TioObject } from './index';
import { isMentionReference } from './mentions';

export const isDerivedField = (field: Field) =>
  ['formula', 'rollup', 'createdTime', 'lastEditedTime'].includes(field.type);
export const fieldColors = [
  'gray',
  'brown',
  'orange',
  'yellow',
  'green',
  'blue',
  'purple',
  'pink',
  'red',
] as const;
export const rollupOperations = [
  'values',
  'unique',
  'count',
  'countNotEmpty',
  'sum',
  'average',
  'min',
  'max',
  'earliest',
  'latest',
] as const;
export interface FieldDefinition {
  type: string;
  validate(value: unknown, field: Field): boolean;
  derived?: boolean;
}
export class FieldRegistry {
  private definitions = new Map<string, FieldDefinition>();
  register(definition: FieldDefinition) {
    if (this.definitions.has(definition.type))
      throw new Error(`Field already registered: ${definition.type}`);
    this.definitions.set(definition.type, definition);
    return this;
  }
  get(type: string) {
    return this.definitions.get(type);
  }
  validate(field: Field, value: unknown) {
    const definition = this.get(field.type);
    if (definition?.derived) throw new Error(`Read-only field: ${field.id}`);
    if (value == null) return;
    if (definition && !definition.validate(value, field))
      throw new Error(`Invalid ${field.type} value: ${field.id}`);
  }
}
const strings = (value: unknown): value is string[] =>
  Array.isArray(value) &&
  value.every((item) => typeof item === 'string') &&
  new Set(value).size === value.length;
export function validDatePart(value: string): boolean {
  if (/^\d{4}-\d{2}-\d{2}$/.test(value))
    return (
      Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value
    );
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})$/.test(value))
    return false;
  return (
    validDatePart(value.slice(0, 10)) &&
    Number(value.slice(11, 13)) < 24 &&
    Number(value.slice(14, 16)) < 60 &&
    Number.isFinite(Date.parse(value))
  );
}
export function validTimeZone(zone: string) {
  try {
    new Intl.DateTimeFormat('en', { timeZone: zone });
    return true;
  } catch {
    return false;
  }
}
export function isDateValue(value: unknown): value is DateValue {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const date = value as DateValue;
  return (
    typeof date.start === 'string' &&
    validDatePart(date.start) &&
    (date.timeZone === undefined ||
      (typeof date.timeZone === 'string' && validTimeZone(date.timeZone))) &&
    (date.end === undefined ||
      (typeof date.end === 'string' &&
        validDatePart(date.end) &&
        date.start.includes('T') === date.end.includes('T') &&
        Date.parse(date.end) >= Date.parse(date.start)))
  );
}
export function validateFieldDefinition(field: Field) {
  if (field.numberFormat && !['number', 'percent', 'currency'].includes(field.numberFormat))
    throw new Error('Invalid number format');
  if (field.currency && !/^[A-Z]{3}$/.test(field.currency)) throw new Error('Invalid currency');
  if (
    field.formula !== undefined &&
    (typeof field.formula !== 'string' || field.formula.length > 10000)
  )
    throw new Error('Invalid formula');
  if (
    field.rollup &&
    (!rollupOperations.includes(field.rollup.operation) ||
      typeof field.rollup.relationFieldId !== 'string' ||
      typeof field.rollup.targetFieldId !== 'string')
  )
    throw new Error('Invalid rollup');
  for (const option of field.options ?? []) {
    if (option.color && !fieldColors.includes(option.color as (typeof fieldColors)[number]))
      throw new Error('Invalid option color');
    if (option.group && !['todo', 'doing', 'done'].includes(option.group))
      throw new Error('Invalid status group');
  }
}
export function validateFieldReference(
  field: Field,
  value: unknown,
  record: TioObject,
  objects: TioObject[],
) {
  if (value == null) return;
  if (
    field.type === 'mention' &&
    (!isMentionReference(value) || value.workspaceId !== record.workspaceId)
  )
    throw new Error('Invalid mention workspace');
  if (field.type === 'relation') {
    const target = objects.find(
      (o) =>
        o.id === field.targetDatabaseId &&
        o.type === 'database' &&
        o.workspaceId === record.workspaceId &&
        !o.deleted,
    );
    const ids = Array.isArray(value) ? value : [value];
    if (
      !target ||
      ids.some(
        (id) =>
          !objects.some(
            (o) => o.id === id && o.type === 'record' && o.databaseId === target.id && !o.deleted,
          ),
      )
    )
      throw new Error('Invalid relation target');
  }
  if (
    field.type === 'files' &&
    (value as string[]).some(
      (ref) =>
        !objects.some(
          (o) =>
            o.id === ref.slice(6) &&
            o.type === 'asset' &&
            o.workspaceId === record.workspaceId &&
            !o.deleted,
        ),
    )
  )
    throw new Error('Invalid attachment reference');
}
export function createFieldRegistry() {
  const registry = new FieldRegistry();
  registry.register({ type: 'mention', validate: isMentionReference });
  for (const type of ['title', 'text', 'phone'])
    registry.register({
      type,
      validate: (v) =>
        typeof v === 'string' && (type !== 'phone' || v === '' || /^[+\d\s().-]+$/.test(v)),
    });
  for (const type of ['select', 'status'])
    registry.register({
      type,
      validate: (v, f) => typeof v === 'string' && !!f.options?.some((o) => o.id === v),
    });
  registry.register({
    type: 'url',
    validate: (v) => {
      if (v === '') return true;
      try {
        return typeof v === 'string' && ['http:', 'https:'].includes(new URL(v).protocol);
      } catch {
        return false;
      }
    },
  });
  registry.register({
    type: 'email',
    validate: (v) => typeof v === 'string' && (v === '' || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)),
  });
  registry.register({
    type: 'number',
    validate: (v) => typeof v === 'number' && Number.isFinite(v),
  });
  registry.register({ type: 'boolean', validate: (v) => typeof v === 'boolean' });
  registry.register({
    type: 'multiSelect',
    validate: (v, f) => strings(v) && v.every((id) => f.options?.some((o) => o.id === id)),
  });
  registry.register({
    type: 'relation',
    validate: (v, f) => (f.multiple === false ? typeof v === 'string' : strings(v)),
  });
  registry.register({
    type: 'files',
    validate: (v) => strings(v) && v.every((ref) => /^asset:[a-zA-Z0-9_-]+$/.test(ref)),
  });
  registry.register({ type: 'date', validate: isDateValue });
  for (const type of ['formula', 'rollup', 'createdTime', 'lastEditedTime'])
    registry.register({ type, derived: true, validate: () => false });
  return registry;
}
export const validateValue = (field: Field, value: unknown) =>
  createFieldRegistry().validate(field, value);
