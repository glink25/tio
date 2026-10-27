/* oxlint-disable jsx-a11y/no-noninteractive-element-interactions -- The editor group handles Enter/Escape bubbling from its input controls. */
/* oxlint-disable jsx-a11y/prefer-tag-over-role -- Rich searchable options render colored tags and record links. */
import {
  isMentionReference,
  fieldColors,
  isDateValue,
  isDerivedField,
  validateValue,
  valueText,
} from '@tio/core';
import type { DateValue, TioObject } from '@tio/core';
import { dateInput, localTimeZone, zonedDateTime } from '@tio/database';
import { useT, type TranslationKey } from '@tio/i18n';
import { MentionLabel, MentionPicker, Button } from '@tio/ui';
import { useState, useEffect, useRef } from 'react';

import { useDisplayValue } from './display-value';
import type { FieldInputProps } from './extensions';
import { useViewExtensions } from './extensions';
import { RelationPicker } from './relation-picker';

export const optionPalette: Record<string, string> = {
  gray: '#787774',
  brown: '#9f6b53',
  orange: '#d9730d',
  yellow: '#b08b00',
  green: '#24866a',
  blue: '#337ea9',
  purple: '#9065b0',
  pink: '#c14c8a',
  red: '#c4554d',
};
export function OptionTag({ label, color = 'gray' }: { label: string; color?: string }) {
  const ink = optionPalette[color] ?? optionPalette.gray;
  return (
    <span
      className="inline-flex max-w-full items-center truncate rounded px-1.5 py-0.5 text-xs"
      style={{
        color: `light-dark(${ink}, color-mix(in srgb, ${ink} 65%, white))`,
        background: `color-mix(in srgb, ${ink} 14%, transparent)`,
      }}
    >
      {label}
    </span>
  );
}
export { fieldColors };
function AssetItem({
  refValue,
  objects,
  resolve,
  remove,
}: {
  refValue: string;
  objects: TioObject[];
  resolve?: (ref: string) => Promise<string>;
  remove?: () => void;
}) {
  const t = useT();
  const asset = objects.find((o) => o.id === refValue.slice(6) && o.type === 'asset' && !o.deleted);
  const [url, setUrl] = useState('');
  useEffect(() => {
    let active = true;
    setUrl('');
    void resolve?.(refValue)
      .then((next) => {
        if (active) setUrl(next);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [refValue, resolve, asset]);
  return (
    <div className="flex min-w-0 items-center gap-2 rounded border border-line p-2">
      {url && asset?.mime?.startsWith('image/') && (
        <img src={url} alt="" className="size-10 shrink-0 rounded object-cover" />
      )}
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm">{asset?.filename ?? t('database.missingFile')}</div>
        <div className="text-xs text-muted">
          {asset ? `${Math.ceil((asset.byteSize ?? 0) / 1024)} KB` : ''}
        </div>
        {!url && <span className="text-xs text-muted">{t('database.missingFile')}</span>}
      </div>
      {url && (
        <a className="shrink-0 text-xs underline" href={url} download={asset?.filename}>
          {t('database.download')}
        </a>
      )}
      {remove && (
        <Button
          type="button"
          className="shrink-0 px-1"
          aria-label={t('ui.remove')}
          onClick={remove}
        >
          ×
        </Button>
      )}
    </div>
  );
}
export function FieldValue(
  props: Pick<FieldInputProps, 'field' | 'value' | 'objects' | 'resolve' | 'onOpen'>,
) {
  const { field, value, objects, resolve, onOpen } = props;
  const format = useDisplayValue();
  if (field.type === 'mention')
    return isMentionReference(value) ? <MentionLabel reference={value} /> : null;
  if (field.type === 'files')
    return (
      <div className="w-full min-w-0 space-y-1">
        {(Array.isArray(value) ? (value as string[]) : []).map((ref) => (
          <AssetItem key={ref} refValue={ref} objects={objects} resolve={resolve} />
        ))}
      </div>
    );
  if (['select', 'multiSelect', 'status'].includes(field.type))
    return (
      <div className="flex flex-wrap gap-1">
        {(Array.isArray(value) ? value : value ? [value] : []).map((id) => {
          const option = field.options?.find((o) => o.id === id);
          return (
            <OptionTag key={String(id)} label={option?.label ?? String(id)} color={option?.color} />
          );
        })}
      </div>
    );
  if (field.type === 'relation')
    return (
      <div className="flex flex-wrap gap-1">
        {(Array.isArray(value) ? value : value ? [value] : []).map((id) => {
          const record = objects.find((o) => o.id === id && !o.deleted);
          const label = format(id, field, objects);
          return record && onOpen ? (
            <Button
              type="button"
              className="h-auto max-w-full truncate px-1 py-0.5 text-xs underline"
              key={String(id)}
              onClick={() => onOpen(record)}
            >
              {label} ↗
            </Button>
          ) : (
            <span key={String(id)} className="text-xs text-muted">
              {label}
            </span>
          );
        })}
      </div>
    );
  if (['url', 'email', 'phone'].includes(field.type) && typeof value === 'string' && value)
    return (
      <a
        className="break-all underline"
        href={
          field.type === 'email'
            ? `mailto:${value}`
            : field.type === 'phone'
              ? `tel:${value}`
              : /^https?:\/\//.test(value)
                ? value
                : undefined
        }
        target={field.type === 'url' ? '_blank' : undefined}
        rel="noreferrer"
      >
        {value}
      </a>
    );
  return <span className="text-sm break-words">{format(value, field, objects)}</span>;
}
function DateEditor({
  value,
  onChange,
  label,
}: {
  value: unknown;
  onChange: (next: unknown) => void;
  label: string;
}) {
  const t = useT();
  const date = isDateValue(value) ? value : undefined;
  const [time, setTime] = useState(!!date?.start.includes('T'));
  const [range, setRange] = useState(!!date?.end);
  const [zone, setZone] = useState(date?.timeZone ?? localTimeZone());
  const [start, setStart] = useState(date ? dateInput(date.start, zone) : '');
  const [end, setEnd] = useState(date?.end ? dateInput(date.end, zone) : '');
  const [error, setError] = useState('');
  const publish = (
    first: string,
    last: string,
    timed: boolean,
    ranged: boolean,
    timeZone: string,
  ) => {
    try {
      const next: DateValue | null = first
        ? {
            start: timed ? zonedDateTime(first, timeZone) : first,
            ...(ranged && last ? { end: timed ? zonedDateTime(last, timeZone) : last } : {}),
            ...(timed ? { timeZone } : {}),
          }
        : null;
      if (ranged && first && !last) throw new Error('Choose an end date');
      if (next && !isDateValue(next)) throw new Error('Invalid date range');
      setError('');
      onChange(next);
    } catch (e) {
      setError(String(e));
      onChange({ invalidDate: true });
    }
  };
  return (
    <div className="w-full min-w-0 space-y-3">
      <label className="block text-xs text-muted">
        {t('database.start')}
        <input
          className="mt-1 w-full"
          aria-label={label}
          type={time ? 'datetime-local' : 'date'}
          value={start}
          onChange={(e) => {
            setStart(e.target.value);
            publish(e.target.value, end, time, range, zone);
          }}
        />
      </label>
      {range && (
        <label className="block text-xs text-muted">
          {t('database.end')}
          <input
            className="mt-1 w-full"
            aria-label={t('database.end')}
            type={time ? 'datetime-local' : 'date'}
            value={end}
            onChange={(e) => {
              setEnd(e.target.value);
              publish(start, e.target.value, time, range, zone);
            }}
          />
        </label>
      )}
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={range}
          onChange={(e) => {
            setRange(e.target.checked);
            publish(start, end, time, e.target.checked, zone);
          }}
        />
        {t('database.dateRange')}
      </label>
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={time}
          onChange={(e) => {
            const enabled = e.target.checked;
            const convert = (v: string) =>
              !v ? '' : enabled ? v.slice(0, 10) + 'T09:00' : v.slice(0, 10);
            const first = convert(start),
              last = convert(end);
            setTime(enabled);
            setStart(first);
            setEnd(last);
            publish(first, last, enabled, range, zone);
          }}
        />
        {t('database.includeTime')}
      </label>
      {time && (
        <label className="block text-xs text-muted">
          {t('database.timeZone')}
          <input
            className="mt-1 w-full"
            aria-label={t('database.timeZone')}
            value={zone}
            list="tio-timezones"
            onChange={(e) => {
              setZone(e.target.value);
              publish(start, end, time, range, e.target.value);
            }}
          />
          <datalist id="tio-timezones">
            {[
              'UTC',
              localTimeZone(),
              'Asia/Shanghai',
              'Asia/Tokyo',
              'Europe/London',
              'America/New_York',
            ].map((z, i) => (
              <option key={i} value={z}>
                {z}
              </option>
            ))}
          </datalist>
        </label>
      )}
      {error && (
        <p role="alert" className="text-xs text-red-600">
          {t('database.invalidValue', { message: error })}
        </p>
      )}
      <Button
        type="button"
        className="px-0 text-xs"
        onClick={() => {
          setStart('');
          setEnd('');
          setError('');
          onChange(null);
        }}
      >
        {t('database.clearDate')}
      </Button>
    </div>
  );
}
export function FieldInput(props: FieldInputProps) {
  const { field, value, onChange, objects, onCancel, readOnly, upload, resolve, onOpen } = props;
  const t = useT();
  const Custom = useViewExtensions().fields?.[field.type]?.Input;
  const [draft, setDraft] = useState<unknown>(value ?? null);
  const previousValue = useRef(value);
  useEffect(() => {
    if (JSON.stringify(draft) === JSON.stringify(previousValue.current ?? null))
      setDraft(value ?? null);
    previousValue.current = value;
  }, [value, draft]);
  const [search, setSearch] = useState(''),
    [error, setError] = useState('');
  const [uploading, setUploading] = useState(false),
    [failed, setFailed] = useState<File[]>([]);
  const change = (next: unknown) => {
    setDraft(next);
    setError('');
  };
  const commit = () => {
    try {
      const submitted =
        field.type === 'number' && typeof draft === 'string'
          ? /^[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?$/.test(draft)
            ? Number(draft)
            : draft
          : draft;
      validateValue(field, submitted);
      onChange(submitted);
      setError('');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };
  if (readOnly || isDerivedField(field)) return <FieldValue {...props} />;
  const uploadFiles = async (files: File[]) => {
    if (!upload) return;
    setUploading(true);
    setFailed([]);
    const refs: string[] = [],
      failures: File[] = [];
    for (const file of files) {
      try {
        if (file.size > 20 * 1024 * 1024) throw new Error('20 MB');
        refs.push(await upload(file));
      } catch (e) {
        failures.push(file);
        setError(String(e));
      }
    }
    setDraft((previous: unknown) => [...(Array.isArray(previous) ? previous : []), ...refs]);
    setFailed(failures);
    setUploading(false);
  };
  let control;
  if (Custom) control = <Custom {...props} value={draft} onChange={change} />;
  else if (field.type === 'date')
    control = <DateEditor key={field.id} value={value} label={field.name} onChange={change} />;
  else if (field.type === 'boolean')
    control = (
      <input
        aria-label={field.name}
        type="checkbox"
        checked={!!draft}
        onChange={(e) => change(e.target.checked)}
      />
    );
  else if (field.type === 'files')
    control = (
      <div className="w-full min-w-0 space-y-2">
        {(Array.isArray(draft) ? (draft as string[]) : []).map((ref) => (
          <AssetItem
            key={ref}
            refValue={ref}
            objects={objects}
            resolve={resolve}
            remove={() => change((draft as string[]).filter((r) => r !== ref))}
          />
        ))}
        {upload ? (
          <label className="block text-xs text-muted">
            {uploading ? t('database.uploading') : t('database.uploadFiles')}
            <input
              className="mt-2 block w-full text-xs"
              aria-label={t('database.uploadFiles')}
              type="file"
              multiple
              disabled={uploading}
              onChange={(e) => {
                void uploadFiles(Array.from(e.target.files ?? []));
                e.target.value = '';
              }}
            />
          </label>
        ) : (
          <p className="text-xs text-muted">{t('database.uploadUnavailable')}</p>
        )}
        {failed.length > 0 && (
          <Button type="button" onClick={() => void uploadFiles(failed)}>
            {t('database.retry')} ({failed.map((file) => file.name).join(', ')})
          </Button>
        )}
      </div>
    );
  else if (field.type === 'relation')
    control = <RelationPicker {...props} value={draft} onChange={change} />;
  else if (['select', 'multiSelect', 'status'].includes(field.type)) {
    const options = field.options ?? [];
    const multiple = field.type === 'multiSelect';
    const selected = Array.isArray(draft) ? draft : draft ? [draft] : [];
    const filtered = options.filter((o) =>
      o.label.toLocaleLowerCase().includes(search.toLocaleLowerCase()),
    );
    control = (
      <div className="w-full min-w-0 space-y-2">
        <input
          className="w-full"
          aria-label={t('database.searchOptions')}
          placeholder={t('database.searchOptions')}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <FieldValue field={field} value={draft} objects={objects} onOpen={onOpen} />
        <div
          role="listbox"
          tabIndex={0}
          aria-label={field.name}
          aria-multiselectable={multiple}
          onKeyDown={(e) => {
            if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key)) return;
            const items = Array.from(
              e.currentTarget.querySelectorAll<HTMLButtonElement>('[role="option"]'),
            );
            const index = items.indexOf(document.activeElement as HTMLButtonElement);
            const next =
              e.key === 'Home'
                ? 0
                : e.key === 'End'
                  ? items.length - 1
                  : (index + (e.key === 'ArrowUp' ? -1 : 1) + items.length) % items.length;
            e.preventDefault();
            items[next]?.focus();
          }}
          className="max-h-56 overflow-y-auto"
        >
          {!filtered.length && <p className="p-2 text-xs text-muted">{t('database.noOptions')}</p>}
          {filtered.map((o, i) => (
            <div key={o.id}>
              {field.type === 'status' && o.group && o.group !== filtered[i - 1]?.group && (
                <p className="px-2 py-1 text-xs text-muted">
                  {t(`database.${o.group}` as TranslationKey)}
                </p>
              )}
              <button
                type="button"
                role="option"
                aria-label={o.label}
                aria-selected={selected.includes(o.id)}
                className="flex w-full items-center justify-between gap-2 rounded p-2 text-left hover:bg-surface-hover aria-selected:bg-surface"
                onClick={() =>
                  change(
                    multiple
                      ? selected.includes(o.id)
                        ? selected.filter((id) => id !== o.id)
                        : [...selected, o.id]
                      : selected.includes(o.id)
                        ? null
                        : o.id,
                  )
                }
              >
                <OptionTag label={o.label} color={o.color} />
                <span aria-hidden>{selected.includes(o.id) ? '✓' : ''}</span>
              </button>
            </div>
          ))}
        </div>
      </div>
    );
  } else if (field.type === 'mention')
    control = (
      <MentionPicker
        label={field.name}
        inline={props.inlineReferencePicker}
        value={draft}
        onChange={change}
      />
    );
  else if (['title', 'text', 'number', 'url', 'email', 'phone'].includes(field.type))
    control = (
      <input
        className="w-full"
        aria-label={field.name}
        type={
          field.type === 'number'
            ? 'text'
            : field.type === 'url'
              ? 'url'
              : field.type === 'email'
                ? 'email'
                : field.type === 'phone'
                  ? 'tel'
                  : 'text'
        }
        inputMode={field.type === 'number' ? 'decimal' : undefined}
        value={draft == null ? '' : valueText(draft)}
        onChange={(e) =>
          change(
            field.type === 'number'
              ? e.target.value === ''
                ? null
                : e.target.value
              : e.target.value,
          )
        }
      />
    );
  else
    return (
      <span className="text-xs text-muted">
        {t('database.unsupportedField', { value: valueText(value) })}
      </span>
    );
  const dirty = JSON.stringify(draft) !== JSON.stringify(value ?? null);
  const cancel =
    onCancel ??
    (['mention', 'relation'].includes(field.type)
      ? () => {
          setDraft(value ?? null);
          setError('');
        }
      : undefined);
  return (
    <div
      role="group"
      aria-label={`${field.name} editor`}
      className="tio-field-input w-full min-w-0 space-y-2"
      onKeyDown={(e) => {
        if (e.key === 'Escape' && cancel) {
          e.preventDefault();
          e.stopPropagation();
          cancel();
        } else if (
          e.key === 'Enter' &&
          !e.nativeEvent.isComposing &&
          e.target instanceof HTMLInputElement &&
          e.target.type !== 'file' &&
          !['select', 'multiSelect', 'relation', 'status', 'mention'].includes(field.type)
        ) {
          e.preventDefault();
          e.stopPropagation();
          commit();
        }
      }}
    >
      {control}
      {error && (
        <p role="alert" className="text-xs break-words text-red-600">
          {t('database.invalidValue', { message: error })}
        </p>
      )}
      {(dirty || onCancel) && (
        <div className="flex justify-end gap-2 border-t border-line pt-2">
          {cancel && (
            <Button type="button" onClick={cancel}>
              {t('ui.cancel')}
            </Button>
          )}
          <Button type="button" variant="primary" disabled={uploading} onClick={commit}>
            {t('ui.done')}
          </Button>
        </div>
      )}
    </div>
  );
}
