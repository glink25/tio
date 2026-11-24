import { lazy, Suspense, useState, useEffect, useCallback } from 'react';
const AssistantHost = lazy(() => import('../features/assistant/host'));
const RelationshipGraph = lazy(() => import('../features/relations/graph'));
import { titleOf, type TioObject } from '@tio/core';
import { t } from '@tio/i18n';
import { OverlayPresence } from '@tio/ui';
import { SelectInput } from '@tio/ui';
import { Button, IconButton, MenuItem, Modal, LoadingSkeleton, cn, useMobile } from '@tio/ui';
import { EditorSurface } from '@tio/web-editor';
import { PanelLeft, Star, Move, Maximize2 } from 'lucide-react';
import { useLayoutEffect, useRef, type ReactNode } from 'react';

import { DesktopDragRegion, useDesktopChrome } from '../components/desktop-chrome';
import { SyncStatus } from '../components/sync-status';
import {
  assistantScope,
  selectionReference,
  type AssistantReference,
  type SelectionQuote,
} from '../features/assistant/references';
import { Breadcrumbs } from '../features/workspace/breadcrumbs';
import { Sidebar, WorkspaceSwitcher } from '../features/workspace/sidebar';
import { statusLabel } from '../features/workspace/status';
import type { WorkspaceController } from '../features/workspace/use-workspace';
import { platform } from '../platform';
import { appSlice } from '../services/app-slice-permissions';
import { setPresentation, usePresentation } from '../services/browser-presentation';

export function WorkspacePage({ model: m }: { model: WorkspaceController }) {
  const [references, setReferences] = useState<AssistantReference[]>([]);
  const consumeReferences = useCallback(() => setReferences([]), []);
  const openAssistant = () => {
    setAssistantLoaded(true);
    setAssistantOpen(true);
  };
  const toggleAssistant = () => {
    setAssistantLoaded(true);
    setAssistantOpen((open) => !open);
  };
  const closeAssistant = () => setAssistantOpen(false);
  const quoteSelection = (selection: SelectionQuote) => {
    if (!m.connection || selection.workspaceId !== m.session?.workspaceId) return;
    const object = m.objects.find((o) => o.id === selection.objectId);
    const database = object?.databaseId
      ? m.objects.find((o) => o.id === object.databaseId)
      : undefined;
    const titleField = database?.fields?.find((f) => f.type === 'title');
    const recordTitle = titleField ? object?.properties?.[titleField.id] : undefined;
    const title =
      object?.type === 'record' && typeof recordTitle === 'string'
        ? recordTitle
        : object
          ? titleOf(object)
          : '';
    const scope = assistantScope(m.connection.id, selection.workspaceId);
    setReferences((refs) => [...refs, selectionReference(scope, selection, title)]);
    if (m.previewId) m.setPreviewId(null);
    openAssistant();
  };
  const [assistantOpen, setAssistantOpen] = useState(false);
  const [assistantLoaded, setAssistantLoaded] = useState(false);
  useEffect(() => {
    if (m.openingWorkspace) {
      setReferences([]);
      setAssistantLoaded(false);
      setAssistantOpen(false);
    }
  }, [m.openingWorkspace]);
  const layoutRef = useRef<HTMLDivElement>(null);
  const previousSidebarCollapsed = useRef(m.sidebarCollapsed);
  useLayoutEffect(() => {
    if (previousSidebarCollapsed.current === m.sidebarCollapsed) return;
    previousSidebarCollapsed.current = m.sidebarCollapsed;
    const element = layoutRef.current;
    if (!element) return;
    element.dataset.sidebarAnimating = '';
    const timeout = setTimeout(() => delete element.dataset.sidebarAnimating, 200);
    return () => clearTimeout(timeout);
  }, [m.sidebarCollapsed]);
  const presentation = usePresentation();
  const mobile = useMobile();
  const { sidebar, setSidebar, setMenu } = m;
  useEffect(() => {
    if (mobile || !sidebar) return;
    setSidebar(false);
    setMenu(false);
  }, [mobile, sidebar, setSidebar, setMenu]);
  const current = m.current;
  const toggleSidebar = () => {
    if (mobile) m.setSidebar(!m.sidebar);
    else m.collapseSidebar();
  };
  const workspaceName = m.workspace?.name ?? m.session?.name;
  const title = current ? titleOf(current) : workspaceName;
  const chrome = useDesktopChrome(
    title ? `${title} · Tio` : 'Tio',
    m.graph ? undefined : { label: t('workspace.sidebar'), toggle: toggleSidebar },
  );
  const desktop = !!platform().desktopChrome;
  const overlay = chrome.layout === 'overlay';
  const ancestors: TioObject[] = [];
  const visited = new Set<string>();
  let parent = m.nav.find(
    (o) => o.id === (current?.type === 'record' ? current.databaseId : current?.parentId),
  );
  while (parent && !visited.has(parent.id)) {
    ancestors.unshift(parent);
    visited.add(parent.id);
    parent = m.nav.find((o) => o.id === parent?.parentId);
  }
  const header = (actions: ReactNode, layout: { appMode: boolean }) =>
    layout.appMode && !desktop ? (
      chrome.layout !== 'headerbar' &&
      (mobile ? !m.sidebar : m.sidebarCollapsed) && (
        <div className="fixed top-[max(12px,var(--tio-safe-top))] left-[max(12px,var(--tio-safe-left))] z-20 rounded-lg border border-line bg-panel/95 shadow-sm">
          <IconButton
            label={t('workspace.sidebar')}
            className="p-2"
            onClick={() => {
              if (mobile) m.setSidebar(true);
              else m.collapseSidebar();
            }}
          >
            <PanelLeft size={18} />
          </IconButton>
        </div>
      )
    ) : (
      <header className="tio-workspace-header sticky top-0 z-10 flex items-center justify-between gap-2 bg-panel/95 px-3 md:px-5">
        <div className="flex min-w-0 shrink items-center gap-1 text-sm text-muted">
          {chrome.layout !== 'headerbar' && (
            <IconButton
              label={t('workspace.sidebar')}
              className={cn('p-1.5', !overlay && !m.sidebarCollapsed && 'md:hidden')}
              onClick={toggleSidebar}
            >
              <PanelLeft size={18} />
            </IconButton>
          )}
          {(overlay || mobile || m.sidebarCollapsed) && !m.sidebar && (
            <WorkspaceSwitcher model={m} compact />
          )}
          {overlay && !layout.appMode && !m.sidebar && (
            <span aria-hidden="true" className="mx-1 h-4 w-px shrink-0 bg-line" />
          )}
          {!layout.appMode && (
            <Breadcrumbs ancestors={ancestors} current={current} navigate={m.navigate} />
          )}
        </div>
        {overlay && <DesktopDragRegion className="tio-desktop-drag" />}
        {!layout.appMode && (
          <div className="flex shrink-0 items-center gap-1">
            <SyncStatus model={m} />
            {current && (
              <IconButton
                label={t('workspace.favorite')}
                className="p-1.5"
                onClick={() => m.favorite(current)}
              >
                <Star
                  size={17}
                  className={m.session?.favorites?.includes(current.id) ? 'fill-ink text-ink' : ''}
                />
              </IconButton>
            )}
            {actions}
          </div>
        )}
      </header>
    );
  const preview = m.objects.find((o) => o.id === m.previewId && !o.deleted);
  const assistant = assistantLoaded && m.runtime && m.connection && !m.openingWorkspace && (
    <Suspense fallback={assistantOpen ? <LoadingSkeleton layout="inline" /> : null}>
      <AssistantHost
        model={m}
        mobile={mobile}
        open={assistantOpen}
        close={closeAssistant}
        references={references}
        onReferencesConsumed={consumeReferences}
      />
    </Suspense>
  );
  return (
    <div
      className="tio-workspace"
      data-assistant-open={assistantOpen && !mobile}
      data-desktop-chrome={chrome.layout}
      data-compact-chrome={chrome.compact || undefined}
      style={chrome.style}
    >
      <aside
        inert={(!mobile && !assistantOpen) || undefined}
        aria-hidden={(!mobile && !assistantOpen) || undefined}
        role={mobile ? 'presentation' : undefined}
        style={mobile ? undefined : { paddingTop: 'var(--tio-safe-top)' }}
        className={
          mobile
            ? 'contents'
            : 'tio-assistant-panel fixed inset-y-0 right-0 z-40 flex flex-col overflow-hidden border-l border-line bg-panel'
        }
      >
        {assistant}
      </aside>
      {m.graph && m.runtime && (
        <Suspense fallback={<output>{t('links.updating')}</output>}>
          <RelationshipGraph
            model={m}
            onToggleAssistant={toggleAssistant}
            assistantOpen={assistantOpen}
            desktopOverlay={overlay}
          />
        </Suspense>
      )}
      <div
        hidden={m.graph}
        ref={layoutRef}
        className="tio-workspace-content min-w-0 md:ml-[var(--sidebar-width)]"
        data-sidebar-collapsed={m.sidebarCollapsed}
        style={
          {
            '--sidebar-width': `${m.sidebarCollapsed ? 0 : m.sidebarWidth}px`,
          } as React.CSSProperties
        }
      >
        {m.runtime ? (
          <EditorSurface
            documentScrollRef={desktop ? m.documentScroll : undefined}
            onAskAssistant={quoteSelection}
            contentLinks={m.contentLinks}
            onOpenGraph={(id) => void m.openGraph(id)}
            mentions={m.mentions}
            appSlice={appSlice}
            presentation={presentation}
            readingMode={presentation.readingMode}
            onReadingModeChange={(readingMode) => setPresentation({ readingMode })}
            runtime={m.runtime}
            workspaceId={m.session!.workspaceId}
            target={{
              id: current
                ? m.selected || current.id
                : m.contentReady && m.navigationReady
                  ? m.selected
                  : '',
              ...m.locationTarget,
            }}
            renderEmptyState={
              m.contentReady && m.navigationReady
                ? undefined
                : () =>
                    m.queryIndexError || m.status.visual === 'attention' ? (
                      <div
                        role="alert"
                        className="flex min-h-[60dvh] flex-col items-center justify-center gap-4 p-12 text-center text-sm"
                      >
                        <p>{m.queryIndexError ?? statusLabel(m.status)}</p>
                        <Button variant="outline" onClick={() => void m.retryInitialization()}>
                          {t(m.manualSync ? 'sync.now' : 'common.retry')}
                        </Button>
                      </div>
                    ) : (
                      <div aria-label={t('workspace.initializing')} aria-busy="true">
                        <LoadingSkeleton />
                      </div>
                    )
            }
            renderHeader={(actions, layout) => (
              <>
                <Sidebar
                  model={m}
                  mobile={mobile}
                  pageActions={layout.navigationPageActions}
                  onToggleAssistant={toggleAssistant}
                  assistantOpen={assistantOpen}
                  chrome={chrome.layout}
                />
                {header(actions, layout)}
              </>
            )}
            pageActions={
              current && (
                <MenuItem onSelect={() => m.setMoveTarget(current.id)}>
                  <Move size={15} />
                  {t('ui.move')}
                </MenuItem>
              )
            }
            onOpen={({ id, mode }) => {
              const o = m.objects.find((o) => o.id === id);
              if (mode === 'preview') m.setPreviewId(id);
              else if (o) m.navigate(o);
            }}
            onNavigate={(target) => void m.navigateTarget(target)}
          />
        ) : (
          <>
            <Sidebar
              model={m}
              mobile={mobile}
              onToggleAssistant={toggleAssistant}
              assistantOpen={assistantOpen}
              chrome={chrome.layout}
            />
            {header(null, { appMode: false })}
          </>
        )}
      </div>
      <OverlayPresence>
        {preview && m.runtime && (
          <Modal
            wide
            title={t('ui.preview')}
            close={() => m.setPreviewId(null)}
            header={
              <div className="flex min-w-0 flex-1 items-center gap-2 text-sm">
                <IconButton
                  label={t('ui.expand')}
                  onClick={() => m.navigate(preview)}
                  className="p-1.5"
                >
                  <Maximize2 size={17} />
                </IconButton>
                <span className="shrink-0 text-muted">{t('ui.addTo')}</span>
                <SelectInput
                  aria-label={t('ui.location')}
                  className="w-0 max-w-64 min-w-0 flex-1 truncate !border-0 !bg-transparent"
                  value={preview.parentId ?? ''}
                  onValueChange={(value) => m.movePage(preview.id, value || null)}
                >
                  <option value="">{m.workspace?.name}</option>
                  {m.nav
                    .filter((o) => o.type === 'page' && o.id !== preview.id)
                    .map((o) => (
                      <option key={o.id} value={o.id}>
                        {titleOf(o)}
                      </option>
                    ))}
                </SelectInput>
              </div>
            }
          >
            <div className="page-preview md:min-h-[78dvh]">
              <EditorSurface
                onAskAssistant={quoteSelection}
                contentLinks={m.contentLinks}
                onOpenGraph={(id) => void m.openGraph(id)}
                mentions={m.mentions}
                appSlice={appSlice}
                presentation={presentation}
                readingMode={presentation.readingMode}
                onReadingModeChange={(readingMode) => setPresentation({ readingMode })}
                runtime={m.runtime}
                workspaceId={m.session!.workspaceId}
                target={{ id: preview.id, mode: 'preview' }}
                autoFocusTitle
                renderHeader={(actions, layout) =>
                  layout.appMode ? null : (
                    <div className="flex justify-end px-4 pt-2">{actions}</div>
                  )
                }
                onOpen={({ id }) => m.setPreviewId(id)}
                onNavigate={(target) => void m.navigateTarget(target)}
              />
            </div>
          </Modal>
        )}
      </OverlayPresence>
    </div>
  );
}
