import { id, type Field, type TioObject } from '@tio/core';
import { useT, type TranslationKey } from '@tio/i18n';
import { Button, IconButton } from '@tio/ui';
import { useViewExtensions } from '@tio/views';
import { Plus, X } from 'lucide-react';
import { useState } from 'react';
const types = ['text', 'number', 'boolean', 'date', 'select', 'multiSelect', 'relation'] as const;
export function PropertyEditor({
  database,
  field,
  objects,
  onSave,
  close,
}: {
  database: TioObject;
  field?: Field;
  objects: TioObject[];
  onSave: (field: Field) => void;
  close: () => void;
}) {
  const t = useT();
  const { fields } = useViewExtensions();
  const [draft, setDraft] = useState<Field>(field ?? { id: id('field'), name: '', type: 'text' });
  const patch = (value: Partial<Field>) => setDraft((p) => ({ ...p, ...value }));
  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        if (!draft.name.trim()) return;
        onSave({ ...draft, name: draft.name.trim() });
        close();
      }}
    >
      <label className="block text-xs text-muted">
        {t('database.fieldName')}
        <input
          required
          className="mt-1 w-full"
          aria-label={t('database.fieldName')}
          value={draft.name}
          onChange={(e) => patch({ name: e.target.value })}
        />
      </label>
      <label className="block text-xs text-muted">
        {t('ui.type')}
        <select
          className="mt-1 w-full"
          disabled={!!field}
          aria-label={t('database.newFieldType')}
          value={draft.type}
          onChange={(e) => patch({ type: e.target.value, options: [] })}
        >
          {Object.entries(fields ?? {}).map(([type, definition]) => (
            <option key={type} value={type}>
              {definition.label}
            </option>
          ))}
          {draft.type === 'title' && <option value="title">{t('ui.untitled')}</option>}
          {types.map((type) => (
            <option key={type} value={type}>
              {t(`database.${type}` as TranslationKey)}
            </option>
          ))}
        </select>
      </label>
      {['select', 'multiSelect'].includes(draft.type) && (
        <div>
          <p className="mb-2 text-xs text-muted">{t('ui.options')}</p>
          {draft.options?.map((option) => (
            <div key={option.id} className="mb-2 flex gap-2">
              <input
                aria-label={t('database.optionName')}
                value={option.label}
                onChange={(e) =>
                  patch({
                    options: draft.options!.map((o) =>
                      o.id === option.id ? { ...o, label: e.target.value } : o,
                    ),
                  })
                }
              />
              <IconButton
                label={t('ui.remove')}
                type="button"
                onClick={() => patch({ options: draft.options!.filter((o) => o.id !== option.id) })}
              >
                <X size={14} />
              </IconButton>
            </div>
          ))}
          <Button
            type="button"
            onClick={() =>
              patch({
                options: [
                  ...(draft.options ?? []),
                  { id: id('option'), label: t('database.newOption') },
                ],
              })
            }
          >
            <Plus size={14} />
            {t('database.addOption')}
          </Button>
        </div>
      )}
      {draft.type === 'relation' && (
        <>
          <label className="block">
            {t('database.target')}
            <select
              required
              className="mt-1 w-full"
              aria-label={t('database.target')}
              value={draft.targetDatabaseId ?? ''}
              onChange={(e) => patch({ targetDatabaseId: e.target.value })}
            >
              <option value="">{t('database.chooseTarget')}</option>
              {objects
                .filter(
                  (o) =>
                    o.workspaceId === database.workspaceId && o.type === 'database' && !o.deleted,
                )
                .map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.name}
                  </option>
                ))}
            </select>
          </label>
          <label className="flex gap-2">
            <input
              type="checkbox"
              checked={draft.multiple !== false}
              onChange={(e) => patch({ multiple: e.target.checked })}
            />
            {t('database.multiple')}
          </label>
        </>
      )}
      <div className="flex justify-end gap-2 pt-4">
        <Button type="button" onClick={close}>
          {t('ui.cancel')}
        </Button>
        <Button type="submit" variant="primary">
          {t('ui.done')}
        </Button>
      </div>
    </form>
  );
}
