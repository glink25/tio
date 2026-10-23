import { valueText } from '@tio/core';
import { groups } from '@tio/database';
import { useT } from '@tio/i18n';
import { Button } from '@tio/ui';

import { useDisplayValue } from './display-value';
import type { RowsProps } from './types';
export function BoardView({
  database,
  view,
  rows,
  onCell,
  onOpen,
  canEdit,
  readOnly,
  onFields,
}: RowsProps) {
  const t = useT();
  const displayValue = useDisplayValue();
  const field =
    database.fields?.find((f) => f.id === view.groupBy && f.type === 'select') ??
    database.fields?.find((f) => f.type === 'select');
  return (
    <div className="board flex min-h-52 gap-3 overflow-x-auto bg-surface/50 p-4">
      {!field && (
        <Button disabled={readOnly} onClick={onFields}>
          {t('ui.noGroup')}
        </Button>
      )}
      {groups(rows, field).map((group) => (
        <section
          className="board-column min-w-52 flex-1"
          key={group.id}
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            const record = rows.find((r) => r.id === e.dataTransfer.getData('record'));
            if (record && field && !readOnly && canEdit?.(record, field) !== false)
              onCell(record, field, group.id || null);
          }}
        >
          <h4 className="mb-3 flex items-center gap-2 px-1 text-xs font-medium">
            <span className="size-1.5 rounded-full bg-sage" />
            {group.id ? group.label : t('database.ungrouped')}
            <small className="ml-auto text-muted">{group.records.length}</small>
          </h4>
          {group.records.map((record) => (
            <div
              className="my-2 rounded-md border border-line bg-panel p-2 shadow-xs"
              key={record.id}
              draggable={!readOnly && !!field && canEdit?.(record, field) !== false}
              onDragStart={(e) => e.dataTransfer.setData('record', record.id)}
            >
              <Button
                className="w-full justify-start text-left text-xs leading-relaxed font-medium"
                onClick={() => onOpen(record)}
              >
                {displayValue(
                  record.properties?.[database.fields?.find((f) => f.type === 'title')?.id ?? ''],
                  { id: '', name: '', type: 'text' },
                ) || t('common.untitled')}
              </Button>
              {field && (
                <select
                  disabled={readOnly || canEdit?.(record, field) === false}
                  aria-label={t('database.cardStatus')}
                  className="max-w-full border-0! bg-surface! px-2! py-1! text-[10px]!"
                  value={valueText(record.properties?.[field.id] ?? '')}
                  onChange={(e) => onCell(record, field, e.target.value || null)}
                >
                  <option value="">{t('database.ungrouped')}</option>
                  {field.options?.map((o) => (
                    <option key={o.id} value={o.id}>
                      {o.label}
                    </option>
                  ))}
                </select>
              )}
            </div>
          ))}
        </section>
      ))}
    </div>
  );
}
