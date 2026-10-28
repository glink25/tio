import { useT } from '@tio/i18n';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { useNotify } from './overlays';
import { PagedOptions, type OptionsPage, type OptionsState } from './paged-options';

export function usePagedOptions<T>({
  active,
  source,
  queryKey,
  load,
  key,
}: {
  active: boolean;
  source: unknown;
  queryKey: string;
  load: (after?: string) => Promise<OptionsPage<T>>;
  key: (item: T) => string;
}) {
  const notify = useNotify();
  const t = useT();
  const current = useRef({ load, key, notify, t, queryKey, source });
  current.current = { load, key, notify, t, queryKey, source };
  const [state, setState] = useState<OptionsState<T>>({ items: [], loading: false, failed: false });
  const pager = useMemo(
    () =>
      new PagedOptions<T>(
        (item) => current.current.key(item),
        setState,
        () => current.current.notify(current.current.t('database.referenceLoadFailed')),
      ),
    [],
  );
  useEffect(() => {
    pager.reset();
    if (active) void pager.load((after) => current.current.load(after));
    return () => pager.dispose();
  }, [pager, active, source, queryKey]);
  const more = useCallback(() => {
    if (
      active &&
      state.next &&
      current.current.queryKey === queryKey &&
      current.current.source === source
    )
      void pager.load((after) => current.current.load(after), true);
  }, [pager, state.next, active, queryKey, source]);
  return { ...state, more: state.next && !state.failed ? more : undefined };
}
