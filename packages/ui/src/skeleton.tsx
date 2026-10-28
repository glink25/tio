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
