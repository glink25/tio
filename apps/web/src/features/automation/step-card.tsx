import { useT } from '@tio/i18n';
import { Button, IconButton, cn } from '@tio/ui';
import { ChevronDown, ChevronUp } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
export function StepCard({
  number,
  title,
  children,
  menu,
  issueKey,
  invalid,
  reveal,
}: {
  number: number;
  title: string;
  children: ReactNode;
  menu?: ReactNode;
  issueKey: string;
  invalid?: boolean;
  reveal: number;
}) {
  const t = useT();
  const [expanded, setExpanded] = useState(true);
  useEffect(() => {
    if (invalid) setExpanded(true);
  }, [invalid, reveal]);
  return (
    <section
      data-issue={issueKey}
      tabIndex={-1}
      aria-label={t('automation.step', { number })}
      className="relative outline-none"
    >
      <div className="mb-3 flex items-center gap-2 text-xs text-muted">
        <span className="size-2.5 rounded-full border border-secondary" />
        {t('automation.step', { number })}
      </div>
      <div
        className={cn(
          'rounded-xl border border-line bg-panel shadow-sm',
          invalid && 'border-red-400',
        )}
      >
        <div className="flex items-center gap-2 px-4 py-3">
          <Button
            onClick={() => setExpanded((value) => !value)}
            className="min-w-0 flex-1 justify-start gap-2 px-0 font-medium"
          >
            <span className="truncate">{title}</span>
          </Button>
          {menu}
          <IconButton
            label={expanded ? t('automation.collapseStep') : t('automation.expandStep')}
            onClick={() => setExpanded((value) => !value)}
            className="p-1"
          >
            {expanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
          </IconButton>
        </div>
        {expanded && <div className="space-y-4 px-4 pb-5 md:px-5">{children}</div>}
      </div>
    </section>
  );
}
