import {
  id,
  valueText,
  fieldColors,
  validateFieldDefinition,
  type Field,
  type TioObject,
} from '@tio/core';
import {
  allowedRollups,
  compileFormula,
  createEvaluator,
  displayValue,
  formulaFunctions,
  formulaSource,
} from '@tio/database';
import { useT, type TranslationKey } from '@tio/i18n';
import { ChoiceSelect } from '@tio/ui';
import { SelectInput } from '@tio/ui';
import { Button, useDraftHistory, IconButton } from '@tio/ui';
import { FieldTypeIcon, optionPalette, useViewExtensions } from '@tio/views';
import { Plus, X } from 'lucide-react';
import { useRef, useState } from 'react';
const types = [
  'text',
  'number',
  'boolean',
  'date',
  'select',
  'multiSelect',
  'status',
  'mention',
  'url',
  'email',
  'phone',
  'files',
  'relation',
  'formula',
  'rollup',
  'createdTime',
  'lastEditedTime',
] as const;
export function PropertyEditor({
  database,
  field,
  objects,
  onSave,
  close,
}: {
  database: TioObject;
  field?: Field;
  objects: TioObject[];
  onSave: (field: Field) => void | Promise<void>;
  close: () => void;
}) {
  const t = useT();
  const { fields } = useViewExtensions();
  const [draft, setDraft] = useState<Field>(
    field
      ? {
          ...field,
          ...(field.type === 'formula'
            ? { formula: formulaSource(field.formula ?? '', database.fields ?? []) }
            : {}),
        }
      : { id: id('field'), name: '', type: 'text' },
  );
  const history = useDraftHistory(draft, setDraft);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const formulaRef = useRef<HTMLTextAreaElement>(null);
  const [previewId, setPreviewId] = useState('');
  const records = objects.filter(
    (o) => o.type === 'record' && o.databaseId === database.id && !o.deleted,
  );
  const relations = database.fields?.filter((f) => f.type === 'relation') ?? [];
  const relation = relations.find((f) => f.id === draft.rollup?.relationFieldId);
  const targetFields =
    objects.find((o) => o.id === relation?.targetDatabaseId && !o.deleted)?.fields ?? [];
  const targetField = targetFields.find((f) => f.id === draft.rollup?.targetFieldId);
  const insertFormula = (text: string) => {
    const input = formulaRef.current;
    const source = draft.formula ?? '';
    const start = input?.selectionStart ?? source.length,
      end = input?.selectionEnd ?? source.length;
    patch({ formula: source.slice(0, start) + text + source.slice(end) });
    requestAnimationFrame(() => {
      input?.focus();
      input?.setSelectionRange(start + text.length, start + text.length);
    });
  };
  let preview = '';
  if (draft.type === 'formula') {
    try {
      const compiled = compileFormula(draft.formula ?? '', [
        ...(database.fields ?? []).filter((f) => f.id !== draft.id),
        draft,
      ]);
      const db = {
        ...database,
        fields: [
          ...(database.fields ?? []).filter((f) => f.id !== draft.id),
          { ...draft, formula: compiled },
        ],
      };
      const record = records.find((r) => r.id === previewId) ??
        records[0] ?? {
          id: 'preview',
          type: 'record',
          workspaceId: database.workspaceId,
          databaseId: database.id,
          schemaVersion: 1,
          properties: {},
        };
      const result = createEvaluator([...objects.filter((o) => o.id !== database.id), db]).read(
        record,
        { ...draft, formula: compiled },
      );
      preview = result.error ?? displayValue(result.value, draft, objects);
    } catch (e) {
      preview = String(e);
    }
  }
  const patch = (value: Partial<Field>) => history.change({ ...draft, ...value });
  return (
    <form
      className="space-y-4"
      onSubmit={async (e) => {
        e.preventDefault();
        if (!draft.name.trim()) return;
        if (saving) return;
        setSaving(true);
        try {
          const next = { ...draft, name: draft.name.trim() };
          if (next.type === 'formula')
            next.formula = compileFormula(next.formula ?? '', [
              ...(database.fields ?? []).filter((f) => f.id !== next.id),
              next,
            ]);
          if (
            next.type === 'relation' &&
            !objects.some(
              (o) =>
                o.id === next.targetDatabaseId &&
                o.type === 'database' &&
                !o.deleted &&
                o.workspaceId === database.workspaceId,
            )
          )
            throw new Error('Choose a target database');
          if (
            next.type === 'rollup' &&
            (!relation ||
              !targetField ||
              !next.rollup ||
              !allowedRollups(targetField).includes(next.rollup.operation))
          )
            throw new Error('Configure the rollup');
          validateFieldDefinition(next);
          await onSave(next);
          history.discard();
          close();
        } catch (e) {
          setError(String(e));
        } finally {
          setSaving(false);
        }
      }}
    >
      <label className="block text-xs text-muted">
        {t('database.fieldName')}
        <input
          required
          className="mt-1 w-full text-ink"
          aria-label={t('database.fieldName')}
          value={draft.name}
          onChange={(e) => patch({ name: e.target.value })}
        />
      </label>
      <label className="block text-xs text-muted">
        {t('ui.type')}
        <ChoiceSelect
          label={t(field ? 'database.fieldType' : 'database.newFieldType')}
          className="mt-1 w-full text-ink"
          disabled={
            saving ||
            (!!field && (field.type === 'title' || !types.some((type) => type === field.type)))
          }
          value={draft.type}
          onValueChange={(type) =>
            patch({
              type,
              numberFormat: undefined,
              currency: undefined,
              targetDatabaseId: undefined,
              multiple: undefined,
              options:
                ['select', 'multiSelect', 'status'].includes(draft.type) &&
                ['select', 'multiSelect', 'status'].includes(type)
                  ? draft.options?.map((option) => ({
                      ...option,
                      ...(type === 'status' ? { group: option.group ?? ('todo' as const) } : {}),
                    }))
                  : type === 'status'
                    ? (['todo', 'doing', 'done'] as const).map((group, i) => ({
                        id: id('option'),
                        label: t(`database.${group}`),
                        group,
                        color: ['gray', 'blue', 'green'][i],
                      }))
                    : [],
              rollup: undefined,
              formula: undefined,
            })
          }
          options={[
            ...Object.entries(fields ?? {}).map(([type, definition]) => ({
              id: type,
              text: definition.label,
              label: definition.label,
              icon: <FieldTypeIcon type={type} />,
            })),
            ...(draft.type === 'title'
              ? [
                  {
                    id: 'title',
                    text: t('database.title'),
                    label: t('database.title'),
                    icon: <FieldTypeIcon type="title" />,
                  },
                ]
              : []),
            ...types.map((type) => ({
              id: type,
              text: t(`database.${type}` as TranslationKey),
              label: t(`database.${type}` as TranslationKey),
              icon: <FieldTypeIcon type={type} />,
            })),
          ]}
        />
      </label>
      {['select', 'multiSelect', 'status'].includes(draft.type) && (
        <div>
          <p className="mb-2 text-xs text-muted">{t('ui.options')}</p>
          {draft.options?.map((option) => (
            <div
              key={option.id}
              className="mb-3 grid grid-cols-[minmax(0,1fr)_44px_44px] items-end gap-2 border-b border-line pb-3"
            >
              <label className="block min-w-0 text-xs text-muted">
                {t('database.optionDisplayName')}
                <input
                  className="mt-1 h-11 w-full text-ink"
                  aria-label={t('database.optionDisplayName')}
                  value={option.label}
                  onChange={(e) =>
                    patch({
                      options: draft.options!.map((o) =>
                        o.id === option.id ? { ...o, label: e.target.value } : o,
                      ),
                    })
                  }
                />
              </label>
              <ChoiceSelect
                value={option.color ?? 'gray'}
                label={t('database.color')}
                trigger={
                  <Button
                    type="button"
                    variant="outline"
                    className="h-11 w-11 p-0"
                    aria-label={`${t('database.color')}: ${t(`database.color.${(option.color ?? 'gray') as (typeof fieldColors)[number]}`)}`}
                    title={t('database.color')}
                  >
                    <span
                      aria-hidden
                      className="size-4 rounded-full border border-ink/15"
                      style={{ backgroundColor: optionPalette[option.color ?? 'gray'] }}
                    />
                  </Button>
                }
                onValueChange={(color) =>
                  patch({
                    options: draft.options!.map((o) => (o.id === option.id ? { ...o, color } : o)),
                  })
                }
                options={fieldColors.map((color) => ({
                  id: color,
                  text: t(`database.color.${color}`),
                  label: t(`database.color.${color}`),
                  icon: (
                    <span
                      aria-hidden
                      className="size-3 shrink-0 rounded-full border border-ink/15"
                      style={{ backgroundColor: optionPalette[color] }}
                    />
                  ),
                }))}
              />
              <IconButton
                label={t('ui.remove')}
                type="button"
                className="h-11 w-11 p-0"
                onClick={() => patch({ options: draft.options!.filter((o) => o.id !== option.id) })}
              >
                <X size={14} />
              </IconButton>
              {draft.type === 'status' && (
                <label className="col-span-full block min-w-0 text-xs text-muted">
                  {t('database.group')}
                  <SelectInput
                    className="mt-1 w-full text-ink"
                    aria-label={t('database.group')}
                    value={option.group ?? 'todo'}
                    onValueChange={(value) =>
                      patch({
                        options: draft.options!.map((o) =>
                          o.id === option.id
                            ? { ...o, group: value as 'todo' | 'doing' | 'done' }
                            : o,
                        ),
                      })
                    }
                  >
                    {(['todo', 'doing', 'done'] as const).map((group) => (
                      <option key={group} value={group}>
                        {t(`database.${group}`)}
                      </option>
                    ))}
                  </SelectInput>
                </label>
              )}
            </div>
          ))}
          <Button
            type="button"
            onClick={() =>
              patch({
                options: [
                  ...(draft.options ?? []),
                  {
                    id: id('option'),
                    label: t('database.newOption'),
                    color: 'gray',
                    ...(draft.type === 'status' ? { group: 'todo' as const } : {}),
                  },
                ],
              })
            }
          >
            <Plus size={14} />
            {t('database.addOption')}
          </Button>
        </div>
      )}
      {draft.type === 'relation' && (
        <>
          <label className="block">
            {t('database.target')}
            <SelectInput
              required
              className="mt-1 w-full text-ink"
              aria-label={t('database.target')}
              value={draft.targetDatabaseId ?? ''}
              onValueChange={(value) => patch({ targetDatabaseId: value })}
            >
              <option value="">{t('database.chooseTarget')}</option>
              {objects
                .filter(
                  (o) =>
                    o.workspaceId === database.workspaceId && o.type === 'database' && !o.deleted,
                )
                .map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.name}
                  </option>
                ))}
            </SelectInput>
          </label>
        </>
      )}
      {['relation', 'mention'].includes(draft.type) && (
        <label className="flex gap-2">
          <input
            type="checkbox"
            checked={draft.multiple !== false}
            onChange={(e) => patch({ multiple: e.target.checked })}
          />
          {t('database.multiple')}
        </label>
      )}
      {draft.type === 'number' && (
        <div className="space-y-3">
          <label className="block text-xs text-muted">
            {t('database.numberFormat')}
            <SelectInput
              className="mt-1 w-full text-ink"
              value={draft.numberFormat ?? 'number'}
              onValueChange={(value) => patch({ numberFormat: value as Field['numberFormat'] })}
            >
              {(['number', 'percent', 'currency'] as const).map((format) => (
                <option key={format} value={format}>
                  {t(`database.format.${format}`)}
                </option>
              ))}
            </SelectInput>
          </label>
          {draft.numberFormat === 'currency' && (
            <label className="block text-xs text-muted">
              {t('database.currency')}
              <SelectInput
                className="mt-1 w-full text-ink"
                value={draft.currency ?? 'CNY'}
                onValueChange={(value) => patch({ currency: value })}
              >
                {['CNY', 'USD', 'EUR', 'JPY', 'GBP', 'HKD'].map((currency) => (
                  <option key={currency}>{currency}</option>
                ))}
              </SelectInput>
            </label>
          )}
        </div>
      )}
      {draft.type === 'formula' && (
        <div className="space-y-3">
          <div className="flex gap-2">
            <SelectInput
              className="min-w-0 flex-1"
              aria-label={t('database.insertField')}
              value=""
              onValueChange={(value) => {
                if (value)
                  insertFormula(
                    formulaSource(`prop(${JSON.stringify(value)})`, database.fields ?? []),
                  );
              }}
            >
              <option value="">{t('database.insertField')}</option>
              {database.fields?.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.name} · {f.id.slice(-6)}
                </option>
              ))}
            </SelectInput>
            <SelectInput
              className="min-w-0 flex-1"
              aria-label={t('database.insertFunction')}
              value=""
              onValueChange={(value) => {
                if (value) insertFormula(formulaFunctions[value]);
              }}
            >
              <option value="">{t('database.insertFunction')}</option>
              {Object.keys(formulaFunctions)
                .filter((name) => name !== 'prop')
                .map((name) => (
                  <option key={name}>{name}</option>
                ))}
            </SelectInput>
          </div>
          <textarea
            ref={formulaRef}
            aria-label={t('database.formula')}
            className="min-h-28 w-full rounded border border-line bg-panel p-2 font-mono text-sm"
            value={draft.formula ?? ''}
            onChange={(e) => patch({ formula: e.target.value })}
          />
          <p className="text-xs leading-relaxed text-muted">{t('database.formulaHelp')}</p>
          <details className="text-xs text-muted">
            <summary>{t('database.insertFunction')}</summary>
            {Object.values(formulaFunctions).map((help) => (
              <code className="my-1 block" key={help}>
                {help}
              </code>
            ))}
          </details>
          <label className="block text-xs text-muted">
            {t('database.preview')}
            <SelectInput
              className="mt-1 w-full text-ink"
              value={previewId || records[0]?.id || ''}
              onValueChange={(value) => setPreviewId(value)}
            >
              {records.map((r) => (
                <option key={r.id} value={r.id}>
                  {valueText(
                    r.properties?.[database.fields?.find((f) => f.type === 'title')?.id ?? ''] ??
                      r.id,
                  )}
                </option>
              ))}
            </SelectInput>
          </label>
          <output
            className="block rounded border border-line bg-surface p-2 text-sm break-words"
            aria-label={t('database.preview')}
          >
            {preview || '—'}
          </output>
        </div>
      )}
      {draft.type === 'rollup' && (
        <div className="space-y-3">
          <label className="block text-xs text-muted">
            {t('database.chooseRelation')}
            <SelectInput
              required
              className="mt-1 w-full text-ink"
              value={draft.rollup?.relationFieldId ?? ''}
              onValueChange={(value) =>
                patch({
                  rollup: {
                    relationFieldId: value,
                    targetFieldId: '',
                    operation: 'values',
                  },
                })
              }
            >
              <option value="">—</option>
              {relations.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.name}
                </option>
              ))}
            </SelectInput>
          </label>
          <label className="block text-xs text-muted">
            {t('database.chooseRollupField')}
            <SelectInput
              required
              className="mt-1 w-full text-ink"
              value={draft.rollup?.targetFieldId ?? ''}
              onValueChange={(value) =>
                patch({
                  rollup: {
                    relationFieldId: draft.rollup?.relationFieldId ?? '',
                    targetFieldId: value,
                    operation: 'values',
                  },
                })
              }
            >
              <option value="">—</option>
              {targetFields.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.name}
                </option>
              ))}
            </SelectInput>
          </label>
          <label className="block text-xs text-muted">
            {t('database.aggregation')}
            <SelectInput
              required
              className="mt-1 w-full text-ink"
              value={draft.rollup?.operation ?? 'values'}
              onValueChange={(value) =>
                patch({
                  rollup: {
                    relationFieldId: draft.rollup?.relationFieldId ?? '',
                    targetFieldId: draft.rollup?.targetFieldId ?? '',
                    operation: value as NonNullable<Field['rollup']>['operation'],
                  },
                })
              }
            >
              {allowedRollups(targetField).map((operation) => (
                <option key={operation} value={operation}>
                  {t(`database.rollup.${operation}`)}
                </option>
              ))}
            </SelectInput>
          </label>
        </div>
      )}
      {error && (
        <p role="alert" className="text-sm text-red-600">
          {error}
        </p>
      )}
      <div className="flex justify-end gap-2 pt-4">
        <Button type="button" onClick={close}>
          {t('ui.cancel')}
        </Button>
        <Button type="submit" variant="primary" disabled={saving}>
          {t('ui.done')}
        </Button>
      </div>
    </form>
  );
}
