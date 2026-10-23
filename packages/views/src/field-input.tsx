import { valueText } from '@tio/core';
import type { Field, TioObject } from '@tio/core';
import { useT } from '@tio/i18n';
export function FieldInput({
  field,
  value,
  onChange,
  objects,
}: {
  field: Field;
  value: unknown;
  onChange: (v: unknown) => void;
  objects: TioObject[];
}) {
  const t = useT();
  const string = value == null ? '' : valueText(value);
  if (
    field.type === 'date' &&
    value &&
    typeof value === 'object' &&
    Object.keys(value).some((key) => key !== 'date')
  )
    return (
      <span className="text-xs text-muted">
        {t('database.unsupportedField', { value: JSON.stringify(value) })}
      </span>
    );
  if (field.type === 'formula' || field.type === 'rollup')
    return <span className="text-xs text-muted">{t('database.derived')}</span>;
  if (field.type === 'boolean')
    return (
      <input
        aria-label={field.name}
        type="checkbox"
        checked={!!value}
        onChange={(e) => onChange(e.target.checked)}
      />
    );
  if (['select', 'multiSelect', 'relation'].includes(field.type)) {
    const options =
      field.type === 'relation'
        ? objects
            .filter(
              (o) => o.type === 'record' && o.databaseId === field.targetDatabaseId && !o.deleted,
            )
            .map((o) => {
              const db = objects.find((d) => d.id === o.databaseId);
              return {
                id: o.id,
                label: valueText(
                  o.properties?.[db?.fields?.find((f) => f.type === 'title')?.id ?? ''] ??
                    t('common.untitled'),
                ),
              };
            })
        : (field.options ?? []);
    const multiple =
      field.type === 'multiSelect' || (field.type === 'relation' && field.multiple !== false);
    return (
      <select
        aria-label={field.name}
        multiple={multiple}
        value={multiple ? (Array.isArray(value) ? (value as string[]) : []) : string}
        onChange={(e) =>
          onChange(
            multiple
              ? Array.from(e.target.selectedOptions, (o) => o.value)
              : e.target.value || null,
          )
        }
      >
        {!multiple && <option value="">{t('common.empty')}</option>}
        {options.map((o) => (
          <option key={o.id} value={o.id}>
            {o.label}
          </option>
        ))}
      </select>
    );
  }
  if (!['title', 'text', 'number', 'date'].includes(field.type))
    return (
      <span className="text-xs text-muted">
        {t('database.unsupportedField', { value: JSON.stringify(value) })}
      </span>
    );
  return (
    <input
      aria-label={field.name}
      type={field.type === 'number' ? 'number' : field.type === 'date' ? 'date' : 'text'}
      value={
        field.type === 'number' && typeof value === 'number'
          ? value
          : field.type === 'date' && value && typeof value === 'object'
            ? valueText((value as any).date ?? '')
            : string
      }
      onChange={(e) => {
        // Native numeric inputs retain incomplete syntax (e.g. '-') without publishing null.
        if (field.type === 'number' && e.target.validity.badInput) return;
        onChange(
          field.type === 'number'
            ? e.target.value === ''
              ? null
              : Number(e.target.value)
            : field.type === 'date'
              ? e.target.value
                ? { date: e.target.value }
                : null
              : e.target.value,
        );
      }}
    />
  );
}
