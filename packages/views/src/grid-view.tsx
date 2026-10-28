import DataEditor, {
  GridCellKind,
  CompactSelection,
  type GridSelection,
  type GridCell,
  type Item,
  type EditableGridCell,
  type DataEditorRef,
} from '@glideapps/glide-data-grid';
import { isDerivedField } from '@tio/core';
import { isFieldError } from '@tio/database';
import { useT } from '@tio/i18n';
import { useTheme, Popover, Button } from '@tio/ui';
import { useCallback, useEffect, useRef, useState } from 'react';

import { useDisplayValue } from './display-value';
import { fieldIcon, fieldHeaderIcons } from './field-icons';
import { FieldInput, optionPalette } from './field-input';
import { FieldMenu } from './field-menu';
import type { RowsProps } from './types';

import '@glideapps/glide-data-grid/dist/index.css';
export function GridView(props: RowsProps) {
  const { fields, rows, objects, onCell, onOpen, canEdit, view, onView, readOnly } = props;
  const displayValue = useDisplayValue();
  const t = useT();
  const [cellSelection, setCellSelection] = useState<GridSelection>();
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [deleting, setDeleting] = useState(false);
  const selectionKey = JSON.stringify([view, props.searchQuery, rows.map((r) => r.id)]);
  useEffect(() => {
    setSelectedIds([]);
    setCellSelection(undefined);
  }, [selectionKey]);
  const selected = rows.filter((r) => selectedIds.includes(r.id));
  const blocked =
    readOnly ||
    !props.onDeleteRecords ||
    selected.some((r) => props.canDeleteRecord?.(r) === false);
  const removeSelected = () => {
    if (!selected.length || blocked || deleting) return;
    setDeleting(true);
    void props.onDeleteRecords!(selected)
      .then(() => setSelectedIds([]))
      .catch(() => {})
      .finally(() => setDeleting(false));
  };
  const selection: GridSelection = {
    current: cellSelection?.current,
    rows: rows.reduce(
      (selection, record, i) => (selectedIds.includes(record.id) ? selection.add(i) : selection),
      CompactSelection.empty(),
    ),
    columns: cellSelection?.columns ?? CompactSelection.empty(),
  };
  const [editing, setEditing] = useState<{ recordId: string; fieldId: string } | null>(null);
  const editingRecord = rows.find((r) => r.id === editing?.recordId);
  const editingField = fields.find((f) => f.id === editing?.fieldId);
  const gridRef = useRef<DataEditorRef>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [anchor, setAnchor] = useState({ x: 0, y: 0 });
  const [header, setHeader] = useState<{ col: number; x: number; y: number; open: boolean } | null>(
    null,
  );
  useEffect(() => {
    const close = () => {
      setEditing(null);
      setHeader(null);
    };
    const scroll = (event: Event) => {
      if (
        event.target instanceof Element &&
        event.target.closest('.tio-popover, .tio-menu, .tio-dialog')
      )
        return;
      close();
    };
    window.addEventListener('resize', close);
    window.addEventListener('scroll', scroll, true);
    const observer = new ResizeObserver(close);
    if (containerRef.current) observer.observe(containerRef.current);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', close);
      window.removeEventListener('scroll', scroll, true);
    };
  }, []);
  const dark = useTheme() === 'dark';
  const [colors, setColors] = useState<Record<string, string>>({});
  useEffect(() => {
    if (!containerRef.current) return;
    const style = getComputedStyle(containerRef.current);
    setColors(
      Object.fromEntries(
        [
          'accent',
          'on-accent',
          'surface',
          'surface-hover',
          'panel',
          'line',
          'ink',
          'secondary',
          'muted',
        ]
          .map((token) => [token, style.getPropertyValue(`--color-${token}`).trim()])
          .filter((entry) => entry[1]),
      ),
    );
  }, [dark]);
  const getCell = useCallback(
    ([col, row]: Item): GridCell => {
      const field = fields[col],
        record = rows[row];
      const value = record?.properties?.[field?.id];
      const readonly =
        readOnly ||
        !record ||
        !field ||
        (field && isDerivedField(field)) ||
        canEdit?.(record, field) === false;
      if (!field)
        return {
          kind: GridCellKind.Text,
          data: '',
          displayData: '',
          allowOverlay: false,
          readonly: true,
        };
      if (field.type === 'boolean')
        return {
          kind: GridCellKind.Boolean,
          data: !!value,
          allowOverlay: false,
          readonly,
        };
      if (field.type === 'number')
        return {
          kind: GridCellKind.Number,
          readonly,
          data: typeof value === 'number' ? value : undefined,
          displayData: displayValue(value, field, objects),
          allowOverlay: false,
        };
      const data = displayValue(value, field, objects);
      if (['select', 'multiSelect', 'status'].includes(field.type))
        return {
          kind: GridCellKind.Bubble,
          data: data ? data.split(', ') : [],
          allowOverlay: false,
        };

      return {
        kind: GridCellKind.Text,
        data,
        displayData: data,
        allowOverlay: false,
        readonly: true,
        themeOverride: isFieldError(value) ? { textDark: '#c4554d' } : undefined,
      };
    },
    [fields, rows, objects, displayValue, canEdit, readOnly],
  );
  const edit = ([col, row]: Item, cell: EditableGridCell) => {
    const field = fields[col],
      record = rows[row];
    if (
      field &&
      record &&
      !readOnly &&
      !isDerivedField(field) &&
      canEdit?.(record, field) !== false
    )
      onCell(record, field, cell.data ?? null);
  };
  return (
    <>
      {header && fields[header.col] && (
        <FieldMenu
          {...props}
          field={fields[header.col]}
          open={header.open}
          onOpenChange={(open) => setHeader((p) => (p ? { ...p, open } : null))}
          trigger={
            <button
              tabIndex={-1}
              aria-hidden
              style={{
                position: 'fixed',
                left: header.x,
                top: header.y,
                width: 1,
                height: 1,
                pointerEvents: 'none',
              }}
            />
          }
        />
      )}
      <div className="relative">
        {selected.length > 0 && (
          <section
            className="absolute top-0 left-10 z-10 flex max-w-[calc(100%-3rem)] flex-wrap items-center gap-1 rounded-lg border border-line bg-panel px-2 py-1 text-xs shadow-lg"
            aria-label={t('database.rowActions')}
          >
            <span className="px-1 font-medium whitespace-nowrap">
              {t('database.selectedRows', { count: selected.length })}
            </span>
            {selected.length === 1 && (
              <Button
                type="button"
                className="h-7 px-2 py-1 text-xs"
                onClick={() => onOpen(selected[0])}
              >
                {t('database.openRecord')}
              </Button>
            )}
            <Button
              type="button"
              className="h-7 px-2 py-1 text-xs"
              disabled={blocked || deleting}
              onClick={removeSelected}
            >
              {t('database.deleteRecord')}
            </Button>
            <Button
              type="button"
              className="h-7 px-2 py-1 text-xs"
              disabled={deleting}
              onClick={() => setSelectedIds([])}
            >
              {t('ui.cancel')}
            </Button>
            {blocked && (
              <span className="text-xs text-muted">{t('database.deleteRowsDenied')}</span>
            )}
          </section>
        )}
        <div ref={containerRef} className="w-full overflow-hidden">
          <DataEditor
            ref={gridRef}
            headerIcons={fieldHeaderIcons}
            cellActivationBehavior="double-click"
            width="100%"
            height={Math.min(460, Math.max(160, rows.length * 42 + 40))}
            columns={[
              ...fields.map((f) => ({
                id: f.id,
                title: f.name,
                icon: fieldIcon(f.type),
                hasMenu: true,
                width: view.columnWidths?.[f.id] ?? (f.type === 'title' ? 270 : 155),
              })),
              { id: '__add', title: '+', width: 44 },
            ]}
            onHeaderMenuClick={(col, bounds) =>
              setHeader({ col, x: bounds.x, y: bounds.y + bounds.height, open: true })
            }
            onHeaderClicked={(col, event) => {
              if (col === fields.length) {
                if (!readOnly) props.onField?.();
              } else
                setHeader({
                  col,
                  x: event.bounds.x,
                  y: event.bounds.y + event.bounds.height,
                  open: true,
                });
            }}
            onColumnResize={(column, width) => {
              if (!readOnly && column.id && column.id !== '__add')
                onView({
                  columnWidths: {
                    ...view.columnWidths,
                    [column.id]: Math.min(2000, Math.max(80, width)),
                  },
                });
            }}
            rows={rows.length}
            getCellContent={getCell}
            drawCell={({ ctx, rect, col, row, theme }, drawContent) => {
              const field = fields[col];
              if (!field || !['select', 'multiSelect', 'status'].includes(field.type)) {
                drawContent();
                return;
              }
              const raw = rows[row]?.properties?.[field.id];
              const ids = Array.isArray(raw) ? raw : raw ? [raw] : [];
              ctx.save();
              ctx.beginPath();
              ctx.rect(rect.x, rect.y, rect.width, rect.height);
              ctx.clip();
              ctx.font = `12px ${theme.fontFamily}`;
              ctx.textBaseline = 'middle';
              let x = rect.x + 8;
              for (const id of ids) {
                const option = field.options?.find((o) => o.id === id);
                const label = option?.label ?? String(id),
                  color = optionPalette[option?.color ?? 'gray'] ?? optionPalette.gray;
                const width = Math.min(ctx.measureText(label).width + 14, rect.width - 16);
                if (x + width > rect.x + rect.width - 4) break;
                ctx.fillStyle = color + (dark ? '55' : '22');
                ctx.beginPath();
                ctx.roundRect(x, rect.y + (rect.height - 23) / 2, width, 23, 4);
                ctx.fill();
                ctx.save();
                ctx.beginPath();
                ctx.rect(x + 7, rect.y, width - 14, rect.height);
                ctx.clip();
                ctx.fillStyle = dark ? theme.textDark : color;
                ctx.fillText(label, x + 7, rect.y + rect.height / 2);
                ctx.restore();
                x += width + 5;
              }
              ctx.restore();
            }}
            onCellEdited={edit}
            onCellActivated={([col, row]) => {
              if (!rows[row] || !fields[col]) return;
              const bounds = gridRef.current?.getBounds(col, row);
              if (!bounds) return;
              setAnchor({ x: bounds.x, y: bounds.y + bounds.height });
              setEditing({ recordId: rows[row].id, fieldId: fields[col].id });
            }}
            rowHeight={42}
            headerHeight={38}
            rowMarkers={readOnly ? 'number' : 'both'}
            rowSelect="multi"
            rowSelectionMode="multi"
            gridSelection={selection}
            onGridSelectionChange={(next) => {
              setCellSelection(next);
              setSelectedIds(next.rows.toArray().flatMap((i) => (rows[i] ? [rows[i].id] : [])));
            }}
            onDelete={(next) => {
              if (next.rows.length) removeSelected();
              return false;
            }}
            smoothScrollX
            smoothScrollY
            theme={{
              accentColor: colors.accent ?? colors.ink ?? (dark ? '#eeeeee' : '#252525'),
              accentLight: colors['surface-hover'] ?? (dark ? '#303030' : '#ebebeb'),
              bgHeader: colors.surface ?? (dark ? '#202020' : '#f7f7f5'),
              bgCell: colors.panel ?? (dark ? '#191919' : '#ffffff'),
              borderColor: colors.line ?? (dark ? '#383838' : '#e7e7e7'),
              textDark: colors.ink ?? (dark ? '#eeeeee' : '#252525'),
              textHeader: colors.ink ?? colors.ink ?? (dark ? '#eeeeee' : '#252525'),
              textHeaderSelected: colors['on-accent'] ?? (dark ? '#191919' : '#ffffff'),
              textGroupHeader: colors.secondary ?? (dark ? '#b5b5b5' : '#666666'),
              accentFg: colors['on-accent'] ?? (dark ? '#191919' : '#ffffff'),
              bgIconHeader: colors['surface-hover'] ?? (dark ? '#303030' : '#ebebeb'),
              fgIconHeader: dark ? '#eeeeee' : '#444444',
              textBubble: dark ? '#eeeeee' : '#333333',
              bgBubble: colors['surface-hover'] ?? (dark ? '#303030' : '#ebebeb'),
              bgBubbleSelected: dark ? '#444444' : '#dddddd',
              linkColor: colors.ink ?? colors.ink ?? (dark ? '#eeeeee' : '#252525'),
              textMedium: colors.secondary ?? (dark ? '#b5b5b5' : '#666666'),
              textLight: colors.muted ?? (dark ? '#999999' : '#808080'),
              bgCellMedium: dark ? '#242424' : '#fafafa',
              bgHeaderHovered: colors['surface-hover'] ?? (dark ? '#303030' : '#ebebeb'),
              bgHeaderHasFocus: colors['surface-hover'] ?? (dark ? '#303030' : '#ebebeb'),
              fontFamily: 'Inter, system-ui, sans-serif',
              baseFontStyle: '13px',
            }}
          />
        </div>
      </div>
      {editingRecord && editingField && (
        <Popover
          mobilePlacement="center"
          modal
          restoreFocus={() => gridRef.current?.focus()}
          open
          onOpenChange={(open) => {
            if (!open) setEditing(null);
          }}
          label={editingField.name}
          className={
            editingField.type === 'files'
              ? 'w-[min(400px,calc(100vw-24px))]'
              : editingField.type === 'date'
                ? 'w-[min(300px,calc(100vw-24px))]'
                : 'w-[min(280px,calc(100vw-24px))]'
          }
          trigger={
            <button
              tabIndex={-1}
              aria-hidden
              style={{
                position: 'fixed',
                left: anchor.x,
                top: anchor.y,
                width: 1,
                height: 1,
                pointerEvents: 'none',
              }}
            />
          }
        >
          <FieldInput
            key={`${editingRecord.id}:${editingField.id}`}
            field={editingField}
            value={editingRecord.properties?.[editingField.id]}
            objects={objects}
            upload={props.upload}
            resolve={props.resolve}
            onOpen={onOpen}
            record={editingRecord}
            readOnly={readOnly || canEdit?.(editingRecord, editingField) === false}
            inlineReferencePicker
            onCancel={() => setEditing(null)}
            onChange={(value) => {
              onCell(editingRecord, editingField, value);
              setEditing(null);
            }}
          />
        </Popover>
      )}
    </>
  );
}
