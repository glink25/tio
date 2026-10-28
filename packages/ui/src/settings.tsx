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
    <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3 py-3">
      <div className="min-w-0 flex-[1_1_10rem]">
        <div className="text-sm font-medium text-ink">{title}</div>
        {description && (
          <div className="mt-1 text-sm leading-relaxed break-words text-muted">{description}</div>
        )}
      </div>
      {children && <div className="flex max-w-full flex-wrap items-center gap-2">{children}</div>}
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
