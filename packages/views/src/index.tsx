import { queryRecords } from '@tio/database';
import { useT, useTranslation } from '@tio/i18n';
import { Button, useMobile } from '@tio/ui';
import { Plus } from 'lucide-react';
import { useState, lazy, Suspense } from 'react';

import { BoardView } from './board-view';
import { useDisplayValue, useFieldEvaluator } from './display-value';
import { useViewExtensions } from './extensions';
import { MobileView } from './mobile-view';
import { QueryToolbar } from './query-toolbar';
import type { ViewProps } from './types';
const GridView = lazy(() => import('./grid-view').then((m) => ({ default: m.GridView })));
export { FieldInput, FieldValue } from './field-input';
export { useFieldEvaluator } from './display-value';
export function DatabaseView(props: ViewProps) {
  const t = useT();
  const displayValue = useDisplayValue();
  const { layouts } = useViewExtensions();
  const Custom = layouts?.[props.view.layout ?? 'table']?.Component;
  useTranslation();
  const { database, view, objects, onAdd } = props;
  const evaluator = useFieldEvaluator(objects);
  const [localSearch, setLocalSearch] = useState('');
  const searchQuery = props.queryText ?? localSearch;
  const setSearchQuery = props.onQueryText ?? setLocalSearch;
  const preferenceKey = `tio.mobile-table.${database.workspaceId}.${database.id}`;
  const [tablePreferences, setTablePreferences] = useState<Record<string, boolean>>({});
  let storedTable = false;
  try {
    storedTable = localStorage.getItem(preferenceKey) === 'true';
  } catch {
    /* optional preference */
  }
  const mobileTable = tablePreferences[preferenceKey] ?? storedTable;
  const mobile = useMobile();
  const rows =
    props.queriedRows ??
    queryRecords(objects, database, view, evaluator).filter(
      (record) =>
        !searchQuery ||
        database.fields?.some((field) =>
          displayValue(record.properties?.[field.id], field, objects)
            .toLocaleLowerCase()
            .includes(searchQuery.toLocaleLowerCase()),
        ),
    );
  const order = view.fieldOrder ?? database.fields?.map((f) => f.id) ?? [];
  const fields = [...(database.fields ?? [])]
    .filter(
      (f) =>
        f.type === 'title' || !view.visibleFieldIds?.length || view.visibleFieldIds.includes(f.id),
    )
    .sort(
      (a, b) =>
        (order.indexOf(a.id) < 0 ? 999 : order.indexOf(a.id)) -
        (order.indexOf(b.id) < 0 ? 999 : order.indexOf(b.id)),
    );
  const childProps = {
    ...props,
    rows,
    fields,
    searchQuery,
    onSearchQuery: setSearchQuery,
    mobileTable,
    onMobileTable: () => {
      const next = !mobileTable;
      setTablePreferences((previous) => ({ ...previous, [preferenceKey]: next }));
      try {
        localStorage.setItem(preferenceKey, String(next));
      } catch {
        /* optional preference */
      }
    },
  };
  return (
    <div className="min-w-0 bg-panel font-normal">
      <QueryToolbar {...childProps} />
      {Custom ? (
        <Custom {...childProps} />
      ) : view.layout && !['table', 'board'].includes(view.layout) ? (
        <div className="p-4 text-muted">Unsupported view: {view.layout}</div>
      ) : view.layout === 'board' ? (
        <BoardView {...childProps} />
      ) : mobile && !mobileTable ? (
        <MobileView {...childProps} />
      ) : (
        <Suspense fallback={<div className="p-8 text-xs text-muted">{t('common.loading')}</div>}>
          <GridView {...childProps} />
        </Suspense>
      )}
      <Button
        className="w-full justify-start rounded-none border-t border-line px-4 py-2.5 text-xs text-muted"
        disabled={props.readOnly}
        onClick={onAdd}
      >
        <Plus size={13} />
        {t('database.addRecord')}
      </Button>
    </div>
  );
}

export { displayValue, useDisplayValue } from './display-value';

export {
  ViewExtensionsContext,
  useViewExtensions,
  type ViewExtensions,
  type FieldInputProps,
} from './extensions';
export type { ViewProps, RowsProps } from './types';

export { RecordQueryContext } from './extensions';
