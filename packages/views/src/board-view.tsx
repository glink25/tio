import { groups } from '@tio/database';
import { useT } from '@tio/i18n';
import { Button, Popover } from '@tio/ui';

import { useDisplayValue } from './display-value';
import { FieldInput, FieldValue } from './field-input';
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
  fields,
  objects,
  resolve,
}: RowsProps) {
  const t = useT();
  const displayValue = useDisplayValue();
  const field =
    database.fields?.find((f) => f.id === view.groupBy && ['select', 'status'].includes(f.type)) ??
    database.fields?.find((f) => ['select', 'status'].includes(f.type));
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
              className="board-record my-2 rounded-md border border-line bg-panel p-2 shadow-xs"
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
              {fields
                .filter((f) => f.type !== 'title' && f.id !== field?.id)
                .map((f) => (
                  <div className="my-1 min-w-0 text-xs text-muted" key={f.id}>
                    <FieldValue
                      field={f}
                      value={record.properties?.[f.id]}
                      objects={objects}
                      resolve={resolve}
                      onOpen={onOpen}
                    />
                  </div>
                ))}
              {field &&
                (readOnly || canEdit?.(record, field) === false ? (
                  <FieldValue
                    field={field}
                    value={record.properties?.[field.id]}
                    objects={objects}
                  />
                ) : (
                  <Popover
                    label={field.name}
                    className="w-64"
                    trigger={
                      <Button
                        className="max-w-full px-1 py-1 text-xs"
                        aria-label={t('database.cardStatus')}
                      >
                        <FieldValue
                          field={field}
                          value={record.properties?.[field.id]}
                          objects={objects}
                        />
                      </Button>
                    }
                  >
                    <FieldInput
                      key={`${record.id}:${JSON.stringify(record.properties?.[field.id])}`}
                      field={field}
                      value={record.properties?.[field.id]}
                      objects={objects}
                      onChange={(value) => onCell(record, field, value)}
                    />
                  </Popover>
                ))}
            </div>
          ))}
        </section>
      ))}
    </div>
  );
}
