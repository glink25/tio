import {
  type AutomationCapabilities,
  type AutomationAction,
  type TioObject,
  type Field,
} from '@tio/core';
import { useT, type TranslationKey } from '@tio/i18n';
import { Button, IconButton, Menu, MenuItem } from '@tio/ui';
import { MoreHorizontal, Pencil, Trash2, ListPlus, X } from 'lucide-react';

import { Choice, Conditions, ErrorHint, Label, ValueEditor, defaultValue } from './controls';
import { editableFields, variables, type DraftAction, type FlowDraft } from './model';
import { StepCard } from './step-card';
import { TemplateEditor } from './template-editor';
const actionIcons = { 'record.create': ListPlus, 'record.update': Pencil, 'record.delete': Trash2 };
export function ActionEditor({
  action,
  index,
  draft,
  onChange,
  databases,
  capabilities,
  issues,
  reveal,
  confirmChange,
  move,
  remove,
}: {
  action: DraftAction;
  index: number;
  draft: FlowDraft;
  onChange: (action: DraftAction) => void;
  databases: TioObject[];
  capabilities?: AutomationCapabilities;
  issues: Record<string, TranslationKey>;
  reveal: number;
  confirmChange: (apply: () => void) => void;
  move: (direction: -1 | 1) => void;
  remove: () => void;
}) {
  const t = useT();
  const key = `actions.${action.id}`;
  const choose = (kind: AutomationAction['kind']) => {
    const apply = () => onChange({ id: action.id, kind, databaseId: '', properties: {} });
    if (action.kind) confirmChange(apply);
    else apply();
  };
  const database = databases.find((db) => db.id === action.databaseId);
  const fields = editableFields(database);
  const vars = variables(draft, databases, index);
  const target = action.target;
  const previous = vars.filter(
    (v) => v.path.startsWith('steps.') && v.recordDatabaseId === action.databaseId,
  );
  const reference =
    target?.kind === 'record' && target.id.kind === 'reference' ? target.id.path : undefined;
  const targetMode =
    target?.kind === 'record'
      ? reference && previous.some((v) => v.path === reference)
        ? reference
        : 'record'
      : (target?.kind ?? '');
  const options = [
    ...(draft.trigger?.kind.startsWith('record.') && draft.trigger.databaseId === action.databaseId
      ? [{ value: 'trigger', label: t('automation.target.trigger') }]
      : []),
    ...previous.map((v) => ({ value: v.path, label: `${v.group} · ${v.label}` })),
    { value: 'record', label: t('automation.target.record') },
    { value: 'matching', label: t('automation.target.matching') },
  ];
  return (
    <StepCard
      number={index + 2}
      title={
        action.kind
          ? t(`automation.${action.kind}` as TranslationKey)
          : t('automation.chooseAction')
      }
      issueKey={key}
      invalid={Object.keys(issues).some((p) => p === key || p.startsWith(`${key}.`))}
      reveal={reveal}
      menu={
        <Menu
          trigger={
            <IconButton label={t('automation.actionMenu')}>
              <MoreHorizontal size={17} />
            </IconButton>
          }
        >
          {action.kind &&
            capabilities?.actions
              .filter((kind) => kind !== action.kind)
              .map((kind) => (
                <MenuItem key={kind} onSelect={() => choose(kind)}>
                  {t(`automation.${kind}` as TranslationKey)}
                </MenuItem>
              ))}
          <MenuItem disabled={!index} onSelect={() => move(-1)}>
            {t('automation.moveUp')}
          </MenuItem>
          <MenuItem disabled={index === draft.actions.length - 1} onSelect={() => move(1)}>
            {t('automation.moveDown')}
          </MenuItem>
          <MenuItem danger onSelect={remove}>
            {t('automation.removeAction')}
          </MenuItem>
        </Menu>
      }
    >
      {!action.kind ? (
        <div className="space-y-2">
          {capabilities?.actions.map((kind) => {
            const Icon = actionIcons[kind];
            return (
              <Button
                key={kind}
                className="w-full justify-start gap-3 border border-line px-3 py-3"
                onClick={() => choose(kind)}
              >
                <Icon size={17} className="text-muted" />
                {t(`automation.${kind}` as TranslationKey)}
              </Button>
            );
          })}
        </div>
      ) : (
        <>
          <Label title={t('automation.actionDatabase')}>
            <Choice
              label={t('automation.chooseDatabase')}
              value={action.databaseId}
              options={databases.map((db) => ({
                value: db.id,
                label: db.name || t('common.untitled'),
              }))}
              onChange={(databaseId) => {
                const apply = () =>
                  onChange({
                    ...action,
                    databaseId,
                    target: undefined,
                    properties: {},
                    body: undefined,
                  });
                if (action.databaseId) confirmChange(apply);
                else apply();
              }}
            />
          </Label>
          {database && (
            <>
              {action.kind !== 'record.create' && (
                <Label title={t('automation.target')}>
                  <Choice
                    label={t('automation.chooseRecord')}
                    value={targetMode}
                    options={options}
                    onChange={(mode) =>
                      onChange({
                        ...action,
                        target:
                          mode === 'trigger'
                            ? { kind: 'trigger' }
                            : mode === 'matching'
                              ? { kind: 'matching', condition: { mode: 'all', filters: [] } }
                              : {
                                  kind: 'record',
                                  id:
                                    mode === 'record'
                                      ? { kind: 'literal', value: '' }
                                      : { kind: 'reference', path: mode },
                                },
                      })
                    }
                  />
                  {targetMode === 'record' && target?.kind === 'record' && (
                    <ValueEditor
                      field={{
                        id: 'record',
                        name: t('automation.recordId'),
                        type: 'relation',
                        targetDatabaseId: database.id,
                        multiple: false,
                      }}
                      value={target.id}
                      onChange={(id) => onChange({ ...action, target: { kind: 'record', id } })}
                      variables={vars}
                      objects={databases}
                      recordDatabaseId={database.id}
                      error={issues[`${key}.target`]}
                    />
                  )}
                  {target?.kind === 'matching' && (
                    <>
                      <p className="text-xs text-muted">{t('automation.allMatching')}</p>
                      <Conditions
                        value={target.condition}
                        onChange={(condition) =>
                          onChange({
                            ...action,
                            target: {
                              kind: 'matching',
                              condition: condition ?? { mode: 'all', filters: [] },
                            },
                          })
                        }
                        fields={fields}
                        variables={vars}
                        objects={databases}
                        issues={issues}
                        path={`${key}.target`}
                      />
                    </>
                  )}
                  <ErrorHint error={issues[`${key}.target`]} />
                </Label>
              )}
              {action.kind === 'record.delete' ? (
                <p className="rounded bg-surface p-3 text-sm text-secondary">
                  {t('automation.deleteWarning')}
                </p>
              ) : (
                <>
                  <Label title={t('automation.properties')}>
                    <div className="space-y-3">
                      {Object.entries(action.properties ?? {}).map(([id, value]) => {
                        const field = fields.find((f) => f.id === id);
                        const fallback: Field = {
                          id,
                          name: t('automation.missingField'),
                          type: 'text',
                        };
                        return (
                          <div
                            key={id}
                            data-issue={`${key}.properties.${id}`}
                            className="space-y-1"
                          >
                            <div className="flex items-center justify-between text-sm">
                              <span>{field?.name ?? fallback.name}</span>
                              <IconButton
                                label={t('automation.removeProperty')}
                                onClick={() =>
                                  onChange({
                                    ...action,
                                    properties: Object.fromEntries(
                                      Object.entries(action.properties ?? {}).filter(
                                        ([key]) => key !== id,
                                      ),
                                    ),
                                  })
                                }
                              >
                                <X size={14} />
                              </IconButton>
                            </div>
                            <ValueEditor
                              field={field ?? fallback}
                              value={value}
                              onChange={(value) =>
                                onChange({
                                  ...action,
                                  properties: { ...action.properties, [id]: value },
                                })
                              }
                              variables={vars}
                              objects={databases}
                              error={issues[`${key}.properties.${id}`]}
                            />
                          </div>
                        );
                      })}
                      <Choice
                        label={t('automation.addProperty')}
                        value=""
                        options={fields
                          .filter((field) => !Object.hasOwn(action.properties ?? {}, field.id))
                          .map((field) => ({ value: field.id, label: field.name }))}
                        onChange={(id) =>
                          onChange({
                            ...action,
                            properties: {
                              ...action.properties,
                              [id]: defaultValue(fields.find((field) => field.id === id)),
                            },
                          })
                        }
                      />
                    </div>
                  </Label>
                  <Label title={t('automation.body')}>
                    <Choice
                      label={t('automation.body')}
                      value={action.body?.mode ?? 'none'}
                      options={['none', 'append', 'replace'].map((mode) => ({
                        value: mode,
                        label: t(`automation.body.${mode}` as TranslationKey),
                      }))}
                      onChange={(mode) =>
                        onChange({
                          ...action,
                          body:
                            mode === 'none'
                              ? undefined
                              : {
                                  mode: mode as 'append' | 'replace',
                                  template: action.body?.template ?? '',
                                },
                        })
                      }
                    />
                    {action.body && (
                      <div data-issue={`${key}.body`}>
                        <TemplateEditor
                          value={action.body.template}
                          onChange={(template) =>
                            onChange({ ...action, body: { ...action.body!, template } })
                          }
                          variables={vars}
                        />
                        <ErrorHint error={issues[`${key}.body`]} />
                      </div>
                    )}
                  </Label>
                </>
              )}
            </>
          )}
        </>
      )}
      <ErrorHint error={issues[key]} />
    </StepCard>
  );
}
