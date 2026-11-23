import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useDroppable,
  useSensor,
  useSensors,
  type DragOverEvent,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  useSortable,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { titleOf, type TioObject } from '@tio/core';
import { t, i18n } from '@tio/i18n';
import { IconButton, ObjectIcon, cn } from '@tio/ui';
import { navigationOrder } from '@tio/workspace';
import { ChevronRight, GripVertical, Plus } from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';

import type { WorkspaceController } from './use-workspace';

type Placement = { id: string; position: 'before' | 'inside' | 'after' };

type TreeEntry = { object: TioObject; depth: number };

/** Only previously visible rows survive an exit; never mount collapsed subtrees. */
function retainExitingRows(previous: TreeEntry[], visible: TreeEntry[]): TreeEntry[] {
  const ids = new Set(visible.map((row) => row.object.id));
  const result = [...visible];
  previous.forEach((row, index) => {
    if (ids.has(row.object.id)) return;
    const following = previous.slice(index + 1).find((entry) => ids.has(entry.object.id));
    const before = following
      ? result.findIndex((entry) => entry.object.id === following.object.id)
      : -1;
    result.splice(before < 0 ? result.length : before, 0, row);
  });
  return result;
}

export function PageTree({
  model: m,
  renderActions,
}: {
  model: WorkspaceController;
  renderActions: (o: TioObject) => ReactNode;
}) {
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [activeId, setActiveId] = useState<string>();
  const [placement, setPlacement] = useState<Placement>();
  const drop = useRef<Placement | undefined>(undefined);
  const keyboardInside = useRef(false);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  const rows = useMemo(() => {
    const visible: TreeEntry[] = [];
    const walk = (parent: string | null, depth: number) => {
      for (const object of m.nav
        .filter((o) => (o.parentId ?? null) === parent)
        .sort(navigationOrder)) {
        visible.push({ object, depth });
        // A newly created preview remains visible under its collapsed parent.
        if (
          (!collapsed.has(object.id) ||
            m.nav.some((o) => o.id === m.previewId && o.parentId === object.id)) &&
          object.id !== activeId
        )
          walk(object.id, depth + 1);
      }
    };
    walk(null, 0);
    return visible;
  }, [m.nav, m.previewId, collapsed, activeId]);
  const [retained, setRetained] = useState<TreeEntry[]>([]);
  useEffect(() => {
    setRetained((previous) => retainExitingRows(previous, rows));
    const timeout = setTimeout(() => setRetained(rows), 180);
    return () => clearTimeout(timeout);
  }, [rows]);
  const visibleIds = new Set(rows.map((row) => row.object.id));
  const renderedRows = retainExitingRows(retained, rows);
  const updatePlacement = (event: DragOverEvent | DragEndEvent) => {
    const { active, over, activatorEvent, delta } = event;
    if (!over || active.id === over.id) {
      drop.current = undefined;
      setPlacement(undefined);
      return;
    }
    let position: Placement['position'];
    if (activatorEvent instanceof KeyboardEvent) {
      position = keyboardInside.current
        ? 'inside'
        : rows.findIndex((r) => r.object.id === active.id) <
            rows.findIndex((r) => r.object.id === over.id)
          ? 'after'
          : 'before';
    } else {
      const y = (activatorEvent as PointerEvent).clientY + delta.y;
      const fraction = (y - over.rect.top) / over.rect.height;
      position = fraction < 0.25 ? 'before' : fraction > 0.75 ? 'after' : 'inside';
    }
    const next = { id: String(over.id), position };
    drop.current = next;
    setPlacement(next);
  };
  const reset = () => {
    setActiveId(undefined);
    setPlacement(undefined);
    drop.current = undefined;
    keyboardInside.current = false;
  };
  const end = (event: DragEndEvent) => {
    updatePlacement(event);
    const target = drop.current;
    if (target) {
      const source = String(event.active.id);
      if (target.id === 'tio-navigation-root') m.placePage(source, null, null);
      else {
        const object = m.nav.find((o) => o.id === target.id);
        if (object) {
          if (target.position === 'inside') {
            const first = m.nav
              .filter((o) => o.parentId === object.id && o.id !== source)
              .sort(navigationOrder)[0];
            m.placePage(source, object.id, first?.id ?? null);
            setCollapsed((previous) => new Set([...previous].filter((id) => id !== object.id)));
          } else {
            const siblings = m.nav
              .filter((o) => (o.parentId ?? null) === (object.parentId ?? null) && o.id !== source)
              .sort(navigationOrder);
            const before =
              target.position === 'before'
                ? object.id
                : (siblings[siblings.findIndex((o) => o.id === object.id) + 1]?.id ?? null);
            m.placePage(source, object.parentId ?? null, before);
          }
        }
      }
    }
    reset();
  };
  const active = m.nav.find((o) => o.id === activeId);
  return (
    <div
      data-tree-dragging={!!activeId}
      onKeyDownCapture={(event) => {
        if (!activeId || !['ArrowLeft', 'ArrowRight'].includes(event.key)) return;
        event.preventDefault();
        event.stopPropagation();
        keyboardInside.current = event.key === 'ArrowRight';
        if (drop.current) {
          const next = {
            ...drop.current,
            position: keyboardInside.current ? ('inside' as const) : ('before' as const),
          };
          drop.current = next;
          setPlacement(next);
        }
      }}
    >
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragStart={({ active }) => setActiveId(String(active.id))}
        onDragOver={updatePlacement}
        onDragMove={updatePlacement}
        onDragEnd={end}
        onDragCancel={reset}
        accessibility={{
          screenReaderInstructions: {
            draggable:
              i18n.language === 'zh'
                ? '空格开始拖动，上下键选择位置，右键移入、左键同级，空格放下，Escape 取消。'
                : 'Space to drag, up/down to choose a position, right to nest, left for siblings, Space to drop, Escape to cancel.',
          },
        }}
      >
        <SortableContext
          items={rows.map((r) => r.object.id)}
          strategy={verticalListSortingStrategy}
        >
          {renderedRows.map(({ object, depth }) => (
            <TreeRow
              key={object.id}
              object={object}
              depth={depth}
              hidden={!visibleIds.has(object.id)}
              model={m}
              collapsed={collapsed.has(object.id)}
              toggle={() =>
                setCollapsed((previous) => {
                  const next = new Set(previous);
                  if (next.has(object.id)) next.delete(object.id);
                  else next.add(object.id);
                  return next;
                })
              }
              placement={placement?.id === object.id ? placement.position : undefined}
              renderActions={renderActions}
            />
          ))}
        </SortableContext>
        <RootDrop active={!!activeId} selected={placement?.id === 'tio-navigation-root'} />
        <DragOverlay dropAnimation={null}>
          {active ? (
            <div className="flex max-w-64 items-center gap-2 rounded-md border border-line bg-panel px-3 py-2 text-sm shadow-lg">
              <ObjectIcon type={active.type} />
              <span className="truncate">{titleOf(active)}</span>
            </div>
          ) : null}
        </DragOverlay>
      </DndContext>
    </div>
  );
}
function RootDrop({ active, selected }: { active: boolean; selected: boolean }) {
  const { setNodeRef } = useDroppable({ id: 'tio-navigation-root', disabled: !active });
  return (
    <div
      ref={setNodeRef}
      className={cn(
        'min-h-6 rounded-md',
        active && 'min-h-10 border border-dashed border-line',
        selected && 'bg-surface-hover',
      )}
      aria-label={t('workspace.home')}
    />
  );
}
function TreeRow({
  object: o,
  depth,
  model: m,
  collapsed,
  hidden,
  toggle,
  placement,
  renderActions,
}: {
  object: TioObject;
  depth: number;
  model: WorkspaceController;
  collapsed: boolean;
  hidden: boolean;
  toggle: () => void;
  placement?: Placement['position'];
  renderActions: (o: TioObject) => ReactNode;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    setActivatorNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: o.id, disabled: hidden || !m.runtime?.can(o, 'update') });
  return (
    <div
      ref={setNodeRef}
      className="tio-tree-row grid"
      inert={hidden || undefined}
      aria-hidden={hidden || undefined}
      data-hidden={hidden}
      data-navigation-id={o.id}
      data-drop-position={placement}
      style={{
        gridTemplateRows: hidden ? '0fr' : '1fr',
        transform: CSS.Transform.toString(transform),
        transition: [transition, 'grid-template-rows 180ms ease-out, opacity 140ms ease-out']
          .filter(Boolean)
          .join(', '),
        opacity: hidden ? 0 : 1,
      }}
    >
      <div className="min-h-0 overflow-hidden">
        <div
          style={{ paddingLeft: 8 + depth * 14 }}
          className={cn(
            'group relative flex min-h-9 items-center rounded-md hover:bg-surface-hover',
            m.current?.id === o.id && 'bg-surface-hover',
            isDragging && 'opacity-30',
            placement === 'inside' && 'ring-1 ring-ink',
            placement === 'before' &&
              'before:absolute before:inset-x-0 before:top-0 before:h-0.5 before:bg-ink',
            placement === 'after' &&
              'after:absolute after:inset-x-0 after:bottom-0 after:h-0.5 after:bg-ink',
          )}
        >
          <button
            type="button"
            ref={setActivatorNodeRef}
            {...attributes}
            {...listeners}
            aria-label={`${t('ui.move')} ${titleOf(o)}`}
            className="tio-tree-grip touch-none rounded p-0.5 text-muted opacity-100 focus:opacity-100 md:opacity-0 md:group-hover:opacity-100"
          >
            <GripVertical size={12} />
          </button>
          <IconButton
            label={t('page.expand')}
            aria-expanded={!collapsed}
            className={cn('p-0.5', !m.nav.some((c) => c.parentId === o.id) && 'invisible')}
            onClick={toggle}
          >
            <ChevronRight size={13} className={cn('tio-tree-chevron', !collapsed && 'rotate-90')} />
          </IconButton>
          <button
            className="flex min-w-0 flex-1 items-center gap-2 py-2 text-left text-sm text-secondary"
            onClick={() => m.navigate(o)}
          >
            <ObjectIcon type={o.type} icon={o.icon} size={16} resolve={m.resolveMedia} />
            <span className="truncate">{titleOf(o)}</span>
          </button>
          <div className="tio-tree-actions flex shrink-0 opacity-100 group-focus-within:opacity-100 md:opacity-0 md:group-hover:opacity-100">
            {o.type === 'page' && (
              <IconButton label={t('page.child')} className="p-1" onClick={() => m.addPage(o.id)}>
                <Plus size={14} />
              </IconButton>
            )}
            {renderActions(o)}
          </div>
        </div>
      </div>
    </div>
  );
}
