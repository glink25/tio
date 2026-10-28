import { ruleUnsupported } from '@tio/automation';
import {
  resourceOf,
  HostError,
  type AutomationRule,
  type TioObject,
  type AutomationRun,
} from '@tio/core';
import { useT, errorMessage } from '@tio/i18n';
import { OverlayPresence } from '@tio/ui';
import { LoadingSkeleton } from '@tio/ui';
import { Button, IconButton, Modal, MentionContext, cn } from '@tio/ui';
import { RecordQueryContext } from '@tio/views';
import { createMentionService } from '@tio/web-editor/mentions';
import type { WorkspaceRuntime } from '@tio/workspace';
import { ArrowLeft, ArrowRight, Plus, Workflow, Info } from 'lucide-react';
import { useEffect, useState, useMemo, useRef } from 'react';

import { ActionEditor } from './action-editor';
import { ErrorHint } from './controls';
import { AutomationManager } from './manager';
import { blankAction, flowIssues, flowSummary, toRule } from './model';
import { RunLog } from './run-log';
import { TriggerEditor } from './trigger-editor';
import { useFlowDraft } from './use-flow';
export default function AutomationDialog({
  runtime,
  workspaceId,
  close,
  registerClose,
}: {
  runtime: WorkspaceRuntime;
  workspaceId: string;
  close: () => void;
  registerClose?: (request: () => void) => void;
}) {
  const t = useT();
  const flow = useFlowDraft();
  const { draft } = flow;
  const [view, setView] = useState<'manager' | 'editor' | 'logs'>('manager');
  const [rules, setRules] = useState<AutomationRule[]>([]);
  const [databases, setDatabases] = useState<TioObject[]>([]);
  const [runs, setRuns] = useState<readonly AutomationRun[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const [reveal, setReveal] = useState(0);
  const [showIssues, setShowIssues] = useState(false);
  const [writable, setWritable] = useState(runtime.state.getState().writable);
  const [leave, setLeave] = useState<() => void>();
  const [change, setChange] = useState<() => void>();
  const [deleteRule, setDeleteRule] = useState<AutomationRule>();
  const submitted = useRef<{ id: string; write: Promise<void> }>();
  const content = useRef<HTMLDivElement>(null);
  const name = useRef<HTMLInputElement>(null);
  const provider = runtime.automation;
  const capabilities = provider?.capabilities;
  const mentions = useMemo(
    () => createMentionService(runtime, workspaceId, () => {}),
    [runtime, workspaceId],
  );
  const queryRecords = useMemo(() => runtime.records.bind(runtime), [runtime]);
  useEffect(() => {
    let disposed = false;
    let generation = 0;
    const load = async () => {
      const current = ++generation;
      try {
        const [rules, databases] = await Promise.all([
          runtime.queryObjects({ type: 'automation' }),
          runtime.queryObjects({ type: 'database' }),
        ]);
        if (!disposed && current === generation) {
          setRules(rules.filter((o) => !o.deleted) as AutomationRule[]);
          setDatabases(databases.filter((o) => !o.deleted));
          setLoadError('');
        }
      } catch (error) {
        if (!disposed && current === generation) setLoadError(errorMessage(error));
      } finally {
        if (!disposed && current === generation) setLoading(false);
      }
    };
    void load();
    const stop = runtime.state.subscribe((state, previous) => {
      setWritable(state.writable);
      if (state.version !== previous.version) void load();
    });
    return () => {
      disposed = true;
      stop();
    };
  }, [runtime, refresh]);
  useEffect(() => {
    if (!provider) return;
    setRuns(provider.getRuns());
    return provider.subscribeRuns(() => setRuns(provider.getRuns()));
  }, [provider]);
  const canEdit = (rule: AutomationRule) =>
    writable && runtime.access.allows(resourceOf(rule), 'update');
  const canDelete = (rule: AutomationRule) =>
    writable && runtime.access.allows(resourceOf(rule), 'delete');
  const canCreate =
    writable &&
    !!capabilities?.triggers.length &&
    !!capabilities.actions.length &&
    runtime.access.allows({ workspaceId, id: workspaceId, type: 'automation' }, 'create');
  const canWriteDraft = draft?.original ? canEdit(draft.original) : canCreate;
  const issues = draft ? flowIssues(draft, databases, capabilities) : {};
  const visibleIssues = showIssues
    ? issues
    : Object.fromEntries(
        Object.entries(issues).filter(([, message]) =>
          [
            'automation.invalidReference',
            'automation.missingField',
            'automation.unsupportedRule',
          ].includes(message),
        ),
      );
  const triggerReady =
    !!draft?.trigger &&
    !Object.keys(issues).some((key) => key === 'trigger' || key.startsWith('condition'));
  const requestLeave = (apply: () => void) => {
    if (busy) return;
    if (flow.dirty) setLeave(() => apply);
    else apply();
  };
  useEffect(() => {
    registerClose?.(() => requestLeave(close));
  });
  const back = () =>
    requestLeave(() => {
      flow.clear();
      setView('manager');
      setShowIssues(false);
      setError('');
    });
  const confirmChange = (apply: () => void) => setChange(() => apply);
  const focusIssue = () => {
    setShowIssues(true);
    setReveal((n) => n + 1);
    requestAnimationFrame(() => {
      const key = Object.keys(issues)[0];
      if (key === 'name') {
        name.current?.focus();
        return;
      }
      const nodes = [...(content.current?.querySelectorAll<HTMLElement>('[data-issue]') ?? [])];
      const element =
        nodes.find((node) => node.dataset.issue === key) ??
        nodes.find((node) => key?.startsWith(node.dataset.issue!));
      element?.scrollIntoView({ block: 'center', behavior: 'smooth' });
      (element?.querySelector<HTMLElement>('input,button,[tabindex="0"]') ?? element)?.focus();
    });
  };
  const persist = async (rule: AutomationRule, original?: AutomationRule) => {
    if (!writable) throw new HostError('permission');
    // Recover an already submitted command through the existing runtime queue before another save.
    if (submitted.current) {
      const previous = submitted.current;
      if (runtime.state.getState().error) await runtime.retry();
      await previous.write;
      if (previous.id === rule.id)
        original = runtime.snapshot().find((o) => o.id === rule.id) as AutomationRule | undefined;
      submitted.current = undefined;
    }
    if (original) {
      await runtime.ensure([original.id]);
      rule = { ...rule, createdAt: original.createdAt, updatedAt: original.updatedAt };
    }
    const write = runtime.checked(original ? [original] : [], [rule], () => {
      if (!runtime.state.getState().writable) throw new HostError('permission');
    });
    submitted.current = { id: rule.id, write };
    try {
      await Promise.all([write, runtime.flush()]);
      submitted.current = undefined;
    } catch (error) {
      if (!runtime.state.getState().error) submitted.current = undefined;
      throw error;
    }
    setRefresh((n) => n + 1);
  };
  const save = async (enabled: boolean, after?: () => void) => {
    if (!draft || busy || !canWriteDraft) return;
    if (Object.keys(issues).length) {
      focusIssue();
      return;
    }
    setBusy(true);
    setError('');
    try {
      await persist(toRule(draft, workspaceId, enabled), draft.original);
      flow.clear();
      setView('manager');
      setShowIssues(false);
      setLeave(undefined);
      after?.();
    } catch (error) {
      setError(errorMessage(error));
    } finally {
      setBusy(false);
    }
  };
  const toggle = async (rule: AutomationRule) => {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      if (!rule.enabled) {
        const errors = flowIssues(
          {
            id: rule.id,
            name: rule.name,
            trigger: rule.trigger,
            condition: rule.condition,
            actions: rule.actions,
            original: rule,
          },
          databases,
          capabilities,
        );
        if (Object.keys(errors).length) {
          flow.begin(rule);
          setView('editor');
          setShowIssues(true);
          return;
        }
      }
      await persist({ ...rule, enabled: !rule.enabled }, rule);
    } catch (error) {
      setError(errorMessage(error));
    } finally {
      setBusy(false);
    }
  };
  const tabs = draft && (
    <div
      className="flex w-full justify-center gap-3 self-stretch text-sm md:w-auto md:justify-start md:gap-6"
      role="tablist"
      aria-label={t('automation.flowViews')}
    >
      {(['editor', 'logs'] as const).map((tab) => (
        <Button
          key={tab}
          role="tab"
          aria-selected={view === tab}
          className={cn(
            'rounded-none border-b-2 px-1',
            view === tab ? 'border-ink font-medium' : 'border-transparent text-muted',
          )}
          onClick={() => setView(tab)}
        >
          {t(tab === 'editor' ? 'automation.editFlow' : 'automation.runLogs')}
        </Button>
      ))}
    </div>
  );
  const title = draft
    ? t('automation.flow')
    : view === 'logs'
      ? t('automation.runLogs')
      : t('automation.center');
  const header = (
    <div className="flex min-w-0 flex-1 flex-wrap items-center gap-3 md:gap-5">
      {draft || view === 'logs' ? (
        <IconButton
          label={t('ui.back')}
          onClick={draft && view === 'logs' ? () => setView('editor') : back}
        >
          <ArrowLeft size={19} />
        </IconButton>
      ) : (
        <Workflow size={21} className="text-secondary" />
      )}
      {draft ? (
        <input
          ref={name}
          className="min-w-0 flex-1 rounded bg-transparent px-1 py-1 text-base font-medium outline-none focus:ring-1 focus:ring-line md:max-w-sm"
          aria-label={t('automation.name')}
          value={draft.name}
          disabled={!canWriteDraft || busy}
          onChange={(event) => flow.setDraft({ ...draft, name: event.target.value })}
        />
      ) : (
        <h2 className="mr-auto text-base font-semibold">{title}</h2>
      )}
      {tabs}
      <ErrorHint error={visibleIssues.name} />
    </div>
  );
  const footer =
    draft && view === 'editor' ? (
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <p className="min-w-0 flex-1 truncate text-xs text-muted">
          {flowSummary(draft, databases)}
        </p>
        <div className="flex justify-end gap-2">
          <Button
            disabled={busy || !canWriteDraft || !draft.trigger || !draft.actions.length}
            className="border border-line"
            onClick={() => void save(false)}
          >
            {t('automation.saveOnly')}
          </Button>
          <Button
            variant="primary"
            disabled={busy || !canWriteDraft || !draft.trigger || !draft.actions.length}
            onClick={() => void save(true)}
          >
            {busy ? t('automation.saving') : t('automation.saveEnable')}
          </Button>
        </div>
      </div>
    ) : undefined;
  return (
    <MentionContext.Provider value={mentions}>
      <RecordQueryContext.Provider value={queryRecords}>
        <Modal
          layout="workspace"
          trackHistory={!registerClose}
          title={title}
          header={header}
          footer={footer}
          close={() => requestLeave(close)}
        >
          {error && (
            <div role="alert" className="border-b border-line px-5 py-3 text-sm text-red-600">
              {error}
            </div>
          )}
          {loading ? (
            <LoadingSkeleton layout="inline" />
          ) : loadError ? (
            <div role="alert" className="space-y-4 p-12 text-center">
              <p>{loadError}</p>
              <Button
                className="border border-line"
                onClick={() => {
                  setLoading(true);
                  setRefresh((n) => n + 1);
                }}
              >
                {t('automation.retry')}
              </Button>
            </div>
          ) : (
            <>
              {!provider && (
                <p className="border-b border-line px-5 py-3 text-sm text-muted">
                  {t('automation.unsupported')}
                </p>
              )}
              {view === 'manager' ? (
                <AutomationManager
                  rules={rules}
                  databases={databases}
                  runs={runs}
                  create={() => {
                    flow.begin();
                    setView('editor');
                    setShowIssues(false);
                    setError('');
                  }}
                  edit={(rule) => {
                    flow.begin(rule);
                    setView('editor');
                    setShowIssues(false);
                    setError('');
                  }}
                  toggle={(rule) => void toggle(rule)}
                  remove={setDeleteRule}
                  logs={() => setView('logs')}
                  canEdit={canEdit}
                  canDelete={canDelete}
                  canCreate={canCreate}
                  busy={busy}
                  supported={(rule) => !ruleUnsupported(rule, capabilities)}
                />
              ) : view === 'logs' ? (
                <RunLog
                  runs={draft ? runs.filter((run) => run.ruleId === draft.id) : runs}
                  provider={provider}
                />
              ) : (
                draft && (
                  <div ref={content} className="min-h-full bg-surface">
                    <fieldset
                      disabled={!canWriteDraft || busy}
                      className="relative grid min-h-full min-w-0 md:grid-cols-2"
                    >
                      <div className="min-w-0 space-y-5 border-b border-line px-4 py-6 md:border-r md:border-b-0 md:px-10 md:py-8">
                        <h3 className="mb-6 text-base font-medium">
                          {t('automation.whenHeading')}
                        </h3>
                        <TriggerEditor
                          draft={draft}
                          onChange={flow.setDraft}
                          databases={databases}
                          pages={runtime.snapshot().filter((o) => o.type === 'page' && !o.deleted)}
                          capabilities={capabilities}
                          issues={visibleIssues}
                          reveal={reveal}
                          confirmChange={confirmChange}
                        />
                      </div>
                      <div className="min-w-0 space-y-5 px-4 py-6 md:px-10 md:py-8">
                        <h3 className="mb-6 text-base font-medium">
                          {t('automation.thenHeading')}
                        </h3>
                        {draft.actions.map((action, index) => (
                          <ActionEditor
                            key={action.id}
                            action={action}
                            index={index}
                            draft={draft}
                            onChange={(next) =>
                              flow.setDraft({
                                ...draft,
                                actions: draft.actions.map((a) => (a.id === next.id ? next : a)),
                              })
                            }
                            databases={databases}
                            capabilities={capabilities}
                            issues={visibleIssues}
                            reveal={reveal}
                            confirmChange={confirmChange}
                            move={(direction) => {
                              const actions = [...draft.actions];
                              [actions[index], actions[index + direction]] = [
                                actions[index + direction],
                                actions[index],
                              ];
                              flow.setDraft({ ...draft, actions });
                            }}
                            remove={() => {
                              const apply = () =>
                                flow.setDraft({
                                  ...draft,
                                  actions: draft.actions.filter((a) => a.id !== action.id),
                                });
                              const referenced = draft.actions.some((a) =>
                                JSON.stringify(a).includes(`steps.${action.id}.ids`),
                              );
                              if (
                                referenced ||
                                action.databaseId ||
                                Object.keys(action.properties ?? {}).length ||
                                action.body
                              )
                                confirmChange(apply);
                              else apply();
                            }}
                          />
                        ))}
                        {!draft.actions.length && (
                          <div className="rounded-xl border border-dashed border-line bg-panel p-6">
                            <p className="mb-4 text-sm text-muted">
                              {triggerReady
                                ? t('automation.chooseAction')
                                : t('automation.completeTriggerFirst')}
                            </p>
                            <Button
                              disabled={!triggerReady}
                              className="gap-2 border border-line"
                              onClick={() => flow.setDraft({ ...draft, actions: [blankAction()] })}
                            >
                              <Plus size={15} />
                              {t('automation.chooseAction')}
                            </Button>
                          </div>
                        )}
                        {!!draft.actions.length && (
                          <Button
                            disabled={!triggerReady}
                            className="gap-2 px-0 text-sm"
                            onClick={() =>
                              flow.setDraft({
                                ...draft,
                                actions: [...draft.actions, blankAction()],
                              })
                            }
                          >
                            <Plus size={16} />
                            {t('automation.addAction')}
                          </Button>
                        )}
                        <ErrorHint error={visibleIssues.actions} />
                      </div>
                      <div
                        aria-hidden
                        className="pointer-events-none absolute top-1/2 left-1/2 hidden -translate-x-1/2 rounded-full border border-line bg-surface p-3 text-muted md:block"
                      >
                        <ArrowRight size={21} />
                      </div>
                    </fieldset>
                    <details className="mx-4 mb-6 rounded-lg border border-line bg-panel text-xs text-muted md:mx-10">
                      <summary className="flex cursor-pointer items-center gap-2 px-4 py-3">
                        <Info size={14} />
                        {t('automation.executionDetails')}
                      </summary>
                      <p className="px-4 pb-4">
                        {capabilities?.execution === 'server'
                          ? t('automation.serverGuarantee')
                          : t('automation.sessionGuarantee')}
                      </p>
                    </details>
                  </div>
                )
              )}
            </>
          )}
        </Modal>
        <OverlayPresence>
          {leave && (
            <Modal
              title={t('automation.unsavedTitle')}
              mobilePlacement="center"
              close={() => setLeave(undefined)}
            >
              <p className="text-sm text-muted">{t('automation.unsavedMessage')}</p>
              <div className="mt-5 flex flex-wrap justify-end gap-2">
                <Button onClick={() => setLeave(undefined)}>
                  {t('automation.continueEditing')}
                </Button>
                <Button
                  className="border border-line"
                  onClick={() => {
                    const action = leave;
                    setLeave(undefined);
                    action();
                  }}
                >
                  {t('automation.discardChanges')}
                </Button>
                {!Object.keys(issues).length && (
                  <Button
                    variant="primary"
                    disabled={busy || !canWriteDraft}
                    onClick={() => void save(draft?.original?.enabled ?? false, leave)}
                  >
                    {t('automation.saveLeave')}
                  </Button>
                )}
              </div>
            </Modal>
          )}
        </OverlayPresence>
        <OverlayPresence>
          {change && (
            <Modal
              title={t('automation.changeTitle')}
              mobilePlacement="center"
              close={() => setChange(undefined)}
            >
              <p className="text-sm text-muted">{t('automation.changeMessage')}</p>
              <div className="mt-5 flex justify-end gap-2">
                <Button onClick={() => setChange(undefined)}>{t('ui.cancel')}</Button>
                <Button
                  variant="primary"
                  onClick={() => {
                    change();
                    setChange(undefined);
                  }}
                >
                  {t('automation.confirmChange')}
                </Button>
              </div>
            </Modal>
          )}
        </OverlayPresence>
        <OverlayPresence>
          {deleteRule && (
            <Modal
              title={t('automation.deleteFlow')}
              mobilePlacement="center"
              close={() => {
                if (!busy) setDeleteRule(undefined);
              }}
            >
              <p className="text-sm text-muted">
                {t('automation.deleteFlowMessage', { name: deleteRule.name })}
              </p>
              <div className="mt-5 flex justify-end gap-2">
                <Button disabled={busy} onClick={() => setDeleteRule(undefined)}>
                  {t('ui.cancel')}
                </Button>
                <Button
                  variant="primary"
                  disabled={busy}
                  onClick={() => {
                    const rule = deleteRule;
                    setBusy(true);
                    setError('');
                    void persist({ ...rule, deleted: true }, rule)
                      .then(() => setDeleteRule(undefined))
                      .catch((error) => setError(errorMessage(error)))
                      .finally(() => setBusy(false));
                  }}
                >
                  {t('automation.delete')}
                </Button>
              </div>
            </Modal>
          )}
        </OverlayPresence>
      </RecordQueryContext.Provider>
    </MentionContext.Provider>
  );
}
