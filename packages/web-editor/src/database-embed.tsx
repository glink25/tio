import { editable, id, type TioObject } from '@tio/core';
import { useT } from '@tio/i18n';
import { Button, EmptyNotice } from '@tio/ui';
import { DatabaseView } from '@tio/views';
import { ArrowUpRight, Database } from 'lucide-react';
import { useState } from 'react';

import type { EditorController } from './controller';
export function DatabaseEmbed({
  model: m,
  databaseId,
  viewId,
  fullPage = false,
}: {
  model: EditorController;
  databaseId: string;
  viewId?: string;
  fullPage?: boolean;
}) {
  const t = useT();
  const db = m.objects.find((o) => o.id === databaseId);
  const views = m.objects.filter(
    (o) => o.type === 'databaseView' && o.databaseId === databaseId && !o.deleted,
  );
  const key = `tio.view.${m.current?.workspaceId}.${databaseId}`;
  const [selected, setSelected] = useState<string>(() => {
    if (!fullPage) return viewId ?? '';
    try {
      return localStorage.getItem(key) ?? '';
    } catch {
      return '';
    }
  });
  const referenced = views.find((o) => o.id === viewId);
  const view = views.find((o) => o.id === selected) ?? (fullPage ? views[0] : referenced);
  if (!db || db.deleted) return <EmptyNotice>{t('database.missing')}</EmptyNotice>;
  const choose = (next: string) => {
    setSelected(next);
    if (fullPage) {
      try {
        localStorage.setItem(key, next);
      } catch {
        /*optional*/
      }
    }
  };
  const repair = (next: string) => {
    if (!m.current || !m.can(m.current)) return;
    const replace = (blocks: NonNullable<TioObject['blocks']>): NonNullable<TioObject['blocks']> =>
      blocks.map((b) => ({
        ...b,
        props:
          b.type === 'databaseView' &&
          b.props.databaseId === databaseId &&
          b.props.viewId === viewId
            ? { ...b.props, viewId: next }
            : b.props,
        children: replace(b.children),
      }));
    m.changeBlocks(m.current, replace(m.current.blocks ?? []), m.current.blocks ?? []);
    choose(next);
  };
  if (!view || (!fullPage && !referenced))
    return (
      <EmptyNotice>
        <p>{t('ui.viewMissing')}</p>
        {views.length > 0 && m.current && m.can(m.current) && (
          <select aria-label={t('ui.repair')} value="" onChange={(e) => repair(e.target.value)}>
            <option value="">{t('ui.repair')}</option>
            {views.map((v) => (
              <option key={v.id} value={v.id}>
                {v.name}
              </option>
            ))}
          </select>
        )}
      </EmptyNotice>
    );
  if (!editable(db) || !editable(view)) return <EmptyNotice>{t('database.future')}</EmptyNotice>;
  const writable = m.can(db) && m.can(view);
  const createView = (source?: TioObject) => {
    if (!writable) return;
    const next: TioObject = {
      ...(source ?? view),
      id: id('view'),
      name: source ? `${source.name} ${t('ui.copy')}` : t('ui.viewNew'),
      filters: source?.filters ?? [],
      sorts: source?.sorts ?? [],
      deleted: false,
    };
    try {
      m.runtime.create([next]);
      choose(next.id);
    } catch (e) {
      m.setError(String(e));
    }
  };
  return (
    <div className="w-full min-w-0">
      {!fullPage && (
        <div className="mb-2 flex items-center gap-2 text-sm font-medium">
          <Database size={16} />
          <Button className="p-0" onClick={() => m.navigate(db)}>
            {db.name}
            <ArrowUpRight size={14} />
          </Button>
        </div>
      )}
      <DatabaseView
        database={db}
        view={view}
        views={views}
        objects={m.objects}
        readOnly={!writable}
        canEdit={(record, field) => m.can(record, field.id)}
        onCell={m.cell}
        upload={m.upload}
        resolve={m.resolve}
        onOpen={(r) => m.setRecordId(r.id)}
        onAdd={() => m.addRecord(db)}
        onView={(p) => m.patch(view, p)}
        onFields={() => m.setFieldDb(db.id)}
        onSelectView={choose}
        onCreateView={() => createView()}
        onCopyView={() => createView(view)}
        onDeleteView={() => {
          if (views.length < 2 || !writable) return;
          m.patch(view, { deleted: true }, true);
          choose(views.find((v) => v.id !== view.id)!.id);
        }}
        onField={(field) => {
          m.setFieldDb(db.id);
          m.setFieldId(field?.id ?? 'new');
        }}
        onDeleteField={(field) =>
          m.changeFields(
            db,
            (db.fields ?? []).filter((f) => f.id !== field.id),
          )
        }
      />
    </div>
  );
}
