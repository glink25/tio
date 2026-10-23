import type { Field } from '@tio/core';
import { useT } from '@tio/i18n';
import { Button, Menu, MenuItem, MenuSeparator, Modal } from '@tio/ui';
import { useState } from 'react';
import type { ReactNode } from 'react';

import type { RowsProps } from './types';
export function FieldMenu(
  p: RowsProps & {
    field: Field;
    trigger: ReactNode;
    open: boolean;
    onOpenChange: (value: boolean) => void;
  },
) {
  const f = p.field;
  const t = useT();
  const [deleting, setDeleting] = useState<Field | null>(null);
  const all = p.database.fields ?? [];
  const move = (f: Field, delta: number) => {
    const ids = p.view.fieldOrder?.length ? [...p.view.fieldOrder] : all.map((f) => f.id);
    const i = ids.indexOf(f.id);
    if (i < 0 || i + delta < 0 || i + delta >= ids.length) return;
    [ids[i], ids[i + delta]] = [ids[i + delta], ids[i]];
    p.onView({ fieldOrder: ids });
  };
  return (
    <>
      <Menu trigger={p.trigger} open={p.open} onOpenChange={p.onOpenChange}>
        <MenuItem disabled={p.readOnly} onSelect={() => p.onField?.(f)}>
          {t('ui.editProperty')}
        </MenuItem>
        <MenuSeparator />
        <MenuItem
          disabled={p.readOnly}
          onSelect={() =>
            p.onView({
              filters: [...(p.view.filters ?? []), { fieldId: f.id, op: 'contains', value: '' }],
            })
          }
        >
          {t('database.filter')}
        </MenuItem>
        <MenuItem
          disabled={p.readOnly}
          onSelect={() =>
            p.onView({
              sorts: [
                ...(p.view.sorts ?? []).filter((s) => s.fieldId !== f.id),
                { fieldId: f.id, direction: 'asc' },
              ],
            })
          }
        >
          {t('database.asc')}
        </MenuItem>
        <MenuItem
          disabled={p.readOnly}
          onSelect={() =>
            p.onView({
              sorts: [
                ...(p.view.sorts ?? []).filter((s) => s.fieldId !== f.id),
                { fieldId: f.id, direction: 'desc' },
              ],
            })
          }
        >
          {t('database.desc')}
        </MenuItem>
        <MenuSeparator />
        <MenuItem disabled={p.readOnly} onSelect={() => move(f, -1)}>
          {t('ui.left')}
        </MenuItem>
        <MenuItem disabled={p.readOnly} onSelect={() => move(f, 1)}>
          {t('ui.right')}
        </MenuItem>
        <MenuItem
          disabled={p.readOnly || f.type === 'title'}
          onSelect={() =>
            p.onView({
              visibleFieldIds: (p.view.visibleFieldIds?.length
                ? p.view.visibleFieldIds
                : all.map((f) => f.id)
              ).filter((id) => id !== f.id),
            })
          }
        >
          {t('ui.hide')}
        </MenuItem>
        <MenuSeparator />
        <MenuItem
          danger
          disabled={p.readOnly || f.type === 'title'}
          onSelect={() => setDeleting(f)}
        >
          {t('database.deleteField', { name: f.name })}
        </MenuItem>
      </Menu>
      {deleting && (
        <Modal title={t('ui.confirm')} close={() => setDeleting(null)}>
          <p className="mb-4 text-sm">{t('ui.removedField')}</p>
          <div className="flex justify-end gap-2">
            <Button onClick={() => setDeleting(null)}>{t('ui.cancel')}</Button>
            <Button
              variant="primary"
              onClick={() => {
                p.onDeleteField?.(deleting);
                setDeleting(null);
              }}
            >
              {t('ui.confirm')}
            </Button>
          </div>
        </Modal>
      )}
    </>
  );
}
