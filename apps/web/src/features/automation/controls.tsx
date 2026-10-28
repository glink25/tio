/* oxlint-disable jsx-a11y/prefer-tag-over-role -- Searchable choices use a button with a command-list popover. */
import {
  type AutomationValue,
  type AutomationCondition,
  type Field,
  type Json,
  type TioObject,
} from '@tio/core';
import { useT, type TranslationKey } from '@tio/i18n';
import { ChoiceSelect, OptionsPanel } from '@tio/ui';
import { Button, IconButton, Popover, cn } from '@tio/ui';
import { FieldInput } from '@tio/views';
import { Braces, X, Plus } from 'lucide-react';
import { useState, type ReactNode } from 'react';

import { compatible, operators, comparisonField, type Variable } from './model';
export const inputClass =
  'w-full rounded-md border border-line bg-panel px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ink/20';
export function Choice({
  value,
  onChange,
  options,
  label,
  disabled,
}: {
  value: string;
  onChange: (value: string) => void;
  options: { value: string; label: string }[];
  label: string;
  disabled?: boolean;
}) {
  return (
    <ChoiceSelect
      search
      value={value}
      onValueChange={onChange}
      label={label}
      disabled={disabled}
      options={options.map((o) => ({ id: o.value, text: o.label, label: o.label }))}
    />
  );
}

export function Label({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="space-y-2">
      <div className="text-sm text-secondary">{title}</div>
      {children}
    </div>
  );
}
export function ErrorHint({ error }: { error?: TranslationKey }) {
  const t = useT();
  return error ? (
    <p role="alert" className="text-xs text-red-600 dark:text-red-400">
      {t(error)}
    </p>
  ) : null;
}
export function defaultValue(field?: Field): AutomationValue {
  return {
    kind: 'literal',
    value:
      field?.type === 'number' || field?.type === 'date'
        ? null
        : field?.type === 'boolean'
          ? false
          : ['multiSelect', 'files'].includes(field?.type ?? '') ||
              (field?.type === 'relation' && field.multiple !== false) ||
              (field?.type === 'mention' && field.multiple !== false)
            ? []
            : '',
  };
}
export function VariablePicker({
  variables,
  onSelect,
  label,
}: {
  variables: Variable[];
  onSelect: (variable: Variable) => void;
  label?: string;
}) {
  const t = useT();
  const [open, setOpen] = useState(false);
  return (
    <Popover
      label={t('automation.variable')}
      open={open}
      onOpenChange={setOpen}
      mobilePlacement="anchor"
      className="w-80 p-1"
      trigger={
        <IconButton
          label={label ?? t('automation.insertVariable')}
          className="shrink-0 p-2"
          disabled={!variables.length}
        >
          <Braces size={16} />
        </IconButton>
      }
    >
      <OptionsPanel
        label={t('automation.searchVariables')}
        options={variables.map((v) => ({
          id: v.path,
          text: v.label,
          label: (
            <span className="flex items-center justify-between gap-3">
              <span>{v.label}</span>
              <span className="text-xs text-muted">
                {v.many
                  ? t('automation.recordList')
                  : t(`database.${v.field.type}` as TranslationKey)}
              </span>
            </span>
          ),
          group: v.group,
        }))}
        onClose={() => setOpen(false)}
        onSelect={(id) => {
          const variable = variables.find((v) => v.path === id);
          if (variable) onSelect(variable);
          setOpen(false);
        }}
      />
    </Popover>
  );
}
export function ValueEditor({
  field,
  value,
  onChange,
  variables,
  objects,
  error,
  recordDatabaseId,
}: {
  field: Field;
  value: AutomationValue;
  onChange: (value: AutomationValue) => void;
  variables: Variable[];
  objects: TioObject[];
  error?: TranslationKey;
  recordDatabaseId?: string;
}) {
  const t = useT();
  const choices = variables.filter((v) => compatible(v, field, recordDatabaseId));
  const selected =
    value.kind === 'reference' ? choices.find((v) => v.path === value.path) : undefined;
  return (
    <div className="min-w-0 space-y-1">
      <div
        className={cn(
          'flex min-w-0 items-start gap-1 rounded-md border border-line bg-panel p-1 [&_input:not([type=checkbox])]:rounded [&_input:not([type=checkbox])]:px-2 [&_input:not([type=checkbox])]:py-1.5',
          error && 'border-red-500',
        )}
      >
        <div className="min-w-0 flex-1">
          {value.kind === 'reference' ? (
            <div
              className={cn(
                'm-1 flex items-center gap-1 rounded bg-surface px-2 py-1 text-xs',
                !selected && 'text-red-600',
              )}
            >
              <Braces size={13} className="shrink-0" />
              <span className="truncate">
                {selected
                  ? `${selected.group} · ${selected.label}`
                  : t('automation.invalidReference')}
              </span>
              <IconButton
                label={t('automation.removeVariable')}
                className="ml-auto p-0.5"
                onClick={() => onChange(defaultValue(field))}
              >
                <X size={12} />
              </IconButton>
            </div>
          ) : (
            <FieldInput
              field={field}
              value={value.value}
              objects={objects}
              commitMode="form"
              onChange={(next) => onChange({ kind: 'literal', value: next as Json })}
            />
          )}
        </div>
        <VariablePicker
          variables={choices}
          onSelect={(v) => onChange({ kind: 'reference', path: v.path })}
          label={t('automation.fieldVariable', { field: field.name })}
        />
      </div>
      <ErrorHint error={error} />
    </div>
  );
}
export function Conditions({
  value,
  onChange,
  fields,
  variables,
  objects,
  issues = {},
  path = 'condition',
}: {
  value?: AutomationCondition;
  onChange: (value: AutomationCondition | undefined) => void;
  fields: Field[];
  variables: Variable[];
  objects: TioObject[];
  issues?: Record<string, TranslationKey>;
  path?: string;
}) {
  const t = useT();
  const condition = value ?? { mode: 'all', filters: [] };
  const change = (index: number, patch: Partial<AutomationCondition['filters'][number]>) =>
    onChange({
      ...condition,
      filters: condition.filters.map((f, i) => (i === index ? { ...f, ...patch } : f)),
    });
  return (
    <div className="space-y-3">
      {!!condition.filters.length && (
        <Choice
          label={t('automation.match')}
          value={condition.mode}
          onChange={(mode) => onChange({ ...condition, mode: mode as 'all' | 'any' })}
          options={['all', 'any'].map((key) => ({
            value: key,
            label: t(`automation.${key}` as TranslationKey),
          }))}
        />
      )}
      {condition.filters.map((filter, index) => {
        const field = fields.find((f) => f.id === filter.fieldId);
        const inputField = field ? comparisonField(field, filter.op) : undefined;
        const key = `${path}.${index}`;
        return (
          <div key={index} data-issue={key} className="space-y-2">
            <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] gap-2">
              <Choice
                label={t('automation.field')}
                value={filter.fieldId}
                options={fields.map((f) => ({ value: f.id, label: f.name }))}
                onChange={(fieldId) => {
                  const field = fields.find((f) => f.id === fieldId);
                  change(index, {
                    fieldId,
                    op: 'eq',
                    value: defaultValue(field),
                    endValue: undefined,
                  });
                }}
              />
              <Choice
                label={t('automation.operator')}
                value={filter.op}
                options={(field ? operators(field) : [filter.op]).map((op) => ({
                  value: op,
                  label: t(`automation.op.${op}` as TranslationKey),
                }))}
                onChange={(op) =>
                  change(index, {
                    op: op as typeof filter.op,
                    ...(op === 'between' ? { endValue: defaultValue(field) } : {}),
                  })
                }
              />
              <IconButton
                label={t('automation.removeCondition')}
                onClick={() =>
                  onChange({
                    ...condition,
                    filters: condition.filters.filter((_, i) => i !== index),
                  })
                }
              >
                <X size={15} />
              </IconButton>
            </div>
            <ErrorHint error={issues[key]} />
            {inputField && !['empty', 'notEmpty'].includes(filter.op) && (
              <ValueEditor
                field={inputField}
                value={filter.value ?? defaultValue(inputField)}
                onChange={(value) => change(index, { value })}
                variables={variables}
                objects={objects}
                error={issues[`${key}.value`]}
              />
            )}
            {inputField && filter.op === 'between' && (
              <ValueEditor
                field={inputField}
                value={filter.endValue ?? defaultValue(inputField)}
                onChange={(endValue) => change(index, { endValue })}
                variables={variables}
                objects={objects}
                error={issues[`${key}.endValue`]}
              />
            )}
          </div>
        );
      })}
      <Button
        disabled={!fields.length}
        onClick={() =>
          onChange({
            ...condition,
            filters: [
              ...condition.filters,
              { fieldId: fields[0].id, op: 'eq', value: defaultValue(fields[0]) },
            ],
          })
        }
        className="gap-1 px-0 text-sm"
      >
        <Plus size={14} />
        {t('automation.addCondition')}
      </Button>
      <ErrorHint error={issues[path]} />
    </div>
  );
}
