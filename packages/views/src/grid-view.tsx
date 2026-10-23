import DataEditor, {
  GridCellKind,
  type GridCell,
  type Item,
  type EditableGridCell,
} from '@glideapps/glide-data-grid';
import { valueText } from '@tio/core';
import { useTheme, Popover } from '@tio/ui';
import { useCallback, useState } from 'react';

import { useDisplayValue } from './display-value';
import { FieldInput } from './field-input';
import { FieldMenu } from './field-menu';
import type { RowsProps } from './types';

import '@glideapps/glide-data-grid/dist/index.css';
export function GridView(props: RowsProps) {
  const { fields, rows, objects, onCell, onOpen, canEdit, view, onView, readOnly } = props;
  const displayValue = useDisplayValue();
  const [editing, setEditing] = useState<Item | null>(null);
  const [anchor, setAnchor] = useState({ x: 0, y: 0 });
  const [header, setHeader] = useState<{ col: number; x: number; y: number; open: boolean } | null>(
    null,
  );
  const dark = useTheme() === 'dark';
  const getCell = useCallback(
    ([col, row]: Item): GridCell => {
      const field = fields[col],
        record = rows[row];
      const value = record?.properties?.[field?.id];
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
          readonly: canEdit?.(record, field) === false,
        };
      if (field.type === 'number')
        return {
          kind: GridCellKind.Number,
          readonly: canEdit?.(record, field) === false,
          data: typeof value === 'number' ? value : undefined,
          displayData: valueText(value ?? ''),
          allowOverlay: false,
        };
      const data = displayValue(value, field, objects);
      return {
        kind: GridCellKind.Text,
        data,
        displayData: field.type === 'title' ? data + ' ↗' : data,
        allowOverlay: false,
        readonly: canEdit?.(record, field) === false || !['title', 'text'].includes(field.type),
      };
    },
    [fields, rows, objects, displayValue, canEdit],
  );
  const edit = ([col, row]: Item, cell: EditableGridCell) => {
    const field = fields[col],
      record = rows[row];
    if (field && record && canEdit?.(record, field) !== false)
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
      <div className="w-full overflow-hidden">
        <DataEditor
          width="100%"
          height={Math.min(460, Math.max(160, rows.length * 42 + 40))}
          columns={[
            ...fields.map((f) => ({
              id: f.id,
              title: (f.type === 'title' ? 'Aa  ' : f.type === 'number' ? '#  ' : '≡  ') + f.name,
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
          onCellEdited={edit}
          onCellClicked={([col, row], event) => {
            setAnchor({ x: event.bounds.x, y: event.bounds.y + event.bounds.height });
            if (
              fields[col]?.type === 'title' &&
              event.localEventX > event.bounds.width - 32 &&
              rows[row]
            )
              onOpen(rows[row]);
          }}
          onCellActivated={([col, row]) => {
            if (!rows[row] || !fields[col]) return;
            if (fields[col]?.type === 'title') onOpen(rows[row]);
            else if (canEdit?.(rows[row], fields[col]) !== false) setEditing([col, row]);
          }}
          rowHeight={42}
          headerHeight={38}
          rowMarkers="none"
          smoothScrollX
          smoothScrollY
          theme={{
            accentColor: dark ? '#dddddd' : '#333333',
            accentLight: dark ? '#383838' : '#eeeeee',
            bgHeader: dark ? '#242424' : '#f7f7f5',
            bgCell: dark ? '#191919' : '#ffffff',
            borderColor: dark ? '#383838' : '#e7e7e7',
            textDark: dark ? '#eeeeee' : '#252525',
            textHeader: dark ? '#dddddd' : '#333333',
            textHeaderSelected: dark ? '#ffffff' : '#252525',
            textGroupHeader: dark ? '#bbbbbb' : '#666666',
            accentFg: dark ? '#191919' : '#ffffff',
            bgIconHeader: dark ? '#383838' : '#eeeeee',
            fgIconHeader: dark ? '#eeeeee' : '#444444',
            textBubble: dark ? '#eeeeee' : '#333333',
            bgBubble: dark ? '#383838' : '#eeeeee',
            bgBubbleSelected: dark ? '#444444' : '#dddddd',
            linkColor: dark ? '#dddddd' : '#333333',
            textMedium: dark ? '#bbbbbb' : '#666666',
            textLight: dark ? '#999999' : '#808080',
            bgCellMedium: dark ? '#242424' : '#fafafa',
            bgHeaderHovered: dark ? '#303030' : '#eeeeee',
            bgHeaderHasFocus: dark ? '#383838' : '#eeeeee',
            fontFamily: 'Inter, system-ui, sans-serif',
            baseFontStyle: '13px',
          }}
        />
      </div>
      {editing && fields[editing[0]] && rows[editing[1]] && (
        <Popover
          open
          onOpenChange={(open) => {
            if (!open) setEditing(null);
          }}
          label={fields[editing[0]].name}
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
            field={fields[editing[0]]}
            value={rows[editing[1]].properties?.[fields[editing[0]].id]}
            objects={objects}
            onChange={(value) => onCell(rows[editing[1]], fields[editing[0]], value)}
          />
        </Popover>
      )}
    </>
  );
}
