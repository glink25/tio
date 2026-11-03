import { type RecordWindowQuery, type TioObject } from '@tio/core';
import type { RowWindow } from '@tio/views';
import { useEffect, useRef, useState } from 'react';

import type { EditorController } from './controller';

/** View-owned sparse cache. No record payload is retained for the rest of the table. */
export function useRecordWindow(
  model: EditorController,
  query: Omit<RecordWindowQuery, 'offset' | 'limit'>,
  enabled: boolean,
) {
  const [, render] = useState(0);
  const scope = useRef({}).current;
  const key = JSON.stringify([
    query.databaseId,
    query.view?.id,
    query.view?.filters,
    query.view?.sorts,
    query.text,
  ]);
  const state = useRef({
    key: '',
    generation: 0,
    version: undefined as number | undefined,
    total: 0,
    pages: new Map<number, TioObject[]>(),
    pending: new Set<number>(),
    queued: new Set<number>(),
    errors: new Map<number, string>(),
    start: 0,
    end: 0,
  });
  const live = useRef({ model, query, enabled });
  live.current = { model, query, enabled };
  const publish = () => {
    const s = state.current;
    render((n) => n + 1);
    void live.current.model.runtime
      .useQueryWindow(scope, [...s.pages.values()].flat())
      .catch(() => {});
  };
  const request = (offset: number) => {
    const s = state.current;
    if (
      !live.current.enabled ||
      s.pages.has(offset) ||
      s.pending.has(offset) ||
      s.errors.has(offset)
    )
      return;
    if (s.pending.size >= 2) {
      s.queued.add(offset);
      return;
    }
    s.queued.delete(offset);
    s.pending.add(offset);
    const generation = s.generation;
    void live.current.model.runtime
      .recordWindow({ ...live.current.query, offset, limit: 100, expectedVersion: s.version })
      .then((page) => {
        if (generation !== s.generation) return;
        s.version = page.version;
        s.total = page.total;
        s.pages.set(
          offset,
          page.entries.map((e) => e.projection),
        );
        const center = Math.min(s.start, Math.max(0, s.total - 1));
        // Keep nearby batches. Late far-away requests cannot evict the active viewport.
        const order = [...s.pages.keys()].sort(
          (a, b) => Math.abs(a - center) - Math.abs(b - center),
        );
        for (const index of order.slice(10)) s.pages.delete(index);
        if (s.total && s.start >= s.total) {
          s.start = Math.floor((s.total - 1) / 100) * 100;
          request(s.start);
        }
        publish();
      })
      .catch((error) => {
        if (generation !== s.generation) return;
        if ((error as { code?: string })?.code === 'conflict') {
          s.generation++;
          s.version = undefined;
          s.pages.clear();
          s.pending.clear();
          s.queued.clear();
          s.errors.clear();
          request(Math.floor(s.start / 100) * 100);
        } else {
          s.errors.set(offset, String(error));
          render((n) => n + 1);
        }
      })
      .finally(() => {
        if (generation === s.generation) {
          s.pending.delete(offset);
          const queued = [...s.queued].sort(
            (a, b) => Math.abs(a - s.start) - Math.abs(b - s.start),
          );
          if (queued.length) request(queued[0]);
          render((n) => n + 1);
        }
      });
  };
  useEffect(() => {
    const s = state.current;
    const changed = s.key !== key;
    s.key = key;
    s.generation++;
    s.version = undefined;
    s.pages.clear();
    s.pending.clear();
    s.queued.clear();
    s.errors.clear();
    if (changed) {
      s.start = 0;
      s.end = 0;
      s.total = 0;
    }
    if (enabled) request(Math.floor(s.start / 100) * 100);
    publish();
    return () => {
      s.generation++;
      s.pending.clear();
      s.queued.clear();
    };
    // Query payload is represented by key; publication does not invalidate data versions.
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, [key, enabled, model.runtime, model.state.version]);
  useEffect(() => () => model.runtime.releaseQueryWindow(scope), [model.runtime, scope]);
  const s = state.current;
  const rowWindow: RowWindow = {
    key,
    total: s.total,
    getRow: (index) => s.pages.get(Math.floor(index / 100) * 100)?.[index % 100],
    indexOf: (id) => {
      for (const [offset, rows] of s.pages) {
        const i = rows.findIndex((row) => row.id === id);
        if (i >= 0) return offset + i;
      }
      return -1;
    },
    onVisibleRange: (start, end) => {
      s.start = start;
      s.end = end;
      if (!s.total) return;
      const first = Math.max(0, Math.floor(start / 100) * 100 - 100);
      const last = Math.min(s.total - 1, Math.floor(end / 100) * 100 + 100);
      for (const offset of s.queued) if (offset < first || offset > last) s.queued.delete(offset);
      // Current viewport first; prefetch neighbours afterwards.
      request(Math.floor(start / 100) * 100);
      for (let offset = first; offset <= last; offset += 100) request(offset);
    },
  };
  return {
    rowWindow,
    rows: [...s.pages].sort(([a], [b]) => a - b).flatMap(([, rows]) => rows),
    loading: !!s.pending.size,
    error: [...s.errors.values()][0],
    retry: () => {
      const offsets = [...s.errors.keys()];
      s.errors.clear();
      offsets.forEach(request);
    },
  };
}
