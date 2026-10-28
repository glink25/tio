import type { AutomationRule, AutomationRun, TioObject } from '@tio/core';
import { useT, type TranslationKey } from '@tio/i18n';
import { Button, IconButton, Menu, MenuItem, cn } from '@tio/ui';
import {
  Plus,
  MoreHorizontal,
  Workflow,
  Search,
  List,
  CircleCheck,
  CirclePause,
  Activity,
} from 'lucide-react';
import { useState } from 'react';

import { inputClass } from './controls';
import { flowSummary } from './model';
export function AutomationManager({
  rules,
  databases,
  runs,
  create,
  edit,
  toggle,
  remove,
  logs,
  canEdit,
  canDelete,
  canCreate,
  busy,
  supported,
}: {
  rules: AutomationRule[];
  databases: TioObject[];
  runs: readonly AutomationRun[];
  create: () => void;
  edit: (rule: AutomationRule) => void;
  toggle: (rule: AutomationRule) => void;
  remove: (rule: AutomationRule) => void;
  logs: () => void;
  canEdit: (rule: AutomationRule) => boolean;
  canDelete: (rule: AutomationRule) => boolean;
  canCreate: boolean;
  busy: boolean;
  supported: (rule: AutomationRule) => boolean;
}) {
  const t = useT();
  const [filter, setFilter] = useState('all');
  const [search, setSearch] = useState('');
  const visible = rules.filter(
    (rule) =>
      (filter === 'all' || (filter === 'enabled') === rule.enabled) &&
      rule.name.toLocaleLowerCase().includes(search.toLocaleLowerCase()),
  );
  const createButton = (
    <Button variant="primary" disabled={!canCreate || busy} className="gap-2" onClick={create}>
      <Plus size={16} />
      {t('automation.newRule')}
    </Button>
  );
  return (
    <div className="flex min-h-full flex-col md:flex-row">
      <nav
        aria-label={t('automation.filters')}
        className="flex shrink-0 gap-1 border-b border-line p-3 md:w-56 md:flex-col md:gap-2 md:border-r md:border-b-0 md:p-5"
      >
        {['all', 'enabled', 'disabled'].map((key) => {
          const Icon = key === 'all' ? List : key === 'enabled' ? CircleCheck : CirclePause;
          return (
            <Button
              key={key}
              aria-pressed={filter === key}
              className={cn(
                'flex-1 justify-start gap-2 px-3 py-2 text-sm md:flex-none',
                filter === key && 'bg-surface-hover',
              )}
              onClick={() => setFilter(key)}
            >
              <Icon size={15} />
              <span>{t(`automation.filter.${key}` as TranslationKey)}</span>
              <span className="ml-auto text-xs text-muted">
                {
                  rules.filter((rule) => key === 'all' || (key === 'enabled') === rule.enabled)
                    .length
                }
              </span>
            </Button>
          );
        })}
      </nav>
      <section className="min-w-0 flex-1 p-4 md:p-7">
        <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
          <label className="relative w-full sm:max-w-xs">
            <Search size={15} className="absolute top-3 left-3 text-muted" />
            <input
              className={`${inputClass} pl-9`}
              aria-label={t('automation.searchRules')}
              placeholder={t('automation.searchRules')}
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
          </label>
          <div className="flex gap-2">
            <Button className="gap-2 border border-line" onClick={logs}>
              <Activity size={15} />
              {t('automation.runLogs')}
            </Button>
            {createButton}
          </div>
        </div>
        <p className="mb-4 text-xs text-muted">
          {t('automation.ruleCounts', {
            count: rules.length,
            enabled: rules.filter((rule) => rule.enabled).length,
          })}
        </p>
        {!visible.length ? (
          <div className="flex flex-col items-center gap-4 py-20 text-center">
            <Workflow size={46} strokeWidth={1} className="text-muted" />
            <p className="text-sm text-muted">
              {rules.length ? t('automation.noResults') : t('automation.empty')}
            </p>
            {!rules.length && createButton}
          </div>
        ) : (
          <div className="divide-y divide-line rounded-lg border border-line">
            {visible.map((rule) => {
              const run = runs.find((run) => run.ruleId === rule.id);
              return (
                <div key={rule.id} className="flex items-center gap-3 px-4 py-4">
                  <Button
                    onClick={() => edit(rule)}
                    className="min-w-0 flex-1 flex-col items-start gap-2 p-0 text-left"
                  >
                    <span className="font-medium">{rule.name}</span>
                    <span className="max-w-full truncate text-xs text-muted">
                      {flowSummary(rule, databases)}
                    </span>
                  </Button>
                  <div className="hidden text-xs text-muted lg:block">
                    {run
                      ? t(`automation.status.${run.status}` as TranslationKey)
                      : t('automation.notRun')}
                  </div>
                  <Button
                    role="switch"
                    aria-checked={rule.enabled}
                    aria-label={t('automation.ruleToggle', { name: rule.name })}
                    disabled={busy || !canEdit(rule) || !supported(rule)}
                    onClick={() => toggle(rule)}
                    className="gap-2 text-xs"
                  >
                    <span
                      aria-hidden
                      className={cn(
                        'flex h-5 w-8 items-center rounded-full border border-line p-0.5',
                        rule.enabled ? 'justify-end bg-ink' : 'justify-start bg-surface',
                      )}
                    >
                      <span
                        className={cn(
                          'size-3.5 rounded-full',
                          rule.enabled ? 'bg-panel' : 'bg-secondary',
                        )}
                      />
                    </span>
                    <span className="hidden sm:block">
                      {supported(rule)
                        ? rule.enabled
                          ? t('automation.enabled')
                          : t('automation.disabled')
                        : t('automation.unsupportedRule')}
                    </span>
                  </Button>
                  <Menu
                    trigger={
                      <IconButton label={t('automation.ruleMenu', { name: rule.name })}>
                        <MoreHorizontal size={18} />
                      </IconButton>
                    }
                  >
                    <MenuItem onSelect={() => edit(rule)}>{t('automation.editFlow')}</MenuItem>
                    <MenuItem
                      danger
                      disabled={busy || !canDelete(rule)}
                      onSelect={() => remove(rule)}
                    >
                      {t('automation.delete')}
                    </MenuItem>
                  </Menu>
                </div>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}
