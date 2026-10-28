import { HostError } from '@tio/core';
import { EditorSchemaContext } from '@tio/editor-blocknote';
import { useT } from '@tio/i18n';
import { MenuItem, MenuSeparator, MenuSub, useNotify } from '@tio/ui';
import { Upload, Download } from 'lucide-react';
import { useContext, useRef, useState } from 'react';

import type { EditorController, EditorSurfaceProps } from '../controller';
import type { PageExportInput } from '../page-export/shared';

type Format = 'markdown' | 'pdf' | 'csv' | 'xlsx';
export function useTransferMenu(m: EditorController, props: EditorSurfaceProps) {
  const t = useT();
  const notify = useNotify();
  const schema = useContext(EditorSchemaContext);
  const picker = useRef<HTMLInputElement>(null);
  const busyRef = useRef(false);
  const [busy, setBusy] = useState(false);
  const [importFormat, setImportFormat] = useState<Format>('markdown');
  const current = m.current;
  if (!current || !['page', 'database'].includes(current.type)) return { menu: null, picker: null };
  const isPage = current.type === 'page';
  const guard = () => {
    if (
      !m.runtime.can(current, 'update') ||
      m.readOnly ||
      !m.runtime.snapshot().some((o) => o.id === current.id && !o.deleted)
    )
      throw new HostError('permission');
  };
  const run = async (action: () => Promise<void>, importing = false) => {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    notify(t(importing ? 'transfer.importing' : 'page.exporting'));
    try {
      await action();
    } catch (error) {
      notify(t(importing ? 'transfer.importFailed' : 'page.exportFailed'));
      props.onError?.(error);
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  };
  const readMetadata: PageExportInput['readMetadata'] = async (ids) => {
    const snapshot = await m.runtime.mentionMetadata(ids);
    return snapshot.entries
      .filter(
        (entry) =>
          !snapshot.denied?.includes(entry.object.id) && m.runtime.can(entry.object, 'read'),
      )
      .map((entry) => entry.object);
  };
  const exportFile = (format: Format) =>
    run(async () => {
      if (isPage) {
        const input: PageExportInput = {
          page: structuredClone(current),
          objects: m.runtime.snapshot(),
          readAsset: (id) => m.runtime.readAsset(id),
          readMetadata,
          labels: {
            untitled: t('common.untitled'),
            unavailable: t('page.exportUnavailable'),
            unsupported: t('page.exportUnsupported'),
          },
        };
        if (format === 'markdown')
          await (await import('../page-export/export-markdown')).exportMarkdown(input);
        else await (await import('../page-export/export-pdf')).exportPDF(input);
      } else {
        const { database, records, objects } = await m.runtime.databaseSnapshot(current.id);
        const { exportTable } = await import('./table');
        const { download, filename } = await import('../page-export/shared');
        const table = exportTable(database, records, objects, format === 'xlsx');
        const blob =
          format === 'csv'
            ? (await import('./csv')).writeCSV(table)
            : await (await import('./xlsx')).writeXLSX(table);
        download(blob, `${filename(table.name)}.${format}`);
      }
    });
  const importFile = (file: File) =>
    run(async () => {
      guard();
      if (file.size > 100 * 1024 * 1024) throw new HostError('invalid');
      let firstId: string;
      if (importFormat === 'markdown') {
        const result = await (
          await import('./markdown')
        ).importMarkdown(file, props.workspaceId, current.id, schema);
        guard();
        m.runtime.create(result.objects, undefined, result.assets);
        firstId = result.firstId;
      } else {
        const name = file.name.replace(/\.(csv|xlsx)$/i, '');
        const tables =
          importFormat === 'csv'
            ? [(await import('./csv')).readCSV(await file.text(), name)]
            : await (
                await import('./xlsx')
              ).readXLSX(new Uint8Array(await file.arrayBuffer()), name);
        const { importTable } = await import('./table');
        const objects = tables.flatMap((table) =>
          importTable(table, props.workspaceId, current.id),
        );
        guard();
        m.runtime.create(objects);
        firstId = objects[0].id;
      }
      await m.runtime.flush();
      notify(t('transfer.imported'));
      props.onNavigate({ id: firstId });
    }, true);
  const choose = (format: Format) => {
    setImportFormat(format);
    const input = picker.current;
    if (!input) return;
    input.accept = format === 'markdown' ? '.md,.markdown,.zip' : `.${format}`;
    input.click();
  };
  return {
    menu: (
      <>
        <MenuSeparator />
        <MenuSub
          disabled={busy || !m.can(current)}
          label={
            <>
              <Upload size={15} />
              {t('transfer.import')}
            </>
          }
        >
          {isPage ? (
            <MenuItem onSelect={() => choose('markdown')}>Markdown</MenuItem>
          ) : (
            <>
              <MenuItem onSelect={() => choose('csv')}>CSV</MenuItem>
              <MenuItem onSelect={() => choose('xlsx')}>XLSX</MenuItem>
            </>
          )}
        </MenuSub>
        <MenuSub
          disabled={busy}
          label={
            <>
              <Download size={15} />
              {t('transfer.export')}
            </>
          }
        >
          {(isPage ? (['markdown', 'pdf'] as const) : (['csv', 'xlsx'] as const)).map((format) => (
            <MenuItem key={format} onSelect={() => void exportFile(format)}>
              {format === 'markdown' ? 'Markdown' : format.toUpperCase()}
            </MenuItem>
          ))}
        </MenuSub>
      </>
    ),
    picker: (
      <input
        ref={picker}
        type="file"
        className="hidden"
        aria-label={t('transfer.import')}
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = '';
          if (file) void importFile(file);
        }}
      />
    ),
  };
}
