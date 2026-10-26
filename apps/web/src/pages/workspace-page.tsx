import { titleOf, type TioObject } from '@tio/core';
import { t, translateStatus } from '@tio/i18n';
import { Button, IconButton, MenuItem, Modal, cn, useMobile } from '@tio/ui';
import { EditorSurface, type WebSlicePermissionStore } from '@tio/web-editor';
import { ChevronRight, PanelLeft, Star, Move, Maximize2 } from 'lucide-react';
import { Fragment, type ReactNode } from 'react';

import { Sidebar, WorkspaceSwitcher } from '../features/workspace/sidebar';
import type { WorkspaceController } from '../features/workspace/use-workspace';
import { usePresentation } from '../services/browser-presentation';

const slicePermissions: WebSlicePermissionStore = {
  subscribe(key, listener) {
    const local = (event: Event) => {
      if ((event as CustomEvent).detail === key) listener();
    };
    const remote = (event: StorageEvent) => {
      if (event.key === 'tio.slice.' + key || event.key === null) listener();
    };
    window.addEventListener('tio-slice-permission', local);
    window.addEventListener('storage', remote);
    return () => {
      window.removeEventListener('tio-slice-permission', local);
      window.removeEventListener('storage', remote);
    };
  },
  get(key) {
    try {
      const value = JSON.parse(localStorage.getItem('tio.slice.' + key) ?? 'null');
      if (
        value &&
        ['read', 'readWrite'].includes(value.data) &&
        typeof value.allowExternalResources === 'boolean'
      )
        return value;
    } catch {
      /* Missing or damaged preferences use read-only defaults. */
    }
    return undefined;
  },
  set(key, value) {
    localStorage.setItem('tio.slice.' + key, JSON.stringify(value));
    window.dispatchEvent(new CustomEvent('tio-slice-permission', { detail: key }));
  },
};
const webSlice = { permissionStore: slicePermissions, namespace: 'browser-profile' };
export function WorkspacePage({ model: m }: { model: WorkspaceController }) {
  const presentation = usePresentation();
  const mobile = useMobile();
  const current = m.current;
  const ancestors: TioObject[] = [];
  const visited = new Set<string>();
  let parent = m.nav.find((o) => o.id === current?.parentId);
  while (parent && !visited.has(parent.id)) {
    ancestors.unshift(parent);
    visited.add(parent.id);
    parent = m.nav.find((o) => o.id === parent?.parentId);
  }
  const header = (actions: ReactNode) => (
    <header className="sticky top-0 z-10 flex h-12 items-center justify-between gap-2 bg-panel/95 px-3 md:px-5">
      <div className="flex min-w-0 items-center gap-1 text-sm text-muted">
        <IconButton
          label={t('workspace.sidebar')}
          className={cn('p-1.5', !m.sidebarCollapsed && 'md:hidden')}
          onClick={() => {
            if (matchMedia('(min-width:768px)').matches) m.collapseSidebar();
            else m.setSidebar(true);
          }}
        >
          <PanelLeft size={18} />
        </IconButton>
        {(mobile || m.sidebarCollapsed) && !m.sidebar && <WorkspaceSwitcher model={m} compact />}
        {ancestors.map((o) => (
          <Fragment key={o.id}>
            <Button
              className="hidden max-w-36 truncate p-1 text-sm md:block"
              onClick={() => m.navigate(o)}
            >
              {titleOf(o)}
            </Button>
            <ChevronRight size={13} className="hidden shrink-0 md:block" />
          </Fragment>
        ))}
        <span className="hidden truncate text-secondary md:block">
          {current ? titleOf(current) : t('workspace.home')}
        </span>
      </div>
      <div className="flex shrink-0 items-center gap-1">
        <output
          className={cn(
            'hidden text-xs text-muted sm:block',
            m.saveStatus.includes('失败') && 'text-red-600',
          )}
          aria-live="polite"
        >
          {translateStatus(m.saveStatus)}
        </output>
        {m.supportsSync && (
          <Button
            className="max-w-28 truncate p-1 text-xs text-muted"
            title={translateStatus(m.syncStatus)}
            onClick={() => void m.syncNow()}
          >
            {translateStatus(m.syncStatus)}
          </Button>
        )}
        {m.issues.length > 0 && (
          <Button className="text-xs" onClick={() => m.setIssuesOpen(true)}>
            {t('sync.showIssues')}
          </Button>
        )}
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
    </header>
  );
  const preview = m.objects.find((o) => o.id === m.previewId && !o.deleted);
  return (
    <div className="min-h-dvh">
      <Sidebar model={m} />
      <div
        className="min-w-0 md:ml-[var(--sidebar-width)]"
        style={
          {
            '--sidebar-width': `${m.sidebarCollapsed ? 0 : m.sidebarWidth}px`,
          } as React.CSSProperties
        }
      >
        {m.runtime ? (
          <EditorSurface
            webSlice={webSlice}
            presentation={presentation}
            runtime={m.runtime}
            workspaceId={m.session!.workspaceId}
            target={{ id: current?.id ?? '' }}
            renderHeader={header}
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
            onNavigate={({ id }) => {
              const o = m.runtime!.snapshot().find((o) => o.id === id);
              if (o) m.navigate(o);
            }}
          />
        ) : (
          header(null)
        )}
      </div>
      {preview && m.runtime && (
        <Modal wide title={t('ui.preview')} close={() => m.setPreviewId(null)}>
          <div className="page-preview min-h-[85dvh] md:min-h-[78dvh]">
            <div className="flex min-h-14 items-center gap-2 border-b border-line px-4 pr-14 text-sm">
              <IconButton
                label={t('ui.expand')}
                onClick={() => m.navigate(preview)}
                className="p-1.5"
              >
                <Maximize2 size={17} />
              </IconButton>
              <span className="shrink-0 text-muted">{t('ui.addTo')}</span>
              <select
                aria-label={t('ui.location')}
                className="max-w-64 min-w-0 !border-0 !bg-transparent"
                value={preview.parentId ?? ''}
                onChange={(e) => m.movePage(preview.id, e.target.value || null)}
              >
                <option value="">{m.workspace?.name}</option>
                {m.nav
                  .filter((o) => o.type === 'page' && o.id !== preview.id)
                  .map((o) => (
                    <option key={o.id} value={o.id}>
                      {titleOf(o)}
                    </option>
                  ))}
              </select>
            </div>
            <EditorSurface
              webSlice={webSlice}
              presentation={presentation}
              runtime={m.runtime}
              workspaceId={m.session!.workspaceId}
              target={{ id: preview.id, mode: 'preview' }}
              autoFocusTitle
              renderHeader={(actions) => (
                <div className="flex justify-end px-4 pt-2">{actions}</div>
              )}
              onOpen={({ id }) => m.setPreviewId(id)}
              onNavigate={({ id }) => {
                const o = m.objects.find((o) => o.id === id);
                if (o) m.navigate(o);
              }}
            />
          </div>
        </Modal>
      )}
    </div>
  );
}
