import type { Block, TioObject } from '@tio/core';
import { type TranslationKey, useT } from '@tio/i18n';
import { OverlayPresence } from '@tio/ui';
import { LoadingSkeleton } from '@tio/ui';
import { Button, Drawer, Modal } from '@tio/ui';
import { lazy, Suspense, useEffect, useState } from 'react';

import type { EditorController } from '../controller';
import { Frame } from './frame';
import type { AppSlicePermission } from './types';
import type { AppSliceLog } from './view';

const HtmlEditor = lazy(() => import('./code-editor').then((m) => ({ default: m.HtmlEditor })));
const input =
  'w-full rounded-md border border-line bg-panel px-3 py-2 text-sm outline-none focus:border-accent disabled:opacity-50';

const tabs = [
  { id: 'code', label: 'appSlice.code' },
  { id: 'settings', label: 'appSlice.settingsTab' },
  { id: 'logs', label: 'appSlice.logs' },
] as const;
type Tab = (typeof tabs)[number]['id'];
const dataPermissionLabels = {
  read: 'appSlice.readOnly',
  readWrite: 'appSlice.readWrite',
} satisfies Record<AppSlicePermission['data'], TranslationKey>;
const dataPermissions = Object.entries(dataPermissionLabels) as [
  AppSlicePermission['data'],
  TranslationKey,
][];

function Toggle({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: () => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-label={label}
      aria-checked={checked}
      onClick={onChange}
      className={`h-5 w-9 shrink-0 rounded-full p-0.5 transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:opacity-50 ${checked ? 'bg-accent' : 'bg-neutral-300 dark:bg-neutral-600'}`}
    >
      <span
        className={`block h-4 w-4 rounded-full bg-white shadow-sm transition-transform ${checked ? 'translate-x-4' : 'translate-x-0'}`}
      />
    </button>
  );
}

export default function AppSliceSettings({
  model: m,
  page,
  block,
  permission,
  setPermission,
  permissionKey,
  running,
  setRunning,
  restart,
  logs,
  log,
  clearLogs,
  close,
}: {
  model: EditorController;
  page: TioObject;
  block: Block;
  permission: AppSlicePermission;
  setPermission: (p: AppSlicePermission) => void;
  permissionKey: string;
  running: boolean;
  setRunning: (r: boolean) => void;
  restart: () => void;
  logs: AppSliceLog[];
  log: (s: string) => void;
  clearLogs: () => void;
  close: () => void;
}) {
  const t = useT();
  const [tab, setTab] = useState<Tab>('code');
  const [mode, setMode] = useState('edit');
  const [draft, setDraft] = useState(String(block.props.html));
  const [applied, setApplied] = useState(String(block.props.html));
  const [preview, setPreview] = useState('');
  const [previewRun, setPreviewRun] = useState(0);
  const [previewError, setPreviewError] = useState(false);
  const [confirm, setConfirm] = useState<'discard' | 'external' | null>(null);
  const [feedback, setFeedback] = useState<TranslationKey>();
  const [name, setName] = useState(String(block.props.title));
  const [height, setHeight] = useState(String(block.props.height));
  const canEdit = m.can(page) && !m.hostReadOnly;
  const dirty = draft !== applied;
  const oversized = draft.length > 512000;
  useEffect(() => {
    setApplied(String(block.props.html));
  }, [block.props.html]);
  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => {
      if (dirty) {
        e.preventDefault();
        e.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);
  const update = (props: Record<string, unknown>) => {
    const current = m.runtime.snapshot().find((o) => o.id === page.id);
    if (!current || !canEdit || !m.can(current)) return false;
    const replace = (blocks: Block[]): Block[] =>
      blocks.map((b) =>
        b.id === block.id
          ? { ...b, props: { ...b.props, ...props } }
          : { ...b, children: replace(b.children) },
      );
    try {
      m.runtime.patch(page.id, { blocks: replace(current.blocks ?? []) }, true);
      setFeedback('appSlice.saved');
      return true;
    } catch {
      setFeedback('appSlice.saveFailed');
      return false;
    }
  };
  const grant = (next: AppSlicePermission) => {
    try {
      m.appSlice.permissionStore!.set(permissionKey, next);
      setPermission(next);
      setFeedback('appSlice.saved');
    } catch {
      setFeedback('appSlice.permissionFailed');
    }
  };
  const changeTab = (next: Tab) => {
    setTab(next);
    setMode('edit');
    setPreview('');
    setFeedback(undefined);
  };
  const requestClose = () => (dirty ? setConfirm('discard') : close());
  return (
    <>
      <Drawer closeLabel={t('appSlice.close')} title={t('appSlice.settings')} close={requestClose}>
        <div className="flex h-[calc(100dvh-53px)] min-h-0 flex-col px-6 pb-5 text-sm">
          <div
            role="tablist"
            aria-label={t('appSlice.sections')}
            className="flex shrink-0 gap-5 border-b border-line"
          >
            {tabs.map(({ id, label }, i) => (
              <button
                key={id}
                role="tab"
                id={`app-slice-tab-${block.id}-${id}`}
                aria-controls={`app-slice-panel-${block.id}`}
                aria-selected={tab === id}
                tabIndex={tab === id ? 0 : -1}
                onKeyDown={(e) => {
                  if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
                    e.preventDefault();
                    const step = e.key === 'ArrowRight' ? 1 : -1;
                    const next = tabs[(i + step + tabs.length) % tabs.length].id;
                    changeTab(next);
                    document.getElementById(`app-slice-tab-${block.id}-${next}`)?.focus();
                  }
                }}
                onClick={() => changeTab(id)}
                className={`border-b-2 px-1 py-3 font-medium ${tab === id ? 'border-accent text-ink' : 'border-transparent text-muted'}`}
              >
                {t(label)}
                {id === 'logs' && logs.length > 0 ? ` (${logs.length})` : ''}
              </button>
            ))}
          </div>
          {!canEdit && <p className="pt-3 text-xs text-muted">{t('appSlice.viewOnly')}</p>}
          <div
            role="tabpanel"
            id={`app-slice-panel-${block.id}`}
            aria-labelledby={`app-slice-tab-${block.id}-${tab}`}
            className="min-h-0 flex-1 overflow-auto py-4"
          >
            {tab === 'code' && (
              <div className="space-y-3">
                <div className="flex items-center justify-between gap-3">
                  <div className="inline-flex rounded-lg bg-surface p-1">
                    <Button
                      className={mode === 'edit' ? 'bg-panel text-ink shadow-sm' : ''}
                      aria-pressed={mode === 'edit'}
                      onClick={() => {
                        setMode('edit');
                        setPreview('');
                      }}
                    >
                      {t('appSlice.code')}
                    </Button>
                    <Button
                      className={mode === 'preview' ? 'bg-panel text-ink shadow-sm' : ''}
                      aria-pressed={mode === 'preview'}
                      onClick={() => {
                        setPreview(draft);
                        setPreviewError(false);
                        setPreviewRun((v) => v + 1);
                        setMode('preview');
                      }}
                    >
                      {t('appSlice.preview')}
                    </Button>
                  </div>
                  {mode === 'preview' && (
                    <span className="text-xs text-muted">{t('appSlice.readOnlyPreview')}</span>
                  )}
                </div>
                <div hidden={mode !== 'edit'}>
                  <Suspense fallback={<LoadingSkeleton layout="inline" />}>
                    <HtmlEditor value={draft} onChange={setDraft} readOnly={!canEdit} />
                  </Suspense>
                </div>
                {mode === 'preview' && (
                  <div className="overflow-hidden rounded-lg border border-line">
                    <Frame
                      model={m}
                      page={page}
                      block={block}
                      html={preview}
                      permission={{ ...permission, data: 'read' }}
                      preview
                      height={360}
                      onHeight={() => {}}
                      generation={previewRun}
                      log={(message) => {
                        log(message);
                        setPreviewError(true);
                      }}
                    />
                  </div>
                )}
                {previewError && mode === 'preview' && (
                  <p className="text-xs text-muted">{t('appSlice.previewMessages')}</p>
                )}
                {oversized && (
                  <p role="alert" className="text-sm text-red-600">
                    {t('appSlice.sourceLimit')}
                  </p>
                )}
              </div>
            )}
            {tab === 'settings' && (
              <div className="mx-auto max-w-2xl space-y-7">
                <fieldset disabled={!canEdit} className="space-y-4">
                  <legend className="mb-3 font-medium">{t('appSlice.display')}</legend>
                  <label className="block space-y-2">
                    <span>{t('appSlice.name')}</span>
                    <input
                      className={input}
                      value={name}
                      maxLength={200}
                      onChange={(e) => setName(e.target.value)}
                      onBlur={() => {
                        if (name !== block.props.title && !update({ title: name }))
                          setName(String(block.props.title));
                      }}
                    />
                  </label>
                  <div className="flex items-center justify-between">
                    <span>{t('appSlice.autoHeight')}</span>
                    <Toggle
                      label={t('appSlice.autoHeight')}
                      checked={!!block.props.autoHeight}
                      onChange={() => update({ autoHeight: !block.props.autoHeight })}
                    />
                  </div>
                  {!block.props.autoHeight && (
                    <label className="block space-y-2">
                      <span>{t('appSlice.height')}</span>
                      <input
                        className={input}
                        type="number"
                        min={160}
                        max={1200}
                        value={height}
                        onChange={(e) => setHeight(e.target.value)}
                        onBlur={() => {
                          const n = Number(height);
                          if (!Number.isInteger(n) || n < 160 || n > 1200) {
                            setFeedback('appSlice.heightInvalid');
                            setHeight(String(block.props.height));
                          } else if (n !== block.props.height) update({ height: n });
                        }}
                      />
                    </label>
                  )}
                </fieldset>
                <fieldset disabled={!canEdit} className="space-y-4">
                  <legend className="mb-3 font-medium">{t('appSlice.permissions')}</legend>
                  <fieldset className="space-y-2">
                    <legend className="mb-2">{t('appSlice.dataPermission')}</legend>
                    <div className="flex gap-5">
                      {dataPermissions.map(([value, label]) => (
                        <label key={value} className="flex items-center gap-2">
                          <input
                            type="radio"
                            name={`permission-${block.id}`}
                            checked={permission.data === value}
                            onChange={() => grant({ ...permission, data: value })}
                          />
                          {t(label)}
                        </label>
                      ))}
                    </div>
                  </fieldset>
                  <div>
                    <div className="flex items-center justify-between">
                      <span>{t('appSlice.external')}</span>
                      <Toggle
                        label={t('appSlice.external')}
                        checked={permission.allowExternalResources}
                        onChange={() =>
                          permission.allowExternalResources
                            ? grant({ ...permission, allowExternalResources: false })
                            : setConfirm('external')
                        }
                      />
                    </div>
                    <p className="mt-2 text-xs text-muted">{t('appSlice.externalHelp')}</p>
                  </div>
                </fieldset>
                <div className="space-y-3 border-t border-line pt-5">
                  <div className="flex items-center justify-between">
                    <h3 className="font-medium">{t('appSlice.runtime')}</h3>
                    <span className="text-xs text-muted">
                      {running ? t('appSlice.running') : t('appSlice.stopped')}
                    </span>
                  </div>
                  <div className="flex gap-2">
                    <Button variant="outline" onClick={() => setRunning(!running)}>
                      {running ? t('appSlice.stop') : t('appSlice.run')}
                    </Button>
                    <Button variant="outline" onClick={restart}>
                      {t('appSlice.restart')}
                    </Button>
                  </div>
                </div>
              </div>
            )}
            {tab === 'logs' && (
              <div className="space-y-3">
                <div className="flex justify-end">
                  <Button disabled={!logs.length} onClick={clearLogs}>
                    {t('appSlice.clear')}
                  </Button>
                </div>
                {logs.length ? (
                  <ol className="divide-y divide-line rounded-lg border border-line">
                    {logs.map((entry, i) => (
                      <li key={i} className="p-3">
                        <span className="text-xs text-muted">
                          {entry.source === 'live' ? t('appSlice.live') : t('appSlice.preview')}
                        </span>
                        <pre className="mt-1 font-mono text-xs break-all whitespace-pre-wrap">
                          {entry.message}
                        </pre>
                      </li>
                    ))}
                  </ol>
                ) : (
                  <div className="py-20 text-center text-muted">{t('appSlice.noLogs')}</div>
                )}
              </div>
            )}
          </div>
          <div className="flex shrink-0 items-center justify-between gap-3 border-t border-line pt-4">
            <output className="text-xs text-muted">
              {feedback ? t(feedback) : dirty ? t('appSlice.unapplied') : t('appSlice.applied')}
            </output>
            <Button
              variant="primary"
              disabled={!canEdit || !dirty || oversized}
              onClick={() => {
                if (update({ html: draft })) {
                  setApplied(draft);
                  restart();
                }
              }}
            >
              {t('appSlice.apply')}
            </Button>
          </div>
        </div>
      </Drawer>
      <OverlayPresence>
        {confirm && (
          <Modal
            title={confirm === 'discard' ? t('appSlice.discardTitle') : t('appSlice.externalTitle')}
            close={() => setConfirm(null)}
          >
            <p className="mb-5 text-sm text-secondary">
              {confirm === 'discard' ? t('appSlice.discardHelp') : t('appSlice.externalWarning')}
            </p>
            <div className="flex justify-end gap-2">
              <Button onClick={() => setConfirm(null)}>
                {confirm === 'discard' ? t('appSlice.continueEditing') : t('appSlice.cancel')}
              </Button>
              <Button
                variant="primary"
                onClick={() => {
                  if (confirm === 'discard') close();
                  else grant({ ...permission, allowExternalResources: true });
                  setConfirm(null);
                }}
              >
                {confirm === 'discard' ? t('appSlice.discard') : t('appSlice.allow')}
              </Button>
            </div>
          </Modal>
        )}
      </OverlayPresence>
    </>
  );
}
