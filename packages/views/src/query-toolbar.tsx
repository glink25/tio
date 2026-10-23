import { valueText } from '@tio/core';
import { useT } from '@tio/i18n';
import { Button, IconButton, Menu, MenuItem, Popover, cn } from '@tio/ui';
import {
  Plus,
  Table2,
  Columns3,
  SlidersHorizontal,
  ListFilter,
  ArrowUpDown,
  Search,
  X,
  MoreHorizontal,
  List,
} from 'lucide-react';

import { FieldInput } from './field-input';
import type { RowsProps } from './types';
export function QueryToolbar(p: RowsProps) {
  const t = useT();
  const { database, view, rows, onView, onFields, onAdd, readOnly } = p;
  const fields = database.fields ?? [];
  const filters = view.filters ?? [];
  const sorts = view.sorts ?? [];
  return (
    <>
      <div className="flex min-w-0 flex-wrap items-center justify-between gap-2 border-b border-line pb-2">
        <div
          className="flex max-w-full min-w-0 items-center gap-1 overflow-x-auto"
          role="tablist"
          aria-label={t('ui.viewSettings')}
        >
          {(p.views ?? [view]).map((v) => (
            <Button
              key={v.id}
              role="tab"
              aria-selected={v.id === view.id}
              className={cn(
                'gap-1.5 px-2.5 py-1.5 text-sm',
                v.id === view.id && 'bg-surface-hover font-medium',
              )}
              onClick={() => p.onSelectView?.(v.id)}
            >
              {v.layout === 'board' ? <Columns3 size={15} /> : <Table2 size={15} />}
              <span className="max-w-36 truncate">{v.name ?? t('database.table')}</span>
            </Button>
          ))}
          {p.onCreateView && (
            <IconButton
              label={t('ui.viewNew')}
              disabled={readOnly}
              className="p-1.5"
              onClick={p.onCreateView}
            >
              <Plus size={16} />
            </IconButton>
          )}
          <Menu
            trigger={
              <IconButton label={t('ui.viewSettings')} className="p-1.5">
                <MoreHorizontal size={16} />
              </IconButton>
            }
          >
            <MenuItem disabled={readOnly} onSelect={p.onCopyView}>
              {t('ui.viewCopy')}
            </MenuItem>
            <MenuItem
              danger
              disabled={readOnly || (p.views?.length ?? 1) < 2}
              onSelect={p.onDeleteView}
            >
              {t('ui.viewDelete')}
            </MenuItem>
          </Menu>
        </div>
        <div className="flex items-center gap-0.5">
          <Popover
            label={t('database.filter')}
            trigger={
              <IconButton
                label={t('database.filter')}
                className={cn('p-1.5', filters.length > 0 && 'bg-surface-hover')}
              >
                <ListFilter size={16} />
                {filters.length > 0 && <span className="text-xs">{filters.length}</span>}
              </IconButton>
            }
            className="w-[440px]"
          >
            <h3 className="mb-3 font-medium">{t('database.filter')}</h3>
            <fieldset disabled={readOnly} className="space-y-3">
              {filters.map((filter, i) => {
                const field = fields.find((f) => f.id === filter.fieldId);
                return (
                  <div key={i} className="grid grid-cols-[1fr_1fr_auto] gap-2">
                    <select
                      aria-label={t('database.filterField')}
                      value={filter.fieldId}
                      onChange={(e) =>
                        onView({
                          filters: filters.map((f, n) =>
                            n === i ? { fieldId: e.target.value, op: 'contains', value: '' } : f,
                          ),
                        })
                      }
                    >
                      {fields.map((f) => (
                        <option key={f.id} value={f.id}>
                          {f.name}
                        </option>
                      ))}
                    </select>
                    <select
                      aria-label={t('ui.type')}
                      value={filter.op}
                      onChange={(e) =>
                        onView({
                          filters: filters.map((f, n) =>
                            n === i
                              ? { ...f, op: e.target.value as typeof f.op, value: undefined }
                              : f,
                          ),
                        })
                      }
                    >
                      {(['contains', 'eq', 'notEmpty'] as const).map((op) => (
                        <option key={op} value={op}>
                          {t(
                            op === 'eq'
                              ? 'ui.equals'
                              : op === 'contains'
                                ? 'ui.contains'
                                : 'ui.notEmpty',
                          )}
                        </option>
                      ))}
                    </select>
                    <IconButton
                      label={t('ui.remove')}
                      className="p-1"
                      onClick={() => onView({ filters: filters.filter((_, n) => n !== i) })}
                    >
                      <X size={15} />
                    </IconButton>
                    {filter.op !== 'notEmpty' && (
                      <div className="col-span-3">
                        {filter.op === 'eq' && field ? (
                          <FieldInput
                            field={{
                              ...field,
                              type: field.type === 'multiSelect' ? 'select' : field.type,
                              multiple: false,
                            }}
                            value={filter.value}
                            objects={p.objects}
                            onChange={(value) =>
                              onView({
                                filters: filters.map((f, n) => (n === i ? { ...f, value } : f)),
                              })
                            }
                          />
                        ) : (
                          <input
                            className="w-full"
                            aria-label={t('database.filterValue')}
                            value={valueText(filter.value ?? '')}
                            onChange={(e) =>
                              onView({
                                filters: filters.map((f, n) =>
                                  n === i ? { ...f, value: e.target.value } : f,
                                ),
                              })
                            }
                          />
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
              <Button
                disabled={!fields.length}
                onClick={() =>
                  onView({
                    filters: [...filters, { fieldId: fields[0].id, op: 'contains', value: '' }],
                  })
                }
              >
                <Plus size={14} />
                {t('ui.filterAdd')}
              </Button>
            </fieldset>
          </Popover>
          <Popover
            label={t('database.sort')}
            trigger={
              <IconButton
                label={t('database.sort')}
                className={cn('p-1.5', sorts.length > 0 && 'bg-surface-hover')}
              >
                <ArrowUpDown size={16} />
                {sorts.length > 0 && <span className="text-xs">{sorts.length}</span>}
              </IconButton>
            }
            className="w-96"
          >
            <h3 className="mb-3 font-medium">{t('database.sort')}</h3>
            <fieldset disabled={readOnly} className="space-y-2">
              {sorts.map((sort, i) => (
                <div key={i} className="flex gap-2">
                  <select
                    className="min-w-0 flex-1"
                    aria-label={t('database.sortField')}
                    value={sort.fieldId}
                    onChange={(e) =>
                      onView({
                        sorts: sorts.map((s, n) =>
                          n === i ? { ...s, fieldId: e.target.value } : s,
                        ),
                      })
                    }
                  >
                    {fields.map((f) => (
                      <option key={f.id} value={f.id}>
                        {f.name}
                      </option>
                    ))}
                  </select>
                  <select
                    aria-label={t('database.sort')}
                    value={sort.direction}
                    onChange={(e) =>
                      onView({
                        sorts: sorts.map((s, n) =>
                          n === i ? { ...s, direction: e.target.value as 'asc' | 'desc' } : s,
                        ),
                      })
                    }
                  >
                    <option value="asc">{t('database.asc')}</option>
                    <option value="desc">{t('database.desc')}</option>
                  </select>
                  <IconButton
                    label={t('ui.remove')}
                    className="p-1"
                    onClick={() => onView({ sorts: sorts.filter((_, n) => n !== i) })}
                  >
                    <X size={15} />
                  </IconButton>
                </div>
              ))}
              <Button
                disabled={!fields.length}
                onClick={() =>
                  onView({ sorts: [...sorts, { fieldId: fields[0].id, direction: 'asc' }] })
                }
              >
                <Plus size={14} />
                {t('ui.sortAdd')}
              </Button>
            </fieldset>
          </Popover>
          <Popover
            label={t('ui.searchRecords')}
            trigger={
              <IconButton label={t('ui.searchRecords')} className="p-1.5">
                <Search size={16} />
              </IconButton>
            }
          >
            <input
              aria-label={t('ui.searchRecords')}
              placeholder={t('ui.searchRecords')}
              className="w-full"
              value={p.searchQuery ?? ''}
              onChange={(e) => p.onSearchQuery?.(e.target.value)}
            />
          </Popover>
          <Popover
            label={t('ui.viewSettings')}
            trigger={
              <IconButton label={t('ui.viewSettings')} className="p-1.5">
                <SlidersHorizontal size={16} />
              </IconButton>
            }
          >
            <fieldset disabled={readOnly} className="space-y-4">
              <label className="block text-xs text-muted">
                {t('ui.viewName')}
                <input
                  className="mt-1 w-full"
                  aria-label={t('ui.viewName')}
                  value={view.name ?? ''}
                  onChange={(e) => onView({ name: e.target.value })}
                />
              </label>
              <label className="flex items-center justify-between">
                {t('ui.layout')}
                <select
                  aria-label={t('ui.layout')}
                  value={view.layout ?? 'table'}
                  onChange={(e) => onView({ layout: e.target.value as 'table' | 'board' })}
                >
                  <option value="table">{t('database.table')}</option>
                  <option value="board">{t('database.board')}</option>
                </select>
              </label>
              {view.layout === 'board' && (
                <label className="block">
                  {t('ui.group')}
                  <select
                    className="mt-1 w-full"
                    aria-label={t('database.group')}
                    value={view.groupBy ?? ''}
                    onChange={(e) => onView({ groupBy: e.target.value })}
                  >
                    <option value="">{t('ui.group')}</option>
                    {fields
                      .filter((f) => f.type === 'select')
                      .map((f) => (
                        <option key={f.id} value={f.id}>
                          {f.name}
                        </option>
                      ))}
                  </select>
                  {!fields.some((f) => f.type === 'select') && (
                    <Button className="mt-2 text-xs" onClick={onFields}>
                      {t('ui.noGroup')}
                    </Button>
                  )}
                </label>
              )}
              <div>
                <h4 className="mb-2 text-xs text-muted">{t('ui.visible')}</h4>
                {fields.map((f) => (
                  <label key={f.id} className="flex items-center gap-2 py-1.5">
                    <input
                      type="checkbox"
                      disabled={f.type === 'title'}
                      checked={!view.visibleFieldIds?.length || view.visibleFieldIds.includes(f.id)}
                      onChange={(e) => {
                        const visible = view.visibleFieldIds?.length
                          ? view.visibleFieldIds
                          : fields.map((f) => f.id);
                        onView({
                          visibleFieldIds: e.target.checked
                            ? [...visible, f.id]
                            : visible.filter((id) => id !== f.id),
                        });
                      }}
                    />
                    {f.name}
                  </label>
                ))}
              </div>
              <Button className="w-full justify-start border-t border-line" onClick={onFields}>
                {t('database.fields')}
              </Button>
            </fieldset>
          </Popover>
          {p.onMobileTable && (
            <IconButton
              label={t(p.mobileTable ? 'ui.list' : 'ui.table')}
              className="p-1.5 md:hidden"
              onClick={p.onMobileTable}
            >
              {p.mobileTable ? <List size={16} /> : <Table2 size={16} />}
            </IconButton>
          )}
          <Button
            disabled={readOnly}
            variant="primary"
            className="ml-1 px-3 py-1.5 text-xs"
            onClick={onAdd}
          >
            <Plus size={14} />
            {t('common.create')}
          </Button>
        </div>
      </div>
      {(filters.length > 0 || sorts.length > 0 || p.searchQuery) && (
        <div className="flex flex-wrap items-center gap-2 border-b border-line py-2 text-xs text-muted">
          {filters.map((f, i) => (
            <Button
              key={'f' + i}
              className="gap-1 rounded-full border border-line px-2 py-0.5 text-xs"
              disabled={readOnly}
              onClick={() => onView({ filters: filters.filter((_, n) => n !== i) })}
            >
              {fields.find((x) => x.id === f.fieldId)?.name} ·{' '}
              {t(f.op === 'eq' ? 'ui.equals' : f.op === 'contains' ? 'ui.contains' : 'ui.notEmpty')}{' '}
              <X size={12} />
            </Button>
          ))}
          {sorts.map((s, i) => (
            <Button
              key={'s' + i}
              disabled={readOnly}
              className="gap-1 rounded-full border border-line px-2 py-0.5 text-xs"
              onClick={() => onView({ sorts: sorts.filter((_, n) => n !== i) })}
            >
              {fields.find((f) => f.id === s.fieldId)?.name} {s.direction === 'asc' ? '↑' : '↓'}
              <X size={12} />
            </Button>
          ))}
          {p.searchQuery && (
            <Button className="text-xs" onClick={() => p.onSearchQuery?.('')}>
              {p.searchQuery}
              <X size={12} />
            </Button>
          )}
          <span className="ml-auto">{t('database.count', { count: rows.length })}</span>
          <Button
            disabled={readOnly}
            className="text-xs"
            onClick={() => onView({ filters: [], sorts: [] })}
          >
            {t('ui.clear')}
          </Button>
        </div>
      )}
    </>
  );
}
