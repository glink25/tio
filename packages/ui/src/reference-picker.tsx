import { useT } from '@tio/i18n';
import { ArrowUpRight, ChevronDown, Database, FileText, UserRound, X } from 'lucide-react';
import { useState, type ReactNode } from 'react';

import { Button } from './index';
import { OptionsPanel, type ChoiceTab } from './options-panel';
import { Popover } from './overlays';

export interface ReferenceOption {
  id: string;
  label: ReactNode;
  text: string;
  kind?: 'page' | 'database' | 'record' | 'github-user';
}
export function ReferenceIcon({ kind }: { kind?: ReferenceOption['kind'] }) {
  const Icon =
    kind === 'database'
      ? Database
      : kind === 'record'
        ? ArrowUpRight
        : kind === 'github-user'
          ? UserRound
          : FileText;
  return <Icon size={14} className="shrink-0 text-muted" aria-hidden />;
}
/** Presentation only: adapters own querying and stable reference identities. */
export function ReferencePicker({
  label,
  selected,
  options,
  query,
  onQuery,
  onSelect,
  onRemove,
  loading,
  error,
  more,
  inline = false,
  onActiveChange,
  tabs,
  tab,
  onTab,
  multiple = true,
}: {
  tabs?: ChoiceTab[];
  tab?: string;
  onTab?: (id: string) => void;
  multiple?: boolean;
  label: string;
  selected: ReferenceOption[];
  options: ReferenceOption[];
  query: string;
  onQuery: (query: string) => void;
  onSelect: (id: string) => void;
  onRemove: (id: string) => void;
  loading?: boolean;
  error?: boolean;
  more?: () => void;
  inline?: boolean;
  onActiveChange?: (active: boolean) => void;
}) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const changeOpen = (next: boolean) => {
    setOpen(next);
    onActiveChange?.(next);
  };
  const tokens = selected.length > 0 && (
    <div className="flex min-w-0 flex-1 flex-wrap gap-1.5">
      {selected.map((item) => (
        <span
          key={item.id}
          className="inline-flex max-w-full items-center gap-1 rounded-md bg-surface px-2 py-1 text-sm"
        >
          <ReferenceIcon kind={item.kind} />
          <span className="min-w-0 truncate">{item.label}</span>
          <button
            type="button"
            aria-label={t('database.removeReference', { name: item.text })}
            className="shrink-0 rounded p-0.5 text-muted hover:bg-surface-hover"
            onClick={() => onRemove(item.id)}
          >
            <X size={12} />
          </button>
        </span>
      ))}
    </div>
  );
  const content = (
    <div className="space-y-2">
      {inline && tokens}
      <OptionsPanel
        label={label}
        options={options.map((item) => ({ ...item, icon: <ReferenceIcon kind={item.kind} /> }))}
        selected={selected.map((item) => item.id)}
        query={query}
        onQuery={onQuery}
        remote
        loading={loading}
        more={!error ? more : undefined}
        tabs={tabs}
        tab={tab}
        onTab={onTab}
        onClose={() => changeOpen(false)}
        onSelect={(id) => {
          onSelect(id);
          if (!multiple) changeOpen(false);
        }}
      />
    </div>
  );
  if (inline) return content;
  return (
    <div className="flex min-h-10 items-center gap-1 rounded-md border border-line bg-panel p-1">
      {tokens}
      <Popover
        open={open}
        onOpenChange={changeOpen}
        label={label}
        align="end"
        className="w-[min(360px,calc(100vw-24px))]"
        trigger={
          <Button
            type="button"
            variant="ghost"
            className={selected.length ? 'h-8 w-8 px-1' : 'w-full justify-between text-left'}
            aria-label={label}
            aria-haspopup="listbox"
            aria-expanded={open}
          >
            {!selected.length && (
              <span className="truncate text-muted">{t('database.chooseReference')}</span>
            )}
            <ChevronDown size={14} className="shrink-0 text-muted" />
          </Button>
        }
      >
        {content}
      </Popover>
    </div>
  );
}
