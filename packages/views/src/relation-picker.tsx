import { valueText } from '@tio/core';
import { useT } from '@tio/i18n';
import { ReferencePicker } from '@tio/ui';
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
  const [after, setAfter] = useState<string>();
  const [next, setNext] = useState<string>();
  const [records, setRecords] = useState<typeof objects>([]);
  const [known, setKnown] = useState<typeof objects>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    setAfter(undefined);
    setRecords([]);
    setKnown([]);
    setNext(undefined);
  }, [field.targetDatabaseId]);
  useEffect(() => {
    if (!active || !queryRecords || !field.targetDatabaseId) return;
    let live = true;
    setLoading(true);
    setError(false);
    void queryRecords({ databaseId: field.targetDatabaseId, text: query, after, limit: 100 }).then(
      (page) => {
        if (!live) return;
        setRecords((previous) =>
          after
            ? [
                ...previous,
                ...page.entries
                  .map((e) => e.object)
                  .filter((o) => !previous.some((p) => p.id === o.id)),
              ]
            : page.entries.map((e) => e.object),
        );
        setKnown((previous) => [
          ...previous.filter((o) => !page.entries.some((e) => e.object.id === o.id)),
          ...page.entries.map((e) => e.object),
        ]);
        setNext(page.next);
        setLoading(false);
      },
      () => {
        if (live) {
          setError(true);
          setLoading(false);
        }
      },
    );
    return () => {
      live = false;
    };
  }, [active, queryRecords, field.targetDatabaseId, query, after, retry]);
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
        setAfter(undefined);
      }}
      loading={loading}
      error={error}
      retry={() => setRetry((n) => n + 1)}
      more={next ? () => setAfter(next) : undefined}
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
