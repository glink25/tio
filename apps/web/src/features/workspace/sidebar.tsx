import { titleOf, type TioObject } from '@tio/core';
import { t } from '@tio/i18n';
import {
  Button,
  IconButton,
  ObjectIcon,
  cn,
  Menu,
  MenuItem,
  MenuSeparator,
  Popover,
  Command,
  CommandInput,
  CommandList,
  CommandItem,
  CommandEmpty,
  Modal,
  useMobile,
} from '@tio/ui';
import {
  Search,
  Plus,
  ChevronsUpDown,
  Check,
  Trash2,
  MoreHorizontal,
  Star,
  ChevronRight,
  PanelLeftClose,
  FileText,
  Database,
  Pencil,
  Move,
} from 'lucide-react';
import { useState, type ReactNode } from 'react';

import { Identity } from '../../components/identity';
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
      <Command>
        <CommandInput placeholder={t('ui.spaces')} />
        <CommandList>
          <CommandEmpty className="p-4 text-sm text-muted">{t('ui.noResults')}</CommandEmpty>
          {m.sessions.map((s) => (
            <CommandItem
              key={s.id}
              value={s.id + ' ' + s.name}
              onSelect={() => void m.activate(s)}
              className="flex items-center gap-2"
            >
              <span className="flex-1 truncate">{s.name}</span>
              {s.id === m.session?.id && <Check size={15} />}
            </CommandItem>
          ))}
        </CommandList>
      </Command>
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
          <PageTree model={m} pageActions={pageActions} />
        </nav>
      </div>
      <div className="mt-3 border-t border-line pt-2">
        <Button
          className="w-full justify-start text-sm"
          aria-label={t('ui.settings')}
          onClick={() => m.setSettingsOpen(true)}
        >
          <Identity identity={m.identity} />
        </Button>
      </div>
    </div>
  );
  return (
    <>
      {!mobile && !m.sidebarCollapsed && (
        <aside
          className="fixed inset-y-0 left-0 z-20 hidden border-r border-line bg-surface md:block"
          style={{ width: m.sidebarWidth }}
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
              e.currentTarget.setPointerCapture(e.pointerId);
            }}
            onPointerMove={(e) => {
              if (e.currentTarget.hasPointerCapture(e.pointerId)) m.resizeSidebar(e.clientX);
            }}
            onPointerUp={(e) => e.currentTarget.releasePointerCapture(e.pointerId)}
          />
        </aside>
      )}
      {m.sidebar && (
        <Modal sheet title={t('workspace.sidebar')} close={() => m.setSidebar(false)}>
          <div className="h-[calc(100dvh-100px)]">{content}</div>
        </Modal>
      )}
    </>
  );
}
function PageTree({
  model: m,
  parent = null,
  depth = 0,
  pageActions,
}: {
  model: WorkspaceController;
  parent?: string | null;
  depth?: number;
  pageActions?: ReactNode;
}) {
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const children = m.nav
    .filter((o) => (o.parentId ?? null) === parent)
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  return (
    <>
      {children.map((o) => (
        <div key={o.id}>
          <div
            className={cn(
              'group flex min-h-9 items-center rounded-md hover:bg-surface-hover',
              m.current?.id === o.id && 'bg-surface-hover',
            )}
            style={{ paddingLeft: 8 + depth * 14 }}
            draggable
            onDragStart={(e) =>
              e.dataTransfer.setData(
                'application/tio-page',
                JSON.stringify({ id: o.id, workspaceId: o.workspaceId }),
              )
            }
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              e.stopPropagation();
              try {
                const source = JSON.parse(e.dataTransfer.getData('application/tio-page'));
                if (source.workspaceId === o.workspaceId) m.movePage(source.id, o.id);
              } catch {
                /* external drop */
              }
            }}
          >
            <IconButton
              label={t('page.expand')}
              aria-expanded={!collapsed.has(o.id)}
              className={cn('p-0.5', !m.nav.some((c) => c.parentId === o.id) && 'invisible')}
              onClick={() =>
                setCollapsed((previous) => {
                  const next = new Set(previous);
                  if (next.has(o.id)) next.delete(o.id);
                  else next.add(o.id);
                  return next;
                })
              }
            >
              <ChevronRight size={13} className={collapsed.has(o.id) ? '' : 'rotate-90'} />
            </IconButton>
            <button
              className="flex min-w-0 flex-1 items-center gap-2 py-2 text-left text-sm text-secondary"
              onClick={() => m.navigate(o)}
            >
              <ObjectIcon type={o.type} icon={o.icon} size={16} resolve={m.resolveMedia} />
              <span className="truncate">{titleOf(o)}</span>
            </button>
            <div className="flex shrink-0 opacity-100 group-focus-within:opacity-100 md:opacity-0 md:group-hover:opacity-100">
              {o.type === 'page' && (
                <IconButton label={t('page.child')} className="p-1" onClick={() => m.addPage(o.id)}>
                  <Plus size={14} />
                </IconButton>
              )}
              <ObjectMenu
                model={m}
                object={o}
                pageActions={o.id === m.current?.id ? pageActions : null}
              />
            </div>
          </div>
          {!collapsed.has(o.id) && depth < 100 && (
            <PageTree model={m} parent={o.id} depth={depth + 1} pageActions={pageActions} />
          )}
        </div>
      ))}
    </>
  );
}
