import { type AutomationCapabilities, type AutomationTriggerKind, type TioObject } from '@tio/core';
import { useT, type TranslationKey } from '@tio/i18n';
import { Button, Menu, MenuItem, IconButton } from '@tio/ui';
import {
  MoreHorizontal,
  FilePlus2,
  FileX2,
  ListPlus,
  Pencil,
  ListFilter,
  FileText,
  Trash2,
  X,
} from 'lucide-react';
import { useState } from 'react';

import { Choice, Conditions, ErrorHint, Label } from './controls';
import { conditionFields, variables, type FlowDraft } from './model';
import { StepCard } from './step-card';
const icons = {
  'page.created': FilePlus2,
  'page.deleted': FileX2,
  'record.created': ListPlus,
  'record.properties': Pencil,
  'record.body': FileText,
  'record.deleted': Trash2,
  'record.entersCondition': ListFilter,
};
export function TriggerEditor({
  draft,
  onChange,
  databases,
  pages,
  capabilities,
  issues,
  reveal,
  confirmChange,
}: {
  draft: FlowDraft;
  onChange: (draft: FlowDraft) => void;
  databases: TioObject[];
  pages: TioObject[];
  capabilities?: AutomationCapabilities;
  issues: Record<string, TranslationKey>;
  reveal: number;
  confirmChange: (apply: () => void) => void;
}) {
  const t = useT();
  const trigger = draft.trigger;
  const [conditionsOpen, setConditionsOpen] = useState(false);
  const choose = (kind: AutomationTriggerKind) => {
    const apply = () => onChange({ ...draft, trigger: { kind }, condition: undefined });
    if (trigger && (draft.condition || draft.actions.length)) confirmChange(apply);
    else apply();
  };
  if (!trigger)
    return (
      <StepCard
        number={1}
        title={t('automation.chooseTrigger')}
        issueKey="trigger"
        invalid={!!issues.trigger}
        reveal={reveal}
      >
        <div className="space-y-2">
          {capabilities?.triggers.map((kind) => {
            const Icon = icons[kind];
            return (
              <Button
                key={kind}
                onClick={() => choose(kind)}
                className="w-full justify-start gap-3 border border-line px-3 py-3 text-left"
              >
                <Icon size={17} className="text-muted" />
                {t(`automation.${kind}` as TranslationKey)}
              </Button>
            );
          })}
        </div>
        <ErrorHint error={issues.trigger} />
      </StepCard>
    );
  const fields = conditionFields(draft, databases);
  const required = trigger.kind === 'record.entersCondition';
  return (
    <StepCard
      number={1}
      title={t(`automation.${trigger.kind}` as TranslationKey)}
      issueKey="trigger"
      invalid={Object.keys(issues).some((key) => key === 'trigger' || key.startsWith('condition'))}
      reveal={reveal}
      menu={
        <Menu
          trigger={
            <IconButton label={t('automation.triggerMenu')}>
              <MoreHorizontal size={17} />
            </IconButton>
          }
        >
          {capabilities?.triggers
            .filter((kind) => kind !== trigger.kind)
            .map((kind) => (
              <MenuItem key={kind} onSelect={() => choose(kind)}>
                {t(`automation.${kind}` as TranslationKey)}
              </MenuItem>
            ))}
        </Menu>
      }
    >
      {trigger.kind.startsWith('record.') ? (
        <Label title={t('automation.triggerDatabase')}>
          <Choice
            label={t('automation.chooseDatabase')}
            value={trigger.databaseId ?? ''}
            options={databases.map((database) => ({
              value: database.id,
              label: database.name || t('common.untitled'),
            }))}
            onChange={(databaseId) => {
              const apply = () =>
                onChange({
                  ...draft,
                  trigger: { ...trigger, databaseId, fieldIds: undefined },
                  condition: undefined,
                });
              if (trigger.databaseId && (draft.condition || draft.actions.length))
                confirmChange(apply);
              else apply();
            }}
          />
        </Label>
      ) : (
        <Label title={t('automation.pageScope')}>
          <Choice
            label={t('automation.pageScope')}
            value={
              trigger.parentId === undefined
                ? 'workspace'
                : trigger.parentId === null
                  ? 'root'
                  : trigger.parentId
            }
            options={[
              { value: 'workspace', label: t('automation.wholeWorkspace') },
              { value: 'root', label: t('automation.rootPages') },
              ...pages.map((p) => ({ value: p.id, label: p.title || t('common.untitled') })),
            ]}
            onChange={(parentId) =>
              onChange({
                ...draft,
                trigger: {
                  ...trigger,
                  parentId:
                    parentId === 'workspace' ? undefined : parentId === 'root' ? null : parentId,
                },
              })
            }
          />
        </Label>
      )}
      {trigger.kind === 'record.properties' && trigger.databaseId && (
        <Label title={t('automation.watchedFields')}>
          <p className="text-xs text-muted">{t('automation.allFieldsHint')}</p>
          <div className="space-y-2">
            {trigger.fieldIds
              ?.filter((id) => !fields.some((field) => field.id === id))
              .map((id) => (
                <div
                  key={id}
                  className="flex items-center justify-between rounded border border-red-400 px-3 py-2 text-xs text-red-600"
                >
                  <span>{t('automation.missingField')}</span>
                  <IconButton
                    label={t('automation.removeProperty')}
                    onClick={() =>
                      onChange({
                        ...draft,
                        trigger: {
                          ...trigger,
                          fieldIds: trigger.fieldIds?.filter((key) => key !== id),
                        },
                      })
                    }
                  >
                    <X size={14} />
                  </IconButton>
                </div>
              ))}
            {fields.map((field) => (
              <label
                key={field.id}
                className="flex items-center gap-2 rounded bg-surface px-3 py-2 text-sm"
              >
                <input
                  type="checkbox"
                  checked={trigger.fieldIds?.includes(field.id) ?? false}
                  onChange={(event) =>
                    onChange({
                      ...draft,
                      trigger: {
                        ...trigger,
                        fieldIds: event.target.checked
                          ? [...(trigger.fieldIds ?? []), field.id]
                          : trigger.fieldIds?.filter((id) => id !== field.id),
                      },
                    })
                  }
                />
                {field.name}
              </label>
            ))}
          </div>
        </Label>
      )}
      {!!fields.length &&
        (required ||
        conditionsOpen ||
        draft.condition?.filters.length ||
        Object.keys(issues).some((key) => key.startsWith('condition')) ? (
          <Label title={required ? t('automation.conditions') : t('automation.triggerConditions')}>
            <Conditions
              value={draft.condition}
              fields={fields}
              variables={variables(draft, databases)}
              objects={databases}
              issues={issues}
              onChange={(condition) => onChange({ ...draft, condition })}
            />
          </Label>
        ) : (
          <Button className="px-0 text-sm text-muted" onClick={() => setConditionsOpen(true)}>
            {t('automation.triggerConditions')}
            <Chevron />
          </Button>
        ))}
      <ErrorHint error={issues.trigger} />
    </StepCard>
  );
}
function Chevron() {
  return (
    <span aria-hidden className="ml-1">
      ⌄
    </span>
  );
}
