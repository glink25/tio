import { valueText } from '@tio/core';
import { useT } from '@tio/i18n';
import { ReferencePicker, usePagedOptions } from '@tio/ui';
import { useContext, useEffect, useState } from 'react';

import { RecordQueryContext, type FieldInputProps } from './extensions';

export function RelationPicker({
  field,
  value,
  objects,
  inlineReferencePicker,
  onChange,
}: FieldInputProps) {
  const t = useT();
  const queryRecords = useContext(RecordQueryContext);
  const [active, setActive] = useState(!!inlineReferencePicker);
  const [query, setQuery] = useState('');
  const [known, setKnown] = useState<typeof objects>([]);
  const page = usePagedOptions({
    active: active && !!queryRecords && !!field.targetDatabaseId,
    source: queryRecords,
    queryKey: JSON.stringify([field.targetDatabaseId, query]),
    key: (item: (typeof objects)[number]) => item.id,
    load: async (after) => {
      const result = await queryRecords!({
        databaseId: field.targetDatabaseId!,
        text: query,
        after,
        limit: 100,
      });
      return { items: result.entries.map((e) => e.object), next: result.next };
    },
  });
  useEffect(() => {
    setKnown([]);
  }, [field.targetDatabaseId]);
  useEffect(() => {
    setKnown((previous) => [
      ...new Map([...previous, ...page.items].map((o) => [o.id, o])).values(),
    ]);
  }, [page.items]);
  const records = page.items;
  const selected: string[] = Array.isArray(value)
    ? value
    : typeof value === 'string'
      ? [value]
      : [];
  const titleField = objects
    .find((o) => o.id === field.targetDatabaseId)
    ?.fields?.find((f) => f.type === 'title');
  const option = (id: string) => {
    const record = objects.find((o) => o.id === id) ?? known.find((o) => o.id === id);
    const text =
      record && !record.deleted
        ? valueText(record.properties?.[titleField?.id ?? '']) || t('common.untitled')
        : t('database.missing');
    return { id, text, label: text, kind: 'record' as const };
  };
  const candidates = (queryRecords ? records : objects).filter(
    (o) => o.type === 'record' && o.databaseId === field.targetDatabaseId && !o.deleted,
  );
  return (
    <ReferencePicker
      label={field.name}
      inline={inlineReferencePicker}
      onActiveChange={setActive}
      selected={selected.map(option)}
      options={candidates
        .map((o) => option(o.id))
        .filter(
          (o) => !!queryRecords || o.text.toLocaleLowerCase().includes(query.toLocaleLowerCase()),
        )}
      query={query}
      onQuery={(text) => {
        setQuery(text);
      }}
      multiple={field.multiple !== false}
      loading={page.loading}
      error={page.failed}
      more={page.more}
      onSelect={(id) =>
        onChange(
          field.multiple === false
            ? id
            : selected.includes(id)
              ? selected.filter((s) => s !== id)
              : [...selected, id],
        )
      }
      onRemove={(id) =>
        onChange(field.multiple === false ? null : selected.filter((s) => s !== id))
      }
    />
  );
}
