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
import { Button, IconButton } from '@tio/ui';
import { useViewExtensions } from '@tio/views';
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
  onSave: (field: Field) => void;
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
  const [error, setError] = useState('');
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
  const patch = (value: Partial<Field>) => setDraft((p) => ({ ...p, ...value }));
  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        if (!draft.name.trim()) return;
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
          onSave(next);
          close();
        } catch (e) {
          setError(String(e));
        }
      }}
    >
      <label className="block text-xs text-muted">
        {t('database.fieldName')}
        <input
          required
          className="mt-1 w-full"
          aria-label={t('database.fieldName')}
          value={draft.name}
          onChange={(e) => patch({ name: e.target.value })}
        />
      </label>
      <label className="block text-xs text-muted">
        {t('ui.type')}
        <select
          className="mt-1 w-full"
          disabled={!!field}
          aria-label={t('database.newFieldType')}
          value={draft.type}
          onChange={(e) =>
            patch({
              type: e.target.value,
              options:
                e.target.value === 'status'
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
        >
          {Object.entries(fields ?? {}).map(([type, definition]) => (
            <option key={type} value={type}>
              {definition.label}
            </option>
          ))}
          {draft.type === 'title' && <option value="title">{t('ui.untitled')}</option>}
          {types.map((type) => (
            <option key={type} value={type}>
              {t(`database.${type}` as TranslationKey)}
            </option>
          ))}
        </select>
      </label>
      {['select', 'multiSelect', 'status'].includes(draft.type) && (
        <div>
          <p className="mb-2 text-xs text-muted">{t('ui.options')}</p>
          {draft.options?.map((option) => (
            <div key={option.id} className="mb-2 flex flex-wrap gap-2">
              <input
                className="min-w-0 flex-1"
                aria-label={t('database.optionName')}
                value={option.label}
                onChange={(e) =>
                  patch({
                    options: draft.options!.map((o) =>
                      o.id === option.id ? { ...o, label: e.target.value } : o,
                    ),
                  })
                }
              />
              <select
                aria-label={t('database.color')}
                value={option.color ?? 'gray'}
                onChange={(e) =>
                  patch({
                    options: draft.options!.map((o) =>
                      o.id === option.id ? { ...o, color: e.target.value } : o,
                    ),
                  })
                }
              >
                {fieldColors.map((color) => (
                  <option key={color} value={color}>
                    {color}
                  </option>
                ))}
              </select>
              {draft.type === 'status' && (
                <select
                  aria-label={t('database.group')}
                  value={option.group ?? 'todo'}
                  onChange={(e) =>
                    patch({
                      options: draft.options!.map((o) =>
                        o.id === option.id
                          ? { ...o, group: e.target.value as 'todo' | 'doing' | 'done' }
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
                </select>
              )}
              <IconButton
                label={t('ui.remove')}
                type="button"
                onClick={() => patch({ options: draft.options!.filter((o) => o.id !== option.id) })}
              >
                <X size={14} />
              </IconButton>
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
            <select
              required
              className="mt-1 w-full"
              aria-label={t('database.target')}
              value={draft.targetDatabaseId ?? ''}
              onChange={(e) => patch({ targetDatabaseId: e.target.value })}
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
            </select>
          </label>
          <label className="flex gap-2">
            <input
              type="checkbox"
              checked={draft.multiple !== false}
              onChange={(e) => patch({ multiple: e.target.checked })}
            />
            {t('database.multiple')}
          </label>
        </>
      )}
      {draft.type === 'number' && (
        <div className="space-y-3">
          <label className="block text-xs text-muted">
            {t('database.numberFormat')}
            <select
              className="mt-1 w-full"
              value={draft.numberFormat ?? 'number'}
              onChange={(e) => patch({ numberFormat: e.target.value as Field['numberFormat'] })}
            >
              {(['number', 'percent', 'currency'] as const).map((format) => (
                <option key={format} value={format}>
                  {t(`database.format.${format}`)}
                </option>
              ))}
            </select>
          </label>
          {draft.numberFormat === 'currency' && (
            <label className="block text-xs text-muted">
              {t('database.currency')}
              <select
                className="mt-1 w-full"
                value={draft.currency ?? 'CNY'}
                onChange={(e) => patch({ currency: e.target.value })}
              >
                {['CNY', 'USD', 'EUR', 'JPY', 'GBP', 'HKD'].map((currency) => (
                  <option key={currency}>{currency}</option>
                ))}
              </select>
            </label>
          )}
        </div>
      )}
      {draft.type === 'formula' && (
        <div className="space-y-3">
          <div className="flex gap-2">
            <select
              className="min-w-0 flex-1"
              aria-label={t('database.insertField')}
              value=""
              onChange={(e) => {
                if (e.target.value)
                  insertFormula(
                    formulaSource(`prop(${JSON.stringify(e.target.value)})`, database.fields ?? []),
                  );
              }}
            >
              <option value="">{t('database.insertField')}</option>
              {database.fields?.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.name} · {f.id.slice(-6)}
                </option>
              ))}
            </select>
            <select
              className="min-w-0 flex-1"
              aria-label={t('database.insertFunction')}
              value=""
              onChange={(e) => {
                if (e.target.value) insertFormula(formulaFunctions[e.target.value]);
              }}
            >
              <option value="">{t('database.insertFunction')}</option>
              {Object.keys(formulaFunctions)
                .filter((name) => name !== 'prop')
                .map((name) => (
                  <option key={name}>{name}</option>
                ))}
            </select>
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
            <select
              className="mt-1 w-full"
              value={previewId || records[0]?.id || ''}
              onChange={(e) => setPreviewId(e.target.value)}
            >
              {records.map((r) => (
                <option key={r.id} value={r.id}>
                  {valueText(
                    r.properties?.[database.fields?.find((f) => f.type === 'title')?.id ?? ''] ??
                      r.id,
                  )}
                </option>
              ))}
            </select>
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
            <select
              required
              className="mt-1 w-full"
              value={draft.rollup?.relationFieldId ?? ''}
              onChange={(e) =>
                patch({
                  rollup: {
                    relationFieldId: e.target.value,
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
            </select>
          </label>
          <label className="block text-xs text-muted">
            {t('database.chooseRollupField')}
            <select
              required
              className="mt-1 w-full"
              value={draft.rollup?.targetFieldId ?? ''}
              onChange={(e) =>
                patch({
                  rollup: {
                    relationFieldId: draft.rollup?.relationFieldId ?? '',
                    targetFieldId: e.target.value,
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
            </select>
          </label>
          <label className="block text-xs text-muted">
            {t('database.aggregation')}
            <select
              required
              className="mt-1 w-full"
              value={draft.rollup?.operation ?? 'values'}
              onChange={(e) =>
                patch({
                  rollup: {
                    relationFieldId: draft.rollup?.relationFieldId ?? '',
                    targetFieldId: draft.rollup?.targetFieldId ?? '',
                    operation: e.target.value as NonNullable<Field['rollup']>['operation'],
                  },
                })
              }
            >
              {allowedRollups(targetField).map((operation) => (
                <option key={operation} value={operation}>
                  {t(`database.rollup.${operation}`)}
                </option>
              ))}
            </select>
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
        <Button type="submit" variant="primary">
          {t('ui.done')}
        </Button>
      </div>
    </form>
  );
}
