import type { TioObject, Field } from '@tio/core';
import { useT } from '@tio/i18n';
import { Button, IconButton, Modal } from '@tio/ui';
import { Plus, Trash2, ChevronRight } from 'lucide-react';
import { useState } from 'react';

import { PropertyEditor } from './property-editor';
export function FieldManager({
  database,
  objects,
  onChange,
}: {
  database: TioObject;
  objects: TioObject[];
  onChange: (fields: Field[]) => void | Promise<void>;
}) {
  const t = useT();
  const [editing, setEditing] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<Field | null>(null);
  const fields = database.fields ?? [];
  return (
    <>
      {fields.map((f) => (
        <div key={f.id} className="flex items-center border-b border-line py-2">
          <Button className="min-w-0 flex-1 justify-between" onClick={() => setEditing(f.id)}>
            <span className="truncate">{f.name}</span>
            <ChevronRight size={15} />
          </Button>
          {f.type !== 'title' && (
            <IconButton
              label={t('database.deleteField', { name: f.name })}
              onClick={() => setDeleting(f)}
            >
              <Trash2 size={15} />
            </IconButton>
          )}
        </div>
      ))}
      <Button className="mt-3" onClick={() => setEditing('new')}>
        <Plus size={15} />
        {t('database.addField')}
      </Button>
      {editing && (
        <Modal mobilePlacement="center" title={t('ui.editProperty')} close={() => setEditing(null)}>
          <PropertyEditor
            database={database}
            field={fields.find((f) => f.id === editing)}
            objects={objects}
            onSave={(field) =>
              onChange(
                fields.some((f) => f.id === field.id)
                  ? fields.map((f) => (f.id === field.id ? field : f))
                  : [...fields, field],
              )
            }
            close={() => setEditing(null)}
          />
        </Modal>
      )}
      {deleting && (
        <Modal title={t('ui.confirm')} close={() => setDeleting(null)}>
          <p className="mb-4 text-sm">{t('ui.removedField')}</p>
          <Button
            variant="primary"
            onClick={() => {
              void onChange(fields.filter((f) => f.id !== deleting.id));
              setDeleting(null);
            }}
          >
            {t('ui.confirm')}
          </Button>
        </Modal>
      )}
    </>
  );
}
