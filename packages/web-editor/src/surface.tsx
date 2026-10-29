import { editable, knownTypes, firstAppSlice, isAppMode } from '@tio/core';
import { ContentLinksContext } from '@tio/editor-blocknote';
import { Editor } from '@tio/editor-blocknote';
import { useTranslation, useT } from '@tio/i18n';
import { OverlayPresence } from '@tio/ui';
import {
  Modal,
  MentionContext,
  EditHistoryContext,
  Button,
  IconButton,
  EmptyNotice,
  EmptyStateIllustration,
  cn,
  Menu,
  MenuItem,
  MenuSeparator,
  useNotify,
  readingLayout,
} from '@tio/ui';
import { RecordQueryContext } from '@tio/views';
import {
  Info,
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

import { AppModeMenuItem } from './app-mode-menu';
import { AppSlice } from './app-slice/view';
import { ContentLocation } from './content-location';
import { useEditorController, type EditorSurfaceProps } from './controller';
import { DatabaseEmbed } from './database-embed';
import { EditorDialogs } from './dialogs';
import { DocumentCover } from './document-cover';
import { DocumentIcon, DocumentMediaActions } from './document-icon';
import { DocumentTitle } from './document-title';
import { useHistoryShortcuts } from './history';
import { LoadNotice } from './load-notice';
import { RecordContent } from './record-detail';
import { ReferenceFooter } from './references';
import { useTransferMenu } from './transfer/menu';

export function EditorSurface(props: EditorSurfaceProps) {
  const t = useT();
  const { i18n } = useTranslation();
  const [showInfo, setShowInfo] = useState(false);
  const toast = useNotify();
  const m = useEditorController(props);
  const current = m.current;
  const appMode = isAppMode(
    current ?? m.objects.find((o) => o.id === props.target.id && !o.deleted),
  );
  const appBlock = appMode ? firstAppSlice(current?.blocks ?? []) : undefined;
  const historyRoot = useHistoryShortcuts(m.history);
  const records = useCallback(
    (query: import('@tio/core').RecordQuery) => m.runtime.records(query),
    [m.runtime],
  );
  const transfer = useTransferMenu(m, props);
  const locationRoot = useRef<HTMLDivElement>(null);
  const titleRef = useRef<HTMLTextAreaElement>(null);
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
  const appModeAction =
    current?.type === 'page' ? (
      <AppModeMenuItem
        page={current}
        disabled={!m.can(current)}
        onToggle={() => m.patch(current, { appMode: !isAppMode(current) })}
      />
    ) : null;
  const actions = (
    <>
      {current && (
        <Menu
          trigger={
            <IconButton label={t('common.more')} className="p-1.5">
              <MoreHorizontal size={19} />
            </IconButton>
          }
        >
          {props.pageActions}
          {props.onOpenGraph && (
            <MenuItem onSelect={() => props.onOpenGraph!(props.target.id)}>
              {t('links.graph')}
            </MenuItem>
          )}
          {knownTypes.has(current.type) && (
            <MenuItem onSelect={() => setShowInfo(true)}>
              <Info size={15} />
              {t('ui.documentInfo')}
            </MenuItem>
          )}
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
              {appModeAction}
              <MenuItem onSelect={() => m.setReadOnly(!m.readOnly)}>
                <BookOpen size={15} />
                {t(m.readOnly ? 'common.edit' : 'common.read')}
              </MenuItem>
            </>
          )}
          {transfer.menu}
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
      <ContentLinksContext.Provider
        value={{
          parseContentLink: props.contentLinks?.parse,
          acceptsContentLink: props.contentLinks?.accepts,
          copyBlockLink:
            current && props.contentLinks
              ? async (blockId) =>
                  navigator.clipboard.writeText(
                    props.contentLinks!.create({
                      workspaceId: props.workspaceId,
                      id: current.id,
                      kind: current.type as 'page' | 'record',
                      anchor: { type: 'block', blockId },
                    }),
                  )
              : undefined,
        }}
      >
        <div ref={locationRoot}>
          <ContentLocation
            object={current}
            anchor={props.target.anchor}
            requestId={props.target.requestId}
            root={locationRoot}
          />
          <MentionContext.Provider value={m.mentions}>
            <RecordQueryContext.Provider value={records}>
              <div ref={historyRoot} className="relative min-w-0">
                {props.renderHeader ? (
                  props.renderHeader(actions, {
                    appMode,
                    navigationPageActions: appMode ? (
                      <>
                        {appModeAction}
                        {props.onOpenGraph && (
                          <MenuItem onSelect={() => props.onOpenGraph!(props.target.id)}>
                            {t('links.graph')}
                          </MenuItem>
                        )}
                      </>
                    ) : null,
                  })
                ) : appMode ? null : (
                  <header className="sticky top-0 z-10 flex h-12 items-center justify-end gap-2 bg-panel/95 px-4">
                    {actions}
                  </header>
                )}
                <OverlayPresence>
                  {showInfo && current && (
                    <Modal title={t('ui.documentInfo')} close={() => setShowInfo(false)}>
                      <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-3 text-sm">
                        {(['createdAt', 'updatedAt'] as const).map((field) => (
                          <div key={field} className="contents">
                            <dt className="text-muted">
                              {t(field === 'createdAt' ? 'ui.createdAt' : 'ui.updatedAt')}
                            </dt>
                            <dd className="m-0">
                              <time dateTime={current[field]}>
                                {current[field]
                                  ? new Intl.DateTimeFormat(i18n.language, {
                                      dateStyle: 'medium',
                                      timeStyle: 'long',
                                    }).format(new Date(current[field]!))
                                  : '—'}
                              </time>
                            </dd>
                          </div>
                        ))}
                      </dl>
                    </Modal>
                  )}
                </OverlayPresence>
                {transfer.picker}
                {m.error && (
                  <div role="alert" className="mx-4 rounded border border-red-300 p-3 text-sm">
                    {m.error}
                  </div>
                )}
                {!current && props.target.id ? (
                  <LoadNotice runtime={m.runtime} id={props.target.id} />
                ) : current && appMode ? (
                  <main
                    className={cn(
                      'w-full min-w-0',
                      props.target.mode === 'preview' ? 'h-[78dvh]' : 'h-dvh',
                    )}
                    data-app-mode
                  >
                    {appBlock ? (
                      <AppSlice
                        key={`${current.id}:${appBlock.id}`}
                        model={m}
                        page={current}
                        block={appBlock}
                        fullscreen
                      />
                    ) : (
                      <EmptyNotice>{t('ui.appModeEmpty')}</EmptyNotice>
                    )}
                  </main>
                ) : current ? (
                  <>
                    {(current.type === 'page' || current.type === 'database') && (
                      <DocumentCover
                        key={`${props.workspaceId}:${current.id}`}
                        object={current}
                        editable={m.can(current)}
                        patch={(changes) => m.patch(current, changes)}
                        upload={m.upload}
                        resolve={m.resolve}
                      />
                    )}
                    <main
                      className={cn(
                        readingLayout,
                        fullWidth && 'max-w-none',
                        current.cover && current.icon && 'pt-0 md:pt-0',
                      )}
                    >
                      {current.type !== 'record' && (
                        <div>
                          {(current.type === 'page' || current.type === 'database') && (
                            <DocumentIcon
                              key={`${props.workspaceId}:${current.id}`}
                              object={current}
                              editable={m.can(current)}
                              patch={(changes) => m.patch(current, changes)}
                              upload={m.upload}
                              resolve={m.resolve}
                            />
                          )}
                          <div className="tio-title-area relative">
                            {(current.type === 'page' || current.type === 'database') && (
                              <DocumentMediaActions
                                key={`${props.workspaceId}:${current.id}`}
                                object={current}
                                editable={m.can(current)}
                                patch={(changes) => m.patch(current, changes)}
                                upload={m.upload}
                                resolve={m.resolve}
                              />
                            )}
                            <DocumentTitle
                              ref={titleRef}
                              key={`title-${current.id}`}
                              className="tio-page-title block w-full resize-none overflow-hidden !rounded-none !border-0 !bg-transparent !p-0 !text-3xl !leading-tight !font-semibold tracking-tight [overflow-wrap:anywhere] outline-none md:!text-[40px]"
                              aria-label={t('document.title')}
                              placeholder={t('common.untitled')}
                              value={current.title ?? current.name ?? ''}
                              readOnly={!m.can(current) || !editable(current)}
                              onKeyDown={(event) => {
                                if (event.key === 'Enter' && !event.nativeEvent.isComposing) {
                                  event.preventDefault();
                                  event.currentTarget
                                    .closest('main')
                                    ?.querySelector<HTMLElement>('[contenteditable=true]')
                                    ?.focus();
                                }
                              }}
                              onChange={(e) =>
                                m.patch(
                                  current,
                                  current.type === 'database'
                                    ? { name: e.target.value.replace(/[\r\n]/g, '') }
                                    : { title: e.target.value.replace(/[\r\n]/g, '') },
                                )
                              }
                            />
                            <div className="h-7" />
                          </div>
                        </div>
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
                            renderAppSlice={(block) => (
                              <AppSlice model={m} page={current} block={block} />
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
                        <DatabaseEmbed
                          key={current.id}
                          model={m}
                          databaseId={current.id}
                          fullPage
                        />
                      )}
                      {current.type !== 'record' && (
                        <ReferenceFooter key={current.id} model={m} id={current.id} />
                      )}
                    </main>
                  </>
                ) : props.renderEmptyState ? (
                  props.renderEmptyState()
                ) : (
                  <div className="flex min-h-[60dvh] flex-col items-center justify-center gap-6 p-12 text-center">
                    <EmptyStateIllustration kind="pages" />
                    <Button variant="primary" onClick={() => m.addPage()}>
                      {t('workspace.newPage')}
                    </Button>
                  </div>
                )}
                <EditorDialogs model={m} />
              </div>
            </RecordQueryContext.Provider>
          </MentionContext.Provider>
        </div>
      </ContentLinksContext.Provider>
    </EditHistoryContext.Provider>
  );
}
