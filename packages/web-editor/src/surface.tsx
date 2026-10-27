import { editable } from '@tio/core';
import { Editor } from '@tio/editor-blocknote';
import { useT } from '@tio/i18n';
import {
  MentionContext,
  EditHistoryContext,
  Button,
  IconButton,
  ObjectIcon,
  EmptyNotice,
  cn,
  Menu,
  MenuItem,
  MenuSeparator,
  useNotify,
} from '@tio/ui';
import { RecordQueryContext } from '@tio/views';
import {
  MoreHorizontal,
  Trash2,
  Undo2,
  Redo2,
  Plus,
  Maximize2,
  FileText,
  Database,
  BookOpen,
} from 'lucide-react';
import { useRef, useState, useEffect, useCallback } from 'react';

import { useEditorController, type EditorSurfaceProps } from './controller';
import { DatabaseEmbed } from './database-embed';
import { EditorDialogs } from './dialogs';
import { useHistoryShortcuts } from './history';
import { LoadNotice } from './load-notice';
import { RecordContent } from './record-detail';
import { WebSlice } from './web-slice/view';

export function EditorSurface(props: EditorSurfaceProps) {
  const t = useT();
  const toast = useNotify();
  const m = useEditorController(props);
  const current = m.current;
  const historyRoot = useHistoryShortcuts(m.history);
  const records = useCallback(
    (query: import('@tio/core').RecordQuery) => m.runtime.records(query),
    [m.runtime],
  );
  const titleRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (props.autoFocusTitle) {
      titleRef.current?.focus();
      titleRef.current?.select();
    }
  }, [props.autoFocusTitle, props.target.id]);
  const prefKey = `tio.page-width.${props.workspaceId}.${props.target.id}`;
  const [widthPref, setWidthPref] = useState<Record<string, boolean>>({});
  let fullWidth = current?.type === 'database';
  if (current?.type !== 'database') {
    try {
      fullWidth = widthPref[prefKey] ?? localStorage.getItem(prefKey) === 'true';
    } catch {
      fullWidth = !!widthPref[prefKey];
    }
  }
  const actions = (
    <>
      {props.showSaveState && (
        <span className="text-xs text-muted" aria-live="polite">
          {t(
            m.state.status === 'error'
              ? 'status.saveFailed'
              : m.state.status === 'saving'
                ? 'status.saving'
                : 'status.saved',
          )}
        </span>
      )}
      {current && (
        <Menu
          trigger={
            <IconButton label={t('common.more')} className="p-1.5">
              <MoreHorizontal size={19} />
            </IconButton>
          }
        >
          {props.pageActions}
          {current.type === 'page' && (
            <>
              <MenuItem
                onSelect={() => {
                  const next = !fullWidth;
                  setWidthPref((p) => ({ ...p, [prefKey]: next }));
                  try {
                    localStorage.setItem(prefKey, String(next));
                  } catch {
                    /* optional preference */
                  }
                }}
              >
                <Maximize2 size={15} />
                {t(fullWidth ? 'ui.readingWidth' : 'ui.fullWidth')}
              </MenuItem>
              <MenuItem onSelect={() => m.setReadOnly(!m.readOnly)}>
                <BookOpen size={15} />
                {t(m.readOnly ? 'common.edit' : 'common.read')}
              </MenuItem>
            </>
          )}
          <MenuSeparator />
          <MenuItem disabled={!m.history.canUndo} onSelect={m.history.undo}>
            <Undo2 size={15} />
            {t('common.undo')}
          </MenuItem>
          <MenuItem disabled={!m.history.canRedo} onSelect={m.history.redo}>
            <Redo2 size={15} />
            {t('common.redo')}
          </MenuItem>
          <MenuItem
            danger
            disabled={!m.can(current)}
            onSelect={() => {
              m.patch(current, { deleted: true }, true);
              toast(t('ui.deleted'), {
                action: { label: t('common.undo'), onClick: () => m.undoOperation() },
              });
            }}
          >
            <Trash2 size={15} />
            {t('ui.delete')}
          </MenuItem>
        </Menu>
      )}
    </>
  );
  const empty =
    current?.type === 'page' &&
    (current.blocks ?? []).every(
      (b) =>
        b.type === 'paragraph' &&
        (!Array.isArray(b.content) ||
          b.content.every(
            (part) => typeof part === 'object' && part !== null && 'text' in part && !part.text,
          )),
    );
  return (
    <EditHistoryContext.Provider value={m.history}>
      <MentionContext.Provider value={m.mentions}>
        <RecordQueryContext.Provider value={records}>
          <div ref={historyRoot} className="relative min-w-0">
            {props.renderHeader ? (
              props.renderHeader(actions)
            ) : (
              <header className="sticky top-0 z-10 flex h-12 items-center justify-end gap-2 bg-panel/95 px-4">
                {actions}
              </header>
            )}
            {(m.error || m.state.status === 'error') && (
              <div
                role="alert"
                className="mx-4 flex items-center gap-3 rounded border border-red-300 p-3 text-sm"
              >
                <span className="flex-1">{m.error || t('ui.saveError')}</span>
                <Button
                  onClick={() =>
                    void m.runtime
                      .retry()
                      .then(() => m.setError(''))
                      .catch((e) => m.setError(String(e)))
                  }
                >
                  {t('common.retry')}
                </Button>
              </div>
            )}
            {!current && props.target.id ? (
              <LoadNotice runtime={m.runtime} id={props.target.id} />
            ) : current ? (
              <main
                className={cn(
                  'mx-auto min-w-0 px-5 pt-10 pb-24 md:px-12 md:pt-16',
                  fullWidth ? 'max-w-none' : 'max-w-[856px]',
                )}
              >
                {current.type !== 'record' && (
                  <>
                    {current.icon && (
                      <div className="mb-4 text-muted">
                        <ObjectIcon type={current.type} icon={current.icon} size={38} />
                      </div>
                    )}
                    <input
                      ref={titleRef}
                      key={`title-${current.id}`}
                      className="tio-page-title w-full !rounded-none !border-0 !bg-transparent !p-0 !text-3xl !leading-tight !font-semibold tracking-tight outline-none md:!text-[40px]"
                      aria-label={t('document.title')}
                      placeholder={t('common.untitled')}
                      value={current.title ?? current.name ?? ''}
                      readOnly={!m.can(current) || !editable(current)}
                      onChange={(e) =>
                        m.patch(
                          current,
                          current.type === 'database'
                            ? { name: e.target.value }
                            : { title: e.target.value },
                        )
                      }
                    />
                    <div className="h-7" />
                  </>
                )}
                {!editable(current) ? (
                  <EmptyNotice>{t('document.unsupported')}</EmptyNotice>
                ) : current.type === 'record' ? (
                  <RecordContent model={m} />
                ) : current.type === 'page' ? (
                  <>
                    <Editor
                      key={current.id}
                      onSubpage={() => m.addPage(current.id)}
                      onDatabase={() => m.setEmbedPicker(true)}
                      blocks={current.blocks ?? []}
                      readOnly={!m.can(current)}
                      onChange={(b, p, group) => m.changeBlocks(current, b, p, group)}
                      upload={m.upload}
                      resolve={m.resolve}
                      renderWebSlice={(block) => (
                        <WebSlice model={m} page={current} block={block} />
                      )}
                      renderDatabase={(databaseId, viewId) => (
                        <DatabaseEmbed model={m} databaseId={databaseId} viewId={viewId} />
                      )}
                    />
                    {empty && m.can(current) && (
                      <div className="mt-12 text-sm text-muted">
                        <p className="mb-3">{t('ui.start')}</p>
                        <div className="flex flex-wrap gap-2">
                          <Button
                            variant="outline"
                            onClick={() => {
                              const el = titleRef.current
                                ?.closest('main')
                                ?.querySelector<HTMLElement>('[contenteditable=true]');
                              el?.focus();
                            }}
                          >
                            <FileText size={15} />
                            {t('ui.text')}
                          </Button>
                          <Button variant="outline" onClick={() => m.addPage(current.id)}>
                            <Plus size={15} />
                            {t('page.child')}
                          </Button>
                          <Button variant="outline" onClick={() => m.setEmbedPicker(true)}>
                            <Database size={15} />
                            {t('ui.databases')}
                          </Button>
                        </div>
                      </div>
                    )}
                  </>
                ) : (
                  <DatabaseEmbed key={current.id} model={m} databaseId={current.id} fullPage />
                )}
              </main>
            ) : (
              <div className="p-12 text-center">
                <h2 className="mb-4 text-xl">{t('ui.noSelection')}</h2>
                <Button variant="primary" onClick={() => m.addPage()}>
                  {t('workspace.newPage')}
                </Button>
              </div>
            )}
            <EditorDialogs model={m} />
          </div>
        </RecordQueryContext.Provider>
      </MentionContext.Provider>
    </EditHistoryContext.Provider>
  );
}
