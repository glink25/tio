import { useT } from '@tio/i18n';
import { ChevronRight } from 'lucide-react';

import { useDisplayValue } from './display-value';
import type { RowsProps } from './types';
export function MobileView({ rows, fields, objects, onOpen }: RowsProps) {
  const t = useT();
  const displayValue = useDisplayValue();
  return (
    <div className="mobile-records">
      {rows.map((record) => (
        <button
          className="relative flex w-full flex-col items-start gap-1.5 border-b border-line px-4 py-3 text-left hover:bg-surface"
          key={record.id}
          onClick={() => onOpen(record)}
        >
          <strong className="text-sm font-medium">
            {displayValue(
              record.properties?.[fields.find((f) => f.type === 'title')?.id ?? fields[0]?.id],
              fields.find((f) => f.type === 'title') ??
                fields[0] ?? { id: '', name: '', type: 'text' },
              objects,
            ) || t('common.untitled')}
          </strong>
          <span className="text-xs text-muted">
            {fields
              .filter((f) => f.type !== 'title')
              .map((f) => displayValue(record.properties?.[f.id], f, objects))
              .filter(Boolean)
              .join(' · ')}
          </span>
          <ChevronRight size={15} className="absolute top-5 right-3 text-muted" />
        </button>
      ))}
    </div>
  );
}
