import { useT } from '@tio/i18n';
import { Check, Search } from 'lucide-react';
import { useEffect, useRef, useState, type ReactNode } from 'react';

import {
  Command,
  CommandInput,
  CommandItem,
  CommandList,
  CommandEmpty,
  CommandGroup,
} from './overlays';
import { LoadingIndicator } from './skeleton';

export interface ChoiceOption {
  id: string;
  label: ReactNode;
  text: string;
  icon?: ReactNode;
  group?: string;
  disabled?: boolean;
}
export interface ChoiceTab {
  id: string;
  label: string;
}
export interface OptionsPanelProps {
  label: string;
  onListId?: (id: string) => void;
  options: ChoiceOption[];
  selected?: string[];
  onSelect: (id: string) => void;
  query?: string;
  onQuery?: (query: string) => void;
  search?: boolean;
  remote?: boolean;
  loading?: boolean;
  more?: () => void;
  tabs?: ChoiceTab[];
  tab?: string;
  onTab?: (id: string) => void;
  onClose?: () => void;
  onHighlight?: (id: string) => void;
  externalInput?: HTMLElement | null;
}
/** Shared list surface; data adapters own queries and cursors. */
export function OptionsPanel({
  label,
  options,
  selected = [],
  onSelect,
  query,
  onQuery,
  search = true,
  remote = false,
  loading,
  more,
  tabs,
  tab,
  onTab,
  onClose,
  externalInput,
  onHighlight,
  onListId,
}: OptionsPanelProps) {
  const t = useT();
  const [localQuery, setLocalQuery] = useState('');
  const [highlight, setHighlight] = useState(selected[0] ?? '');
  const command = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const sentinel = useRef<HTMLDivElement>(null);
  const requested = useRef<(() => void) | undefined>(undefined);
  const text = query ?? localQuery;
  const visible = remote
    ? options
    : options.filter((o) =>
        `${o.text} ${o.group ?? ''}`.toLocaleLowerCase().includes(text.toLocaleLowerCase()),
      );
  const groups = [...new Set(visible.map((o) => o.group ?? ''))];
  useEffect(() => {
    if (!visible.some((o) => o.id === highlight && !o.disabled))
      setHighlight(visible.find((o) => !o.disabled)?.id ?? '');
  }, [visible, highlight]);
  useEffect(() => {
    if (list.current) onListId?.(list.current.id);
  }, [onListId]);
  useEffect(() => {
    if (!more || loading || !sentinel.current || !list.current) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting && requested.current !== more) {
          requested.current = more;
          more();
        }
      },
      { root: list.current, rootMargin: '0px 0px 48px 0px' },
    );
    observer.observe(sentinel.current);
    return () => observer.disconnect();
  }, [more, loading]);
  useEffect(() => {
    if (!externalInput) {
      if (search) input.current?.focus();
      else command.current?.focus();
    }
  }, [search, externalInput]);
  useEffect(() => {
    list.current?.scrollTo({ top: 0 });
  }, [text, tab]);
  useEffect(() => {
    if (!externalInput) return;
    const onKey = (event: KeyboardEvent) => {
      if (!(event.target instanceof Node) || !externalInput.contains(event.target)) return;
      if (event.isComposing) {
        if (event.key === 'Enter') event.stopPropagation();
        return;
      }
      if (!['ArrowDown', 'ArrowUp', 'Enter', 'Home', 'End', 'Escape', 'Tab'].includes(event.key))
        return;
      if (event.key === 'Tab') {
        event.stopPropagation();
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      command.current?.dispatchEvent(
        new KeyboardEvent('keydown', { key: event.key, bubbles: true, cancelable: true }),
      );
    };
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  }, [externalInput]);
  return (
    <Command
      ref={command}
      tabIndex={search || externalInput ? undefined : 0}
      value={highlight}
      onValueChange={(id) => {
        setHighlight(id);
        onHighlight?.(id);
      }}
      shouldFilter={false}
      className="flex max-h-[min(480px,calc(100dvh-24px),var(--radix-popover-content-available-height,480px))] min-h-0 min-w-0 flex-col"
      label={label}
      onKeyDownCapture={(e) => {
        if (
          e.target instanceof HTMLElement &&
          e.target.closest('[role="tab"]') &&
          ['Enter', ' '].includes(e.key)
        ) {
          e.stopPropagation();
          return;
        }
        if (e.key === 'Enter' && e.nativeEvent.isComposing) {
          e.preventDefault();
          e.stopPropagation();
          return;
        }
        if (e.key === 'Enter') {
          e.preventDefault();
          e.stopPropagation();
          const option =
            visible.find((o) => o.id === highlight && !o.disabled) ??
            visible.find((o) => !o.disabled);
          if (option) onSelect(option.id);
        }
        if (e.key === 'Escape' && onClose) {
          e.preventDefault();
          e.stopPropagation();
          onClose();
        }
      }}
    >
      {tabs && (
        <div
          role="tablist"
          tabIndex={-1}
          aria-label={label}
          className="flex min-w-0 shrink-0 gap-1 overflow-x-auto border-b border-line px-1"
          onKeyDown={(e) => {
            if (!['ArrowLeft', 'ArrowRight'].includes(e.key)) return;
            const focused =
              e.target instanceof HTMLElement
                ? e.target.closest('[role="tab"]')?.getAttribute('data-tab-id')
                : undefined;
            const index = tabs.findIndex((item) => item.id === (focused ?? tab));
            const next =
              tabs[(index + (e.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length];
            e.preventDefault();
            e.stopPropagation();
            onTab?.(next.id);
            e.currentTarget
              .querySelectorAll<HTMLButtonElement>('button')
              [tabs.indexOf(next)]?.focus();
          }}
        >
          {tabs.map((item) => (
            <button
              type="button"
              role="tab"
              data-tab-id={item.id}
              aria-selected={item.id === tab}
              tabIndex={item.id === tab ? 0 : -1}
              key={item.id}
              onClick={() => onTab?.(item.id)}
              className="shrink-0 border-b-2 border-transparent px-3 py-2 text-sm whitespace-nowrap text-muted aria-selected:border-ink aria-selected:text-ink"
            >
              {item.label}
            </button>
          ))}
        </div>
      )}
      {search && (
        <div className="m-1 flex shrink-0 items-center gap-2 rounded-md border border-line px-2 focus-within:ring-1 focus-within:ring-accent">
          <Search size={14} className="shrink-0 text-muted" aria-hidden />
          <CommandInput
            ref={input}
            aria-label={label}
            placeholder={label}
            data-history="native"
            value={text}
            onValueChange={(value) => {
              setLocalQuery(value);
              onQuery?.(value);
            }}
            className="w-full min-w-0 !border-0 !bg-transparent px-0 py-2 !shadow-none !outline-none"
          />
        </div>
      )}
      <CommandList
        ref={list}
        label={label}
        className="!max-h-[320px] min-h-0 flex-1 overflow-y-auto overscroll-contain py-1"
      >
        {!loading && (
          <CommandEmpty className="p-3 text-sm text-muted">{t('database.noOptions')}</CommandEmpty>
        )}
        {groups.map((group) => (
          <CommandGroup
            key={group}
            heading={group || undefined}
            className="[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1 [&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:text-muted"
          >
            {visible
              .filter((o) => (o.group ?? '') === group)
              .map((o) => (
                <CommandItem
                  key={o.id}
                  value={o.id}
                  disabled={o.disabled}
                  onSelect={() => onSelect(o.id)}
                  className="flex cursor-default items-center gap-2 rounded-md px-2 py-2 text-sm outline-none data-[disabled=true]:opacity-40 data-[selected=true]:bg-surface-hover"
                >
                  {o.icon}
                  <span className="min-w-0 flex-1 truncate">{o.label}</span>
                  {selected.includes(o.id) && <Check size={14} aria-hidden />}
                </CommandItem>
              ))}
          </CommandGroup>
        ))}
        {loading && <LoadingIndicator className="w-full" />}
        <div ref={sentinel} aria-hidden="true" className="h-px" />
      </CommandList>
    </Command>
  );
}
