import { editable } from '@tio/core';
import { Editor } from '@tio/editor-blocknote';
import { useT } from '@tio/i18n';
import { Drawer, IconButton, EmptyNotice } from '@tio/ui';
import { useDisplayValue } from '@tio/views';
import { FieldInput } from '@tio/views';
import { Trash2, Maximize2 } from 'lucide-react';

import type { EditorController } from './controller';
import { DatabaseEmbed } from './database-embed';
import { PageLink } from './page-link';
import { WebSlice } from './web-slice/view';
export function RecordDetail({ model: m }: { model: EditorController }) {
  const t = useT();
  const record = m.record,
    db = m.activeDb;
  if (!record || !db) return null;
  return (
    <Drawer
      title={t('database.detail')}
      close={() => m.setRecordId(null)}
      actions={
        <>
          <IconButton label={t('ui.expand')} className="p-1" onClick={() => m.openFull(record.id)}>
            <Maximize2 size={17} />
          </IconButton>
          <IconButton
            disabled={!m.can(record)}
            label={t('database.deleteRecord')}
            className="p-1"
            onClick={() => {
              m.patch(record, { deleted: true }, true);
              m.setRecordId(null);
            }}
          >
            <Trash2 size={17} />
          </IconButton>
        </>
      }
    >
      <RecordContent model={m} />
    </Drawer>
  );
}

export function RecordContent({ model: m }: { model: EditorController }) {
  const t = useT();
  const displayValue = useDisplayValue();
  const record = m.record,
    db = m.activeDb;
  if (!record || !db) return null;
  return (
    <div className="p-6 sm:px-10 sm:py-9">
      <h1 className="mb-6 text-3xl font-semibold">
        {displayValue(record.properties?.[db.fields?.find((f) => f.type === 'title')?.id ?? ''], {
          id: '',
          name: '',
          type: 'text',
        }) || t('database.recordTitle')}
      </h1>
      <fieldset disabled={m.readOnly || !editable(record) || !editable(db)}>
        {db.fields?.map((f) => (
          <fieldset disabled={!m.can(record, f.id)} key={f.id}>
            <label className="my-3 grid grid-cols-[90px_1fr] items-center gap-4" key={f.id}>
              <span className="text-xs text-muted">{f.name}</span>
              <FieldInput
                field={f}
                value={record.properties?.[f.id]}
                onChange={(v) => m.cell(record, f, v)}
                objects={m.objects}
              />
            </label>
          </fieldset>
        ))}
      </fieldset>
      <hr className="my-8 border-line" />
      {editable(record) ? (
        <Editor
          key={record.id}
          blocks={record.blocks ?? []}
          readOnly={!m.can(record)}
          onChange={(b, p) => m.changeBlocks(record, b, p)}
          upload={m.upload}
          resolve={m.resolve}
          renderWebSlice={(block) => <WebSlice model={m} page={record} block={block} />}
          renderPageReference={(id) => <PageLink model={m} pageId={id} />}
          renderDatabase={(databaseId, viewId) => (
            <DatabaseEmbed model={m} databaseId={databaseId} viewId={viewId} />
          )}
        />
      ) : (
        <EmptyNotice>{t('document.unsupported')}</EmptyNotice>
      )}
    </div>
  );
}
