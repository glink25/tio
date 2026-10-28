import type { AutomationProvider, AutomationRun } from '@tio/core';
import { useT, type TranslationKey } from '@tio/i18n';
import { Button, cn } from '@tio/ui';
import { useState } from 'react';
export function RunLog({
  runs,
  provider,
}: {
  runs: readonly AutomationRun[];
  provider?: AutomationProvider;
}) {
  const t = useT();
  const [selected, setSelected] = useState<string>();
  const current = runs.find((run) => run.id === selected) ?? runs[0];
  return (
    <div className="flex min-h-full flex-col">
      <div className="border-b border-line px-5 py-3 text-xs text-muted">
        {provider?.capabilities.history === 'session'
          ? t('automation.sessionHistory')
          : t('automation.providerHistory')}
      </div>
      {!runs.length ? (
        <div className="p-12 text-center text-sm text-muted">{t('automation.noRuns')}</div>
      ) : (
        <div className="grid flex-1 md:grid-cols-[320px_minmax(0,1fr)]">
          <div className="max-h-64 overflow-y-auto border-b border-line p-3 md:max-h-none md:border-r md:border-b-0">
            {runs.map((run) => (
              <Button
                key={run.id}
                onClick={() => setSelected(run.id)}
                className={cn(
                  'mb-1 w-full flex-col items-start gap-1 px-3 py-3 text-left',
                  current?.id === run.id && 'bg-surface-hover',
                )}
              >
                <span className="flex w-full justify-between gap-2">
                  <span className="truncate">{run.ruleName || t('automation.loadingRules')}</span>
                  <span className="text-xs text-muted">
                    {t(`automation.status.${run.status}` as TranslationKey)}
                  </span>
                </span>
                <span className="text-xs text-muted">
                  {new Date(run.startedAt).toLocaleString()}
                </span>
              </Button>
            ))}
          </div>
          {current && (
            <section className="space-y-5 p-5 md:p-8">
              <div>
                <h3 className="text-lg font-medium">
                  {current.ruleName || t('automation.loadingRules')}
                </h3>
                <p className="mt-2 text-sm text-muted">
                  {t(`automation.status.${current.status}` as TranslationKey)} ·{' '}
                  {new Date(current.startedAt).toLocaleString()}
                </p>
                {current.error && (
                  <p role="alert" className="mt-2 text-sm text-red-600">
                    {t(`automation.error.${current.error}` as TranslationKey)}
                  </p>
                )}
              </div>
              <p className="text-xs text-muted">{t('automation.completedWritesRemain')}</p>
              {current.steps.map((step, index) => (
                <div key={step.actionId} className="rounded-lg border border-line p-4">
                  <div className="flex items-center justify-between gap-3 text-sm">
                    <span>{t('automation.step', { number: index + 2 })}</span>
                    <span>{t(`automation.status.${step.status}` as TranslationKey)}</span>
                  </div>
                  <p className="mt-2 text-xs text-muted">
                    {t('automation.affectedRecords', { count: step.recordIds.length })}
                  </p>
                  {step.error && (
                    <p className="mt-2 text-sm text-red-600">
                      {t(`automation.error.${step.error}` as TranslationKey)}
                    </p>
                  )}
                </div>
              ))}
            </section>
          )}
        </div>
      )}
    </div>
  );
}
