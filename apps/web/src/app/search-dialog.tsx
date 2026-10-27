import { titleOf, valueText, type TioObject } from '@tio/core';
import { t } from '@tio/i18n';
import {
  Button,
  Modal,
  Command,
  CommandInput,
  CommandList,
  CommandItem,
  CommandEmpty,
  ObjectIcon,
  cn,
} from '@tio/ui';
import { useEffect, useState } from 'react';
import { useStore } from 'zustand';

import type { WorkspaceController } from '../features/workspace/use-workspace';
function excerpt(o: TioObject) {
  return (
    JSON.stringify(o.blocks ?? [])
      .match(/"text":"([^"]*)"/g)
      ?.map((s) => s.slice(8, -1))
      .join(' ')
      .slice(0, 320) ?? ''
  );
}
export function SearchDialog({ model: m }: { model: WorkspaceController }) {
  const version = useStore(m.runtime!.state, (state) => state.version);
  const [type, setType] = useState('all');
  const [selected, setSelected] = useState('');
  const [results, setResults] = useState<TioObject[]>([]);
  const [complete, setComplete] = useState(false);
  const [error, setError] = useState('');
  const [revision, retry] = useState(0);
  useEffect(() => {
    let cancelled = false;
    setResults([]);
    setComplete(false);
    setError('');
    const timer = setTimeout(() => {
      void (async () => {
        let after: string | undefined;
        const found = new Map<string, TioObject>();
        do {
          const page = await m.runtime!.search({ text: m.query, type, after, limit: 250 });
          if (cancelled) return;
          for (const object of page.items) found.set(object.id, object);
          setResults([...found.values()].slice(0, 50));
          setComplete(page.complete);
          after = page.next;
        } while (after && !cancelled);
      })().catch((error) => {
        if (!cancelled) setError(String(error));
      });
    }, 150);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [m.runtime, m.query, type, revision, version]);
  const item = results.find((o) => o.id === selected) ?? results[0];
  const name = (o: TioObject) =>
    o.type === 'record'
      ? valueText(
          o.properties?.[
            m.objects.find((d) => d.id === o.databaseId)?.fields?.find((f) => f.type === 'title')
              ?.id ?? ''
          ] ?? t('common.untitled'),
        )
      : titleOf(o);
  const path = (o: TioObject) => {
    const names: string[] = [];
    const seen = new Set<string>();
    let parent = m.objects.find((p) => p.id === (o.parentId ?? o.databaseId));
    while (parent && !seen.has(parent.id)) {
      seen.add(parent.id);
      names.unshift(titleOf(parent));
      parent = m.objects.find((p) => p.id === parent?.parentId);
    }
    return names.join(' / ');
  };
  return (
    <Modal
      mobilePlacement="center"
      wide
      title={t('workspace.searchTitle')}
      close={() => m.setSearching(false)}
    >
      <Command shouldFilter={false} value={item?.id ?? ''} onValueChange={setSelected}>
        <CommandInput
          aria-label={t('workspace.search')}
          placeholder={t('ui.searchHint')}
          value={m.query}
          onValueChange={m.setQuery}
        />
        <div className="my-3 flex gap-1">
          {(['all', 'page', 'database', 'record'] as const).map((v) => (
            <Button
              key={v}
              className={cn('text-xs', v === type && 'bg-surface-hover')}
              onClick={() => setType(v)}
            >
              {t(
                v === 'all'
                  ? 'ui.all'
                  : v === 'page'
                    ? 'ui.pages'
                    : v === 'database'
                      ? 'ui.databases'
                      : 'ui.records',
              )}
            </Button>
          ))}
        </div>
        {!complete && !error && (
          <output className="text-xs text-muted">
            {t('common.loading')} · {results.length}
          </output>
        )}
        {error && (
          <p role="alert">
            {error} <Button onClick={() => retry((v) => v + 1)}>{t('common.retry')}</Button>
          </p>
        )}
        <div className="grid gap-5 md:grid-cols-[1.3fr_1fr]">
          <CommandList className="min-h-64">
            <CommandEmpty className="p-8 text-center text-muted">
              {complete ? t('ui.noResults') : t('common.loading')}
            </CommandEmpty>
            {results.map((o) => (
              <CommandItem key={o.id} value={o.id} onSelect={() => m.navigate(o)}>
                <div className="flex gap-3">
                  <ObjectIcon type={o.type} />
                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium">{name(o)}</div>
                    <p className="mt-1 truncate text-xs text-muted">{path(o)}</p>
                    <p className="mt-1 line-clamp-2 text-xs text-secondary">{excerpt(o)}</p>
                  </div>
                </div>
              </CommandItem>
            ))}
          </CommandList>
          <aside className="hidden min-w-0 rounded-lg border border-line bg-surface p-6 md:block">
            {item && (
              <>
                <p className="mb-3 text-xs text-muted">{path(item)}</p>
                <h2 className="mb-4 text-2xl font-semibold break-words">{name(item)}</h2>
                <p className="text-sm leading-7 break-words whitespace-pre-wrap text-secondary">
                  {excerpt(item)}
                </p>
              </>
            )}
          </aside>
        </div>
      </Command>
    </Modal>
  );
}
