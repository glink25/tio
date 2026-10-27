import { useT } from '@tio/i18n';
import { ArrowUpRight, Check, ChevronDown, Database, FileText, Search, X } from 'lucide-react';
import { useEffect, useRef, useState, type ReactNode } from 'react';

import { Button } from './index';
import { Command, CommandInput, CommandItem, CommandList, Popover } from './overlays';

export interface ReferenceOption {
  id: string;
  label: ReactNode;
  text: string;
  kind?: 'page' | 'database' | 'record';
}
function ReferenceIcon({ kind }: { kind?: ReferenceOption['kind'] }) {
  const Icon = kind === 'database' ? Database : kind === 'record' ? ArrowUpRight : FileText;
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
  retry,
  more,
  inline = false,
  onActiveChange,
}: {
  label: string;
  selected: ReferenceOption[];
  options: ReferenceOption[];
  query: string;
  onQuery: (query: string) => void;
  onSelect: (id: string) => void;
  onRemove: (id: string) => void;
  loading?: boolean;
  error?: boolean;
  retry?: () => void;
  more?: () => void;
  inline?: boolean;
  onActiveChange?: (active: boolean) => void;
}) {
  const t = useT();
  const inputRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (open || inline) inputRef.current?.focus();
  }, [open, inline]);
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
      <Command
        shouldFilter={false}
        onKeyDownCapture={(event) => {
          if (event.key === 'Escape' && !inline) {
            event.preventDefault();
            event.stopPropagation();
            changeOpen(false);
          }
          if (event.nativeEvent.isComposing && event.key === 'Enter') {
            event.preventDefault();
            event.stopPropagation();
          }
        }}
      >
        <div className="flex items-center gap-2 border-b border-line px-2 pb-2">
          <Search size={15} className="shrink-0 text-muted" aria-hidden />
          <CommandInput
            data-history="native"
            ref={inputRef}
            aria-label={label}
            placeholder={t('database.searchReferences')}
            value={query}
            onValueChange={onQuery}
            className="w-full min-w-0 border-0 bg-transparent px-0 shadow-none outline-none!"
          />
        </div>
        <CommandList aria-label={label} className="max-h-60 overflow-y-auto py-1">
          {loading ? (
            <output className="block p-3 text-xs text-muted">{t('common.loading')}</output>
          ) : error ? (
            <div role="alert" className="p-2 text-xs text-muted">
              {t('database.referenceLoadFailed')}
              <Button type="button" onClick={retry}>
                {t('common.retry')}
              </Button>
            </div>
          ) : (
            <>
              {options.map((item) => (
                <CommandItem
                  key={item.id}
                  value={item.id}
                  onSelect={() => onSelect(item.id)}
                  className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-2 text-sm data-[selected=true]:bg-surface-hover"
                >
                  <ReferenceIcon kind={item.kind} />
                  <span className="min-w-0 flex-1 truncate">{item.label}</span>
                  {selected.some((s) => s.id === item.id) && <Check size={14} aria-hidden />}
                </CommandItem>
              ))}
              {!options.length && (
                <p className="p-3 text-xs text-muted">{t('database.noOptions')}</p>
              )}
            </>
          )}
        </CommandList>
      </Command>
      {more && !loading && !error && (
        <Button type="button" className="w-full text-xs" onClick={more}>
          {t('database.loadMore')}
        </Button>
      )}
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
