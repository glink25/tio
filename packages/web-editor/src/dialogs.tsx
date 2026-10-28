import { useT } from '@tio/i18n';
import { Button, Modal, OptionsPanel } from '@tio/ui';
import { Database, Plus } from 'lucide-react';

import type { EditorController } from './controller';
import { FieldManager } from './field-manager';
import { PropertyEditor } from './property-editor';
import { RecordDetail } from './record-detail';
export function EditorDialogs({ model: m }: { model: EditorController }) {
  const t = useT();
  return (
    <>
      {m.recordId && <RecordDetail model={m} />}
      {m.fieldTarget && (
        <Modal
          mobilePlacement={m.fieldId ? 'center' : 'sheet'}
          title={t('database.fieldManager')}
          close={() => m.setFieldDb(null)}
        >
          {m.fieldId ? (
            <PropertyEditor
              database={m.fieldTarget}
              field={m.fieldTarget.fields?.find((f) => f.id === m.fieldId)}
              objects={m.objects}
              onSave={(field) =>
                m.changeFields(
                  m.fieldTarget!,
                  m.fieldTarget!.fields?.some((f) => f.id === field.id)
                    ? m.fieldTarget!.fields!.map((f) => (f.id === field.id ? field : f))
                    : [...(m.fieldTarget!.fields ?? []), field],
                )
              }
              close={() => m.setFieldDb(null)}
            />
          ) : (
            <fieldset disabled={!m.can(m.fieldTarget)}>
              <FieldManager
                database={m.fieldTarget}
                objects={m.objects}
                onChange={(fields) => m.changeFields(m.fieldTarget!, fields)}
              />
            </fieldset>
          )}
        </Modal>
      )}
      {m.embedPicker && (
        <Modal
          title={t('document.embedTitle')}
          description={t('document.embedHint')}
          close={() => m.setEmbedPicker(false)}
        >
          <Button variant="primary" onClick={() => m.addDatabase(true)}>
            <Plus size={15} />
            {t('document.createEmbed')}
          </Button>
          <div className="mt-4">
            <OptionsPanel
              label={t('document.embedTitle')}
              options={m.objects
                .filter((o) => o.type === 'database' && !o.deleted)
                .map((db) => ({
                  id: db.id,
                  text: db.name ?? '',
                  label: db.name,
                  icon: <Database size={16} />,
                }))}
              onSelect={(id) => {
                const database = m.objects.find((o) => o.id === id);
                if (database) m.embed(database);
              }}
            />
          </div>
        </Modal>
      )}
    </>
  );
}
