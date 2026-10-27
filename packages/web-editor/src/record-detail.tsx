import { editable } from '@tio/core';
import { Editor } from '@tio/editor-blocknote';
import { useT } from '@tio/i18n';
import { Drawer, IconButton, EmptyNotice } from '@tio/ui';
import { useDisplayValue } from '@tio/views';
import { FieldInput, useFieldEvaluator } from '@tio/views';
import { Trash2, Maximize2 } from 'lucide-react';

import type { EditorController } from './controller';
import { DatabaseEmbed } from './database-embed';
import { LoadNotice } from './load-notice';
import { WebSlice } from './web-slice/view';
export function RecordDetail({ model: m }: { model: EditorController }) {
  const t = useT();
  const record = m.record,
    db = m.activeDb;
  if (!record || !db)
    return m.recordId ? (
      <Drawer title={t('database.detail')} close={() => m.setRecordId(null)}>
        <LoadNotice runtime={m.runtime} id={m.recordId} />
      </Drawer>
    ) : null;
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
  const evaluator = useFieldEvaluator(m.objects);
  const record = m.record,
    db = m.activeDb;
  if (!record || !db) return null;
  return (
    <div className={m.current?.type === 'record' ? 'py-6' : 'p-6 sm:px-10 sm:py-9'}>
      <h1 className="mb-6 text-3xl font-semibold">
        {displayValue(record.properties?.[db.fields?.find((f) => f.type === 'title')?.id ?? ''], {
          id: '',
          name: '',
          type: 'text',
        }) || t('database.recordTitle')}
      </h1>
      <div>
        {db.fields?.map((f) => (
          <div key={f.id}>
            <div
              className="my-3 grid min-w-0 grid-cols-1 items-start gap-1.5 sm:grid-cols-[90px_minmax(0,1fr)] sm:gap-4"
              key={f.id}
            >
              <span className="text-xs text-muted">{f.name}</span>
              <FieldInput
                key={
                  ['mention', 'relation'].includes(f.type)
                    ? `${record.id}:${f.id}`
                    : `${record.id}:${f.id}:${JSON.stringify(record.properties?.[f.id])}`
                }
                field={f}
                record={record}
                readOnly={m.readOnly || !editable(record) || !editable(db) || !m.can(record, f.id)}
                upload={m.upload}
                resolve={m.resolve}
                onOpen={(r) => m.setRecordId(r.id)}
                value={evaluator.value(record, f)}
                onChange={(v) => m.cell(record, f, v)}
                objects={m.objects}
              />
            </div>
          </div>
        ))}
      </div>
      <section
        aria-label={t('database.recordBody')}
        className="mt-8 border-t border-line pt-6 [&_.bn-editor]:min-h-28 [&_.bn-editor]:cursor-text"
      >
        <h2 className="mb-3 text-xs font-medium text-muted">{t('database.recordBody')}</h2>
        {editable(record) ? (
          <Editor
            key={record.id}
            placeholder={t('database.recordBodyPlaceholder')}
            blocks={record.blocks ?? []}
            readOnly={!m.can(record)}
            onChange={(b, p) => m.changeBlocks(record, b, p)}
            upload={m.upload}
            resolve={m.resolve}
            renderWebSlice={(block) => <WebSlice model={m} page={record} block={block} />}
            renderDatabase={(databaseId, viewId) => (
              <DatabaseEmbed model={m} databaseId={databaseId} viewId={viewId} />
            )}
          />
        ) : (
          <EmptyNotice>{t('document.unsupported')}</EmptyNotice>
        )}
      </section>
    </div>
  );
}
