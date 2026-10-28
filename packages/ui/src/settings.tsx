import type { ReactNode } from 'react';

import { Button } from './index';

export function SettingsGroup({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="space-y-1">
      <h3 className="mb-2 border-b border-line pb-3 text-sm font-semibold">{title}</h3>
      {children}
    </section>
  );
}
export function SettingsRow({
  title,
  description,
  children,
}: {
  title: ReactNode;
  description?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-3 py-4 sm:flex-row sm:items-center sm:justify-between sm:gap-8">
      <div className="min-w-0 flex-1">
        <div className="text-sm font-medium text-ink">{title}</div>
        {description && (
          <div className="mt-1 text-sm leading-relaxed break-words text-muted">{description}</div>
        )}
      </div>
      {children && (
        <div className="flex shrink-0 items-center gap-2 self-start sm:self-center">{children}</div>
      )}
    </div>
  );
}
export function SettingsAction({
  danger,
  ...props
}: React.ComponentProps<typeof Button> & { danger?: boolean }) {
  return (
    <Button
      {...props}
      variant="outline"
      className={
        danger
          ? 'h-9 border-red-500/20 bg-red-500/10 text-red-600 hover:bg-red-500/15 dark:text-red-400'
          : 'h-9'
      }
    />
  );
}
