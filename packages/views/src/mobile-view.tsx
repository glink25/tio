import { useVirtualizer } from '@tanstack/react-virtual';
import { useT } from '@tio/i18n';
import { ChevronRight } from 'lucide-react';
import { useEffect, useRef } from 'react';

import { useDisplayValue } from './display-value';
import { FieldValue } from './field-input';
import type { RowsProps } from './types';
export function MobileView(props: RowsProps) {
  'use no memo';
  const { rows, fields, objects, onOpen, resolve, rowWindow } = props;
  const scroll = useRef<HTMLDivElement>(null);
  // oxlint-disable-next-line react/incompatible-library -- Virtualizer manages its own mutable viewport; do not compiler-memoize this component.
  const virtual = useVirtualizer({
    count: rowWindow?.total ?? rows.length,
    getScrollElement: () => scroll.current,
    estimateSize: () => 120,
    overscan: 5,
    useFlushSync: false,
  });
  const items = virtual.getVirtualItems();
  const first = items[0]?.index ?? 0;
  const last = items.at(-1)?.index ?? 0;
  useEffect(() => {
    rowWindow?.onVisibleRange(first, last);
  }, [first, last, rowWindow]);
  useEffect(() => {
    virtual.scrollToOffset(0);
  }, [rowWindow?.key, virtual]);
  const t = useT();
  const displayValue = useDisplayValue();
  return (
    <div ref={scroll} className="mobile-records max-h-[460px] overflow-auto">
      <div className="relative w-full" style={{ height: virtual.getTotalSize() }}>
        {items.map((item) => {
          const record = rowWindow ? rowWindow.getRow(item.index) : rows[item.index];
          return (
            <div
              key={item.key}
              data-index={item.index}
              ref={virtual.measureElement}
              className="absolute top-0 left-0 w-full"
              style={{ transform: `translateY(${item.start}px)` }}
            >
              {!record ? (
                <div
                  className="h-28 animate-pulse border-b border-line bg-surface"
                  aria-label={t('database.loadingRecords')}
                />
              ) : (
                <div
                  className="relative flex w-full flex-col items-start gap-1.5 border-b border-line px-4 py-3 text-left hover:bg-surface"
                  key={record.id}
                >
                  <button
                    onClick={() => onOpen(record)}
                    className="w-full text-left text-sm font-medium"
                  >
                    {displayValue(
                      record.properties?.[
                        fields.find((f) => f.type === 'title')?.id ?? fields[0]?.id
                      ],
                      fields.find((f) => f.type === 'title') ??
                        fields[0] ?? { id: '', name: '', type: 'text' },
                      objects,
                    ) || t('common.untitled')}
                  </button>
                  <div className="w-full min-w-0 space-y-1 text-xs text-muted">
                    {fields
                      .filter((f) => f.type !== 'title')
                      .map((field) => (
                        <div key={field.id} className="flex min-w-0 items-start gap-2">
                          <span className="shrink-0">{field.name}</span>
                          <FieldValue
                            field={field}
                            value={record.properties?.[field.id]}
                            objects={objects}
                            resolve={resolve}
                            onOpen={onOpen}
                          />
                        </div>
                      ))}
                  </div>
                  <ChevronRight size={15} className="absolute top-5 right-3 text-muted" />
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
