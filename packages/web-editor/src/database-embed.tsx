import { editable, id, type TioObject } from '@tio/core';
import { useT } from '@tio/i18n';
import { Button, EmptyNotice } from '@tio/ui';
import { DatabaseView } from '@tio/views';
import { ArrowUpRight, Database } from 'lucide-react';
import { useEffect, useState } from 'react';

import type { EditorController } from './controller';
import { LoadNotice } from './load-notice';
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
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    let live = true;
    const release = m.runtime.retain([databaseId]);
    setLoaded(false);
    setLoadError('');
    void m.runtime
      .loadDatabase(databaseId)
      .then(() => {
        if (live) setLoaded(true);
      })
      .catch((error) => {
        if (live) setLoadError(String(error));
      });
    return () => {
      live = false;
      release();
    };
  }, [m.runtime, databaseId, retry]);
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
  const [rows, setRows] = useState<TioObject[]>([]);
  const [next, setNext] = useState<string | undefined>();
  const [cursor, setCursor] = useState<string | undefined>();
  const [queryText, setQueryText] = useState('');
  const [querying, setQuerying] = useState(false);
  const viewKey = JSON.stringify(view);
  useEffect(() => {
    setCursor(undefined);
    setRows([]);
  }, [databaseId, viewKey, queryText]);
  useEffect(() => {
    if (!loaded || !view) return;
    let live = true;
    setQuerying(true);
    void m.runtime
      .records({ databaseId, view, text: queryText, after: cursor, limit: 100 })
      .then((page) => {
        if (!live) return;
        setRows(page.entries.map((e) => e.object));
        setNext(page.next);
        setQuerying(false);
      })
      .catch((error) => {
        if (live) {
          setLoadError(String(error));
          setQuerying(false);
        }
      });
    return () => {
      live = false;
    };
    // Query results update the projection; only view definitions and completed writes invalidate queries.
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, [
    m.runtime,
    databaseId,
    loaded,
    viewKey,
    queryText,
    cursor,
    m.state.pending,
    m.state.version,
    retry,
  ]);
  const rowIds = rows.map((row) => row.id).join(',');
  useEffect(() => m.runtime.retain(rowIds ? rowIds.split(',') : []), [m.runtime, rowIds]);
  if (loadError)
    return (
      <EmptyNotice>
        {loadError}
        <Button onClick={() => setRetry((n) => n + 1)}>{t('common.retry')}</Button>
      </EmptyNotice>
    );
  if (!loaded) return <LoadNotice runtime={m.runtime} id={databaseId} loading />;
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
        queriedRows={rows
          .map((row) => m.objects.find((o) => o.id === row.id) ?? row)
          .filter((o) => !o.deleted)}
        queryText={queryText}
        onQueryText={setQueryText}
        readOnly={!writable}
        onDeleteRecords={m.deleteRecords}
        canDeleteRecord={m.canDeleteRecord}
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
      {querying && <output>{t('common.loading')}</output>}
      <div className="flex gap-2">
        {cursor && <Button onClick={() => setCursor(undefined)}>←</Button>}
        {next && (
          <Button disabled={querying} onClick={() => setCursor(next)}>
            →
          </Button>
        )}
      </div>
    </div>
  );
}
