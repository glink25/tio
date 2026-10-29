import { useT } from '@tio/i18n';
import { LoaderCircle } from 'lucide-react';

import { cn } from './index';
export const readingLayout =
  'mx-auto w-full max-w-[856px] min-w-0 px-5 pt-10 pb-24 md:px-12 md:pt-16';
export function LoadingSkeleton({
  layout = 'document',
}: {
  layout?: 'document' | 'list' | 'inline';
}) {
  const t = useT();
  return (
    <output
      aria-label={t('common.loading')}
      aria-busy="true"
      className={cn(
        'block animate-pulse space-y-4 motion-reduce:animate-none',
        layout === 'document' ? readingLayout : layout === 'list' ? 'w-full py-2' : 'w-full p-6',
      )}
    >
      <span aria-hidden="true" className="block h-8 w-2/3 rounded bg-surface-hover" />
      {(layout === 'list' ? [1, 2, 3, 4] : [1, 2, 3]).map((row) => (
        <span
          aria-hidden="true"
          key={row}
          className={cn(
            'block rounded bg-surface-hover',
            layout === 'list' ? 'h-16 w-full' : row === 3 ? 'h-4 w-4/5' : 'h-4 w-full',
          )}
        />
      ))}
    </output>
  );
}

export function LoadingIndicator({ label, className }: { label?: string; className?: string }) {
  const t = useT();
  return (
    <output
      aria-label={label ?? t('status.loading')}
      aria-busy="true"
      className={cn('inline-flex items-center justify-center p-2 text-muted', className)}
    >
      <LoaderCircle
        aria-hidden="true"
        size={18}
        className="animate-spin motion-reduce:animate-none"
      />
    </output>
  );
}

/** Mirrors the navigation landmarks without introducing focusable placeholders. */
export function SidebarSkeleton() {
  const t = useT();
  const bar = 'rounded bg-ink/[0.07] dark:bg-ink/10';
  return (
    <output
      aria-label={t('common.loading')}
      aria-busy="true"
      className="flex h-full min-h-0 flex-col gap-6 px-4 py-5 motion-safe:animate-pulse"
    >
      <div aria-hidden="true" className="flex items-center gap-2">
        <span className={`${bar} size-6`} />
        <span className={`${bar} h-4 w-28`} />
        <span className={`${bar} ml-auto size-3`} />
      </div>
      <div aria-hidden="true" className="space-y-4">
        {[96, 76].map((width) => (
          <div key={width} className="flex items-center gap-3">
            <span className={`${bar} size-4`} />
            <span className={`${bar} h-3`} style={{ width }} />
          </div>
        ))}
      </div>
      <div aria-hidden="true" className="min-h-0 flex-1 space-y-4 overflow-hidden">
        <span className={`${bar} mb-5 block h-2 w-12`} />
        {[132, 108, 86, 116, 94, 124, 76].map((width, index) => (
          <div
            key={index}
            className="flex h-6 items-center gap-2"
            style={{ paddingLeft: [2, 18, 34, 18, 2, 18, 2][index] }}
          >
            <span className={`${bar} size-2 shrink-0`} />
            <span className={`${bar} h-4 w-3 shrink-0`} />
            <span className={`${bar} h-3`} style={{ width }} />
          </div>
        ))}
      </div>
      <div aria-hidden="true" className="flex items-center gap-3 border-t border-line pt-4">
        <span className={`${bar} size-6 rounded-full`} />
        <span className={`${bar} h-3 w-28`} />
      </div>
    </output>
  );
}
