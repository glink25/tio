import { valueText } from '@tio/core';
import type { Field, TioObject } from '@tio/core';
export function displayValue(
  value: unknown,
  field: Field,
  objects: TioObject[] = [],
  language: 'en' | 'zh' = 'zh',
): string {
  if (value === null || value === undefined) return '';
  if (field.type === 'select' || field.type === 'multiSelect')
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
        const r = objects.find((o) => o.id === id && !o.deleted);
        if (!r) return language === 'zh' ? '引用已失效' : 'Missing reference';
        const db = objects.find((o) => o.id === r.databaseId);
        const title = db?.fields?.find((f) => f.type === 'title');
        return valueText(
          r.properties?.[title?.id ?? ''] ?? (language === 'zh' ? '未命名记录' : 'Untitled record'),
        );
      })
      .join(', ');
  if (field.type === 'boolean')
    return language === 'zh' ? (value ? '是' : '否') : value ? 'Yes' : 'No';
  if (typeof value === 'object' && !Array.isArray(value) && value && 'date' in value)
    return valueText((value as any).date);
  return valueText(value);
}
export function queryRecords(
  objects: TioObject[],
  database: TioObject,
  view: TioObject,
): TioObject[] {
  let rows = objects.filter(
    (o) => o.type === 'record' && o.databaseId === database.id && !o.deleted,
  );
  for (const filter of view.filters ?? []) {
    rows = rows.filter((r) => {
      const v = r.properties?.[filter.fieldId];
      const field = database.fields?.find((f) => f.id === filter.fieldId);
      if (!field) return true;
      switch (filter.op) {
        case 'notEmpty':
          return v !== undefined && v !== null && v !== '' && (!Array.isArray(v) || v.length > 0);
        case 'eq':
          return Array.isArray(v)
            ? v.includes(filter.value)
            : field.type === 'date'
              ? displayValue(v, field, objects) === displayValue(filter.value, field, objects)
              : v === filter.value;
        default:
          return displayValue(v, field, objects)
            .toLocaleLowerCase()
            .includes(valueText(filter.value ?? '').toLocaleLowerCase());
      }
    });
  }
  return rows.sort((a, b) => {
    for (const s of view.sorts ?? []) {
      const av = a.properties?.[s.fieldId],
        bv = b.properties?.[s.fieldId];
      const field = database.fields?.find((f) => f.id === s.fieldId);
      const c =
        typeof av === 'number' && typeof bv === 'number'
          ? av - bv
          : displayValue(av, field ?? { id: '', name: '', type: 'text' }, objects).localeCompare(
              displayValue(bv, field ?? { id: '', name: '', type: 'text' }, objects),
              'zh-CN',
              { numeric: true },
            );
      if (c) return s.direction === 'asc' ? c : -c;
    }
    return a.id.localeCompare(b.id);
  });
}
export { validateValue } from '@tio/core';
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
