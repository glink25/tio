import { id, object, type Field, type TioObject } from '@tio/core';
import { createEvaluator, displayValue } from '@tio/database';
import { convertValue, inferColumn } from '@tio/database/conversion';

export interface TableData {
  name: string;
  headers: string[];
  rows: unknown[][];
  fields?: Field[];
}
export const independent = (type: string) =>
  [
    'title',
    'text',
    'number',
    'boolean',
    'date',
    'select',
    'multiSelect',
    'status',
    'url',
    'email',
    'phone',
  ].includes(type);
export function cellText(value: unknown): string {
  if (value == null) return '';
  if (typeof value === 'object') return JSON.stringify(value);
  return typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean'
    ? String(value)
    : '';
}
export function importTable(table: TableData, workspaceId: string, parentId: string): TioObject[] {
  const width = table.rows.reduce((max, row) => Math.max(max, row.length), table.headers.length);
  if (!width) throw new Error('Empty table');
  const names = new Set<string>();
  const fields: Field[] = Array.from({ length: width }, (_, i) => {
    const original = table.fields?.[i];
    const base = table.headers[i]?.trim() || `Column ${i + 1}`;
    let name = base,
      suffix = 2;
    while (names.has(name)) name = `${base} (${suffix++})`;
    names.add(name);
    const type =
      i === 0
        ? 'title'
        : original && independent(original.type)
          ? original.type
          : table.fields
            ? 'text'
            : inferColumn(table.rows.map((r) => r[i]));
    return {
      ...(original && independent(original.type) ? original : {}),
      id: id('field'),
      name,
      type,
      ...(original?.options
        ? { options: original.options.map((o) => ({ ...o, id: id('option') })) }
        : {}),
    };
  });
  const database = object('database', workspaceId, {
    name: table.name,
    parentId,
    order: Date.now(),
    fields,
  });
  const records = table.rows
    .filter((row) => row.some((v) => v != null && v !== ''))
    .map((row) => {
      const properties = Object.fromEntries(
        fields.map((field, i) => {
          const raw = row[i];
          const original = table.fields?.[i];
          // Table cells contain option labels, not the original workspace's option IDs.
          const source: Field = { id: 'input', name: '', type: 'text' };
          const value =
            original?.type === 'multiSelect' && typeof raw === 'string'
              ? (() => {
                  try {
                    const v: unknown = JSON.parse(raw);
                    return Array.isArray(v) ? v : raw;
                  } catch {
                    return raw;
                  }
                })()
              : raw;
          if (field.type === 'multiSelect' && Array.isArray(value)) {
            const labels = [...new Set(value.map(String))];
            field.options ??= [];
            return [
              field.id,
              labels.map((label) => {
                let option = field.options!.find((o) => o.label === label);
                if (!option) {
                  option = { id: id('option'), label, color: 'gray' };
                  field.options!.push(option);
                }
                return option.id;
              }),
            ];
          }
          return [
            field.id,
            field.type === 'title' || field.type === 'text'
              ? cellText(raw)
              : convertValue(value, source, field),
          ];
        }),
      );
      return object('record', workspaceId, { databaseId: database.id, properties, blocks: [] });
    });
  return [
    database,
    object('databaseView', workspaceId, {
      databaseId: database.id,
      name: table.name,
      layout: 'table',
      visibleFieldIds: fields.map((f) => f.id),
      filters: [],
      sorts: [],
    }),
    ...records,
  ];
}
export function exportTable(
  database: TioObject,
  records: TioObject[],
  objects: TioObject[],
  typed = false,
): TableData {
  const fields = [...(database.fields ?? [])].sort(
    (a, b) => Number(b.type === 'title') - Number(a.type === 'title'),
  );
  const evaluator = createEvaluator(objects);
  return {
    name: database.name || 'Untitled',
    headers: fields.map((f) => f.name),
    fields,
    rows: records.map((record) =>
      fields.map((field) => {
        const result = evaluator.read(record, field);
        if (result.error) return result.error;
        const value = result.value;
        if (['number', 'boolean'].includes(field.type)) return value ?? null;
        if (
          field.type === 'date' &&
          !typed &&
          value &&
          typeof value === 'object' &&
          'start' in value
        ) {
          const date = value as { start: string; end?: string };
          return date.end ? `${date.start} → ${date.end}` : date.start;
        }
        if (typed && independent(field.type)) {
          if (field.type === 'date') return value == null ? '' : JSON.stringify(value);
          if (field.type === 'multiSelect')
            return JSON.stringify(
              (Array.isArray(value) ? value : []).map(
                (v) => field.options?.find((o) => o.id === v)?.label ?? String(v),
              ),
            );
        }
        return displayValue(value, field, objects, 'en');
      }),
    ),
  };
}
