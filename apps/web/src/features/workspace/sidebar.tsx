import { titleOf, type TioObject } from '@tio/core';
import { t } from '@tio/i18n';
import { OverlayPresence } from '@tio/ui';
import { OptionsPanel } from '@tio/ui';
import {
  Button,
  IconButton,
  ObjectIcon,
  cn,
  Menu,
  MenuItem,
  MenuSeparator,
  Popover,
  Modal,
  useMobile,
} from '@tio/ui';
import { Zap, Settings } from 'lucide-react';
import {
  Search,
  Plus,
  ChevronsUpDown,
  Trash2,
  MoreHorizontal,
  Star,
  PanelLeftClose,
  FileText,
  Database,
  Pencil,
  Move,
} from 'lucide-react';
import { type ReactNode } from 'react';

import { ConnectionInfo, Identity } from '../../components/identity';
import { PageTree } from './page-tree';
import type { WorkspaceController } from './use-workspace';

export function WorkspaceSwitcher({
  model: m,
  compact = false,
}: {
  model: WorkspaceController;
  compact?: boolean;
}) {
  return (
    <Popover
      mobilePlacement="center"
      open={m.menu}
      onOpenChange={m.setMenu}
      label={t('ui.switch')}
      trigger={
        <Button
          disabled={m.busy}
          aria-label={t('ui.switch')}
          className={cn(
            'min-w-0 justify-start gap-2 font-medium',
            compact ? 'max-w-44 px-1 text-xs' : 'w-full px-2 text-sm',
          )}
        >
          <span className="truncate">{m.workspace?.name ?? m.session?.name}</span>
          <ChevronsUpDown size={14} className="ml-auto shrink-0 text-muted" />
        </Button>
      }
    >
      <OptionsPanel
        label={t('ui.spaces')}
        selected={m.session ? [m.session.id] : []}
        options={m.sessions.map((session) => ({
          id: session.id,
          text: session.name,
          label: session.name,
        }))}
        onClose={() => m.setMenu(false)}
        onSelect={(id) => {
          const session = m.sessions.find((item) => item.id === id);
          if (session) void m.activate(session);
          m.setMenu(false);
        }}
      />
      <div className="mt-2 border-t border-line pt-2">
        <Button
          className="w-full justify-start"
          onClick={() => {
            m.setMenu(false);
            void m.offline();
          }}
        >
          <Plus size={16} />
          {t('ui.newSpace')}
        </Button>
        <Button
          className="w-full justify-start"
          onClick={() => {
            m.setMenu(false);
            m.setRenaming(true);
          }}
        >
          <Pencil size={16} />
          {t('workspace.rename')}
        </Button>
      </div>
    </Popover>
  );
}
export function ObjectMenu({
  model: m,
  object: o,
  pageActions,
}: {
  model: WorkspaceController;
  object: TioObject;
  pageActions?: ReactNode;
}) {
  return (
    <Menu
      trigger={
        <IconButton label={`${titleOf(o)} · ${t('common.more')}`} className="p-1">
          <MoreHorizontal size={16} />
        </IconButton>
      }
    >
      <MenuItem onSelect={() => m.setRenameId(o.id)}>
        <Pencil size={15} />
        {t('ui.rename')}
      </MenuItem>
      <MenuItem onSelect={() => m.favorite(o)}>
        <Star size={15} />
        {t('workspace.favorite')}
      </MenuItem>
      <MenuItem onSelect={() => m.setMoveTarget(o.id)}>
        <Move size={15} />
        {t('ui.move')}
      </MenuItem>
      {o.type === 'page' && (
        <MenuItem onSelect={() => m.addPage(o.id)}>
          <Plus size={15} />
          {t('page.child')}
        </MenuItem>
      )}
      {pageActions}
      <MenuSeparator />
      <MenuItem danger onSelect={() => m.deleteObject(o)}>
        <Trash2 size={15} />
        {t('ui.delete')}
      </MenuItem>
    </Menu>
  );
}
export function Sidebar({
  model: m,
  pageActions,
}: {
  model: WorkspaceController;
  pageActions?: ReactNode;
}) {
  const mobile = useMobile();
  const content = (
    <div className="flex h-full min-h-0 flex-col px-2 py-3">
      <div className="flex items-center">
        <div className="min-w-0 flex-1">
          <WorkspaceSwitcher model={m} />
        </div>
        <IconButton
          label={t('ui.collapse')}
          className="hidden p-1 md:flex"
          onClick={m.collapseSidebar}
        >
          <PanelLeftClose size={16} />
        </IconButton>
      </div>
      <div className="my-3 space-y-1">
        <Button className="w-full justify-start text-sm" onClick={() => m.setSearching(true)}>
          <Search size={17} />
          {t('workspace.search')}
          <kbd className="ml-auto text-[10px] text-muted">⌘ K</kbd>
        </Button>
        <Menu
          trigger={
            <Button className="w-full justify-start text-sm">
              <Plus size={17} />
              {t('workspace.newPage')}
            </Button>
          }
        >
          <MenuItem onSelect={() => m.addPage()}>
            <FileText size={16} />
            {t('workspace.newPage')}
          </MenuItem>
          <MenuItem onSelect={() => m.addDatabase()}>
            <Database size={16} />
            {t('workspace.newDatabase')}
          </MenuItem>
        </Menu>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {!!m.session?.favorites?.length && (
          <section className="mb-4">
            <p className="px-3 py-2 text-xs text-muted">{t('workspace.favorites')}</p>
            {m.session.favorites.map((id) => {
              const o = m.nav.find((o) => o.id === id);
              return (
                o && (
                  <Button
                    key={id}
                    onClick={() => m.navigate(o)}
                    className={cn(
                      'w-full justify-start text-sm',
                      m.current?.id === id && 'bg-surface-hover',
                    )}
                  >
                    <ObjectIcon type={o.type} />
                    <span className="truncate">{titleOf(o)}</span>
                  </Button>
                )
              );
            })}
          </section>
        )}
        <div className="flex items-center justify-between px-3 py-2 text-xs text-muted">
          <span>{t('ui.pages')}</span>
          <IconButton label={t('workspace.newPage')} className="p-0.5" onClick={() => m.addPage()}>
            <Plus size={14} />
          </IconButton>
        </div>
        <nav aria-label={t('ui.pages')}>
          <PageTree
            model={m}
            renderActions={(o) => (
              <ObjectMenu
                model={m}
                object={o}
                pageActions={o.id === m.current?.id ? pageActions : null}
              />
            )}
          />
        </nav>
      </div>
      <div className="mt-3 border-t border-line pt-2">
        <Menu
          align="start"
          collisionPadding={8}
          label={t('ui.settings')}
          trigger={
            <Button
              data-settings-entry
              className="w-full justify-start text-sm"
              aria-label={t('ui.settings')}
            >
              <Identity identity={m.identity} />
            </Button>
          }
        >
          <div className="max-w-72 px-2.5 py-3">
            <ConnectionInfo identity={m.identity} />
          </div>
          <MenuSeparator />
          <MenuItem disabled={!m.runtime || !m.session} onSelect={() => m.setAutomationOpen(true)}>
            <Zap size={16} />
            {t('ui.automation')}
          </MenuItem>
          <MenuItem onSelect={() => m.setTrashOpen(true)}>
            <Trash2 size={16} />
            {t('ui.trash')}
          </MenuItem>
          <MenuItem onSelect={() => m.setSettingsOpen(true)}>
            <Settings size={16} />
            {t('ui.settings')}
          </MenuItem>
        </Menu>
      </div>
    </div>
  );
  return (
    <>
      {!mobile && (
        <aside
          data-collapsed={m.sidebarCollapsed}
          {...{ inert: m.sidebarCollapsed ? '' : undefined }}
          className="tio-sidebar fixed inset-y-0 left-0 z-20 hidden border-r border-line bg-surface md:block"
          style={{ width: m.sidebarWidth, translate: m.sidebarCollapsed ? '-100% 0' : '0 0' }}
        >
          {content}
          <button
            type="button"
            aria-label={t('ui.width')}
            tabIndex={0}
            className="absolute inset-y-0 -right-1 w-2 cursor-col-resize hover:bg-line"
            onKeyDown={(e) => {
              if (e.key === 'ArrowLeft') m.resizeSidebar(m.sidebarWidth - 10);
              if (e.key === 'ArrowRight') m.resizeSidebar(m.sidebarWidth + 10);
            }}
            onPointerDown={(e) => {
              document
                .querySelector('[data-sidebar-animating]')
                ?.removeAttribute('data-sidebar-animating');
              e.currentTarget.setPointerCapture(e.pointerId);
            }}
            onPointerMove={(e) => {
              if (e.currentTarget.hasPointerCapture(e.pointerId)) m.resizeSidebar(e.clientX);
            }}
            onPointerUp={(e) => e.currentTarget.releasePointerCapture(e.pointerId)}
          />
        </aside>
      )}
      <OverlayPresence>
        {m.sidebar && (
          <Modal sheet title={t('workspace.sidebar')} close={() => m.setSidebar(false)}>
            <div className="h-[calc(100dvh-100px)]">{content}</div>
          </Modal>
        )}
      </OverlayPresence>
    </>
  );
}
