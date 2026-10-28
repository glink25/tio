import type { Block, TioObject } from '@tio/core';
import { useTranslation } from '@tio/i18n';
import { Button, Drawer, Modal } from '@tio/ui';
import { lazy, Suspense, useEffect, useState } from 'react';

import type { EditorController } from '../controller';
import { Frame } from './frame';
import type { AppSlicePermission } from './types';
import type { AppSliceLog } from './view';

const HtmlEditor = lazy(() => import('./code-editor').then((m) => ({ default: m.HtmlEditor })));
const input =
  'w-full rounded-md border border-line bg-panel px-3 py-2 text-sm outline-none focus:border-accent disabled:opacity-50';

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
  const { i18n } = useTranslation();
  const tr = (zh: string, en: string) => (i18n.language === 'zh' ? zh : en);
  const [tab, setTab] = useState('code');
  const [mode, setMode] = useState('edit');
  const [draft, setDraft] = useState(String(block.props.html));
  const [applied, setApplied] = useState(String(block.props.html));
  const [preview, setPreview] = useState('');
  const [previewRun, setPreviewRun] = useState(0);
  const [previewError, setPreviewError] = useState(false);
  const [confirm, setConfirm] = useState<'discard' | 'external' | null>(null);
  const [feedback, setFeedback] = useState('');
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
      setFeedback(tr('已保存', 'Saved'));
      return true;
    } catch {
      setFeedback(tr('保存失败，请重试', 'Could not save. Try again.'));
      return false;
    }
  };
  const grant = (next: AppSlicePermission) => {
    try {
      m.appSlice.permissionStore!.set(permissionKey, next);
      setPermission(next);
      setFeedback(tr('已保存', 'Saved'));
    } catch {
      setFeedback(tr('权限保存失败，请重试', 'Could not save permission. Try again.'));
    }
  };
  const changeTab = (next: string) => {
    setTab(next);
    setMode('edit');
    setPreview('');
    setFeedback('');
  };
  const requestClose = () => (dirty ? setConfirm('discard') : close());
  return (
    <>
      <Drawer
        closeLabel={tr('关闭', 'Close')}
        title={tr('App Slice 设置', 'App Slice settings')}
        close={requestClose}
      >
        <div className="flex h-[calc(100dvh-53px)] min-h-0 flex-col px-6 pb-5 text-sm">
          <div
            role="tablist"
            aria-label={tr('设置页面', 'Settings sections')}
            className="flex shrink-0 gap-5 border-b border-line"
          >
            {['code', 'settings', 'logs'].map((id, i) => (
              <button
                key={id}
                role="tab"
                id={`app-slice-tab-${block.id}-${id}`}
                aria-controls={`app-slice-panel-${block.id}`}
                aria-selected={tab === id}
                tabIndex={tab === id ? 0 : -1}
                onKeyDown={(e) => {
                  const ids = ['code', 'settings', 'logs'];
                  if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
                    e.preventDefault();
                    const next = ids[(i + (e.key === 'ArrowRight' ? 1 : 2)) % 3]!;
                    changeTab(next);
                    document.getElementById(`app-slice-tab-${block.id}-${next}`)?.focus();
                  }
                }}
                onClick={() => changeTab(id)}
                className={`border-b-2 px-1 py-3 font-medium ${tab === id ? 'border-accent text-ink' : 'border-transparent text-muted'}`}
              >
                {[tr('代码', 'Code'), tr('设置', 'Settings'), tr('日志', 'Logs')][i]}
                {id === 'logs' && logs.length > 0 ? ` (${logs.length})` : ''}
              </button>
            ))}
          </div>
          {!canEdit && (
            <p className="pt-3 text-xs text-muted">
              {tr(
                '当前无编辑权限，可以查看代码、设置和日志。',
                'View only. Editing and permissions are unavailable.',
              )}
            </p>
          )}
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
                      {tr('代码', 'Code')}
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
                      {tr('预览', 'Preview')}
                    </Button>
                  </div>
                  {mode === 'preview' && (
                    <span className="text-xs text-muted">
                      {tr('只读预览', 'Read-only preview')}
                    </span>
                  )}
                </div>
                <div hidden={mode !== 'edit'}>
                  <Suspense
                    fallback={
                      <p className="p-4 text-muted">{tr('正在加载编辑器…', 'Loading editor…')}</p>
                    }
                  >
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
                  <p className="text-xs text-muted">
                    {tr(
                      '预览产生了运行信息，请在日志中查看详情。',
                      'Preview produced runtime messages. See Logs for details.',
                    )}
                  </p>
                )}
                {oversized && (
                  <p role="alert" className="text-sm text-red-600">
                    {tr(
                      '源码不能超过 512,000 个字符。',
                      'Source must not exceed 512,000 characters.',
                    )}
                  </p>
                )}
              </div>
            )}
            {tab === 'settings' && (
              <div className="mx-auto max-w-2xl space-y-7">
                <fieldset disabled={!canEdit} className="space-y-4">
                  <legend className="mb-3 font-medium">{tr('展示', 'Display')}</legend>
                  <label className="block space-y-2">
                    <span>{tr('名称', 'Name')}</span>
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
                    <span>{tr('自动高度', 'Auto height')}</span>
                    <Toggle
                      label={tr('自动高度', 'Auto height')}
                      checked={!!block.props.autoHeight}
                      onChange={() => update({ autoHeight: !block.props.autoHeight })}
                    />
                  </div>
                  {!block.props.autoHeight && (
                    <label className="block space-y-2">
                      <span>{tr('高度（px）', 'Height (px)')}</span>
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
                            setFeedback(
                              tr(
                                '高度须为 160–1200 的整数',
                                'Height must be an integer from 160 to 1200',
                              ),
                            );
                            setHeight(String(block.props.height));
                          } else if (n !== block.props.height) update({ height: n });
                        }}
                      />
                    </label>
                  )}
                </fieldset>
                <fieldset disabled={!canEdit} className="space-y-4">
                  <legend className="mb-3 font-medium">{tr('权限', 'Permissions')}</legend>
                  <fieldset className="space-y-2">
                    <legend className="mb-2">{tr('数据权限', 'Data permission')}</legend>
                    <div className="flex gap-5">
                      {(['read', 'readWrite'] as const).map((value, i) => (
                        <label key={value} className="flex items-center gap-2">
                          <input
                            type="radio"
                            name={`permission-${block.id}`}
                            checked={permission.data === value}
                            onChange={() => grant({ ...permission, data: value })}
                          />
                          {i === 0 ? tr('只读', 'Read only') : tr('读写', 'Read & write')}
                        </label>
                      ))}
                    </div>
                  </fieldset>
                  <div>
                    <div className="flex items-center justify-between">
                      <span>{tr('外部资源与网络', 'External resources & network')}</span>
                      <Toggle
                        label={tr('外部资源与网络', 'External resources & network')}
                        checked={permission.allowExternalResources}
                        onChange={() =>
                          permission.allowExternalResources
                            ? grant({ ...permission, allowExternalResources: false })
                            : setConfirm('external')
                        }
                      />
                    </div>
                    <p className="mt-2 text-xs text-muted">
                      {tr(
                        '允许加载外部资源，并向外部服务发送请求。',
                        'Allow external resources and requests to external services.',
                      )}
                    </p>
                  </div>
                </fieldset>
                <div className="space-y-3 border-t border-line pt-5">
                  <div className="flex items-center justify-between">
                    <h3 className="font-medium">{tr('运行', 'Runtime')}</h3>
                    <span className="text-xs text-muted">
                      {running ? tr('运行中', 'Running') : tr('已停止', 'Stopped')}
                    </span>
                  </div>
                  <div className="flex gap-2">
                    <Button variant="outline" onClick={() => setRunning(!running)}>
                      {running ? tr('停止', 'Stop') : tr('运行', 'Run')}
                    </Button>
                    <Button variant="outline" onClick={restart}>
                      {tr('重新运行', 'Restart')}
                    </Button>
                  </div>
                </div>
              </div>
            )}
            {tab === 'logs' && (
              <div className="space-y-3">
                <div className="flex justify-end">
                  <Button disabled={!logs.length} onClick={clearLogs}>
                    {tr('清空', 'Clear')}
                  </Button>
                </div>
                {logs.length ? (
                  <ol className="divide-y divide-line rounded-lg border border-line">
                    {logs.map((entry, i) => (
                      <li key={i} className="p-3">
                        <span className="text-xs text-muted">
                          {entry.source === 'live' ? tr('正式运行', 'Live') : tr('预览', 'Preview')}
                        </span>
                        <pre className="mt-1 font-mono text-xs break-all whitespace-pre-wrap">
                          {entry.message}
                        </pre>
                      </li>
                    ))}
                  </ol>
                ) : (
                  <div className="py-20 text-center text-muted">
                    {tr('暂无运行日志', 'No runtime logs')}
                  </div>
                )}
              </div>
            )}
          </div>
          <div className="flex shrink-0 items-center justify-between gap-3 border-t border-line pt-4">
            <output className="text-xs text-muted">
              {feedback ||
                (dirty
                  ? tr('有未应用的修改', 'Unapplied changes')
                  : tr('所有更改已应用', 'All changes applied'))}
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
              {tr('应用更改', 'Apply changes')}
            </Button>
          </div>
        </div>
      </Drawer>
      {confirm && (
        <Modal
          title={
            confirm === 'discard'
              ? tr('丢弃未应用的修改？', 'Discard unapplied changes?')
              : tr('允许外部访问？', 'Allow external access?')
          }
          close={() => setConfirm(null)}
        >
          <p className="mb-5 text-sm text-secondary">
            {confirm === 'discard'
              ? tr('关闭后，未应用的代码修改将丢失。', 'Unapplied code changes will be lost.')
              : tr(
                  '网页可能向外部服务发送页面及表格数据。',
                  'This code may send page and database data to external services.',
                )}
          </p>
          <div className="flex justify-end gap-2">
            <Button onClick={() => setConfirm(null)}>
              {confirm === 'discard' ? tr('继续编辑', 'Continue editing') : tr('取消', 'Cancel')}
            </Button>
            <Button
              variant="primary"
              onClick={() => {
                if (confirm === 'discard') close();
                else grant({ ...permission, allowExternalResources: true });
                setConfirm(null);
              }}
            >
              {confirm === 'discard' ? tr('丢弃修改', 'Discard changes') : tr('允许', 'Allow')}
            </Button>
          </div>
        </Modal>
      )}
    </>
  );
}
