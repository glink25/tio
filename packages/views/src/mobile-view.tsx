import { useT } from '@tio/i18n';
import { ChevronRight } from 'lucide-react';

import { useDisplayValue } from './display-value';
import { FieldValue } from './field-input';
import type { RowsProps } from './types';
export function MobileView({ rows, fields, objects, onOpen, resolve }: RowsProps) {
  const t = useT();
  const displayValue = useDisplayValue();
  return (
    <div className="mobile-records">
      {rows.map((record) => (
        <div
          className="relative flex w-full flex-col items-start gap-1.5 border-b border-line px-4 py-3 text-left hover:bg-surface"
          key={record.id}
        >
          <button onClick={() => onOpen(record)} className="w-full text-left text-sm font-medium">
            {displayValue(
              record.properties?.[fields.find((f) => f.type === 'title')?.id ?? fields[0]?.id],
              fields.find((f) => f.type === 'title') ??
                fields[0] ?? { id: '', name: '', type: 'text' },
              objects,
            ) || t('common.untitled')}
          </button>
          <div className="w-full min-w-0 space-y-1 text-xs text-muted">
            {fields
              .filter((f) => f.type !== 'title')
              .map((field) => (
                <FieldValue
                  key={field.id}
                  field={field}
                  value={record.properties?.[field.id]}
                  objects={objects}
                  resolve={resolve}
                  onOpen={onOpen}
                />
              ))}
          </div>
          <ChevronRight size={15} className="absolute top-5 right-3 text-muted" />
        </div>
      ))}
    </div>
  );
}
