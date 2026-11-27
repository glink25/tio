import { ChevronRight } from 'lucide-react';
import type { ReactNode } from 'react';

import { Button, cn } from './index';

export function SettingsGroup({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="space-y-2">
      <h3 className="px-1 text-sm font-semibold text-secondary">{title}</h3>
      <div className="divide-y divide-line rounded-xl border border-line px-3 sm:px-4">
        {children}
      </div>
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
    <div className="flex min-h-13 flex-wrap items-center justify-between gap-x-5 gap-y-2 py-3">
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
  className,
  ...props
}: React.ComponentProps<typeof Button> & { danger?: boolean }) {
  return (
    <Button
      {...props}
      variant="outline"
      className={cn(
        danger
          ? 'h-9 border-red-500/20 bg-red-500/10 text-red-600 hover:bg-red-500/15 dark:text-red-400'
          : 'h-9',
        className,
      )}
    />
  );
}

export function SettingsLink({
  label,
  icon,
  open,
}: {
  label: string;
  icon?: ReactNode;
  open: () => void;
}) {
  return (
    <Button
      type="button"
      className="min-h-12 w-full justify-start gap-3 rounded-lg px-3 py-2.5 text-left font-medium text-ink"
      onClick={open}
    >
      {icon && <span className="shrink-0 text-secondary">{icon}</span>}
      <span className="min-w-0 flex-1 wrap-break-word">{label}</span>
      <ChevronRight aria-hidden size={16} className="shrink-0 text-muted" />
    </Button>
  );
}

export function SettingsField({
  label,
  children,
  htmlFor,
}: {
  label: string;
  children: ReactNode;
  htmlFor?: string;
}) {
  const title = <span className="text-sm font-medium">{label}</span>;
  return htmlFor ? (
    <div className="grid min-w-0 gap-1.5">
      <label htmlFor={htmlFor}>{title}</label>
      {children}
    </div>
  ) : (
    <label className="grid min-w-0 gap-1.5">
      {title}
      {children}
    </label>
  );
}

export function SettingsFormActions({ children }: { children: ReactNode }) {
  return (
    <div className="flex flex-wrap justify-end gap-2 border-t border-line pt-4">{children}</div>
  );
}
