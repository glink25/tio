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
import { search } from '@tio/workspace';
import { useState } from 'react';

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
  const [type, setType] = useState('all');
  const [selected, setSelected] = useState('');
  const results = search(
    m.objects.filter((o) => o.workspaceId === m.session?.workspaceId),
    m.query,
  )
    .filter((o) => type === 'all' || o.type === type)
    .slice(0, 50);
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
    <Modal wide title={t('workspace.searchTitle')} close={() => m.setSearching(false)}>
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
        <div className="grid gap-5 md:grid-cols-[1.3fr_1fr]">
          <CommandList className="min-h-64">
            <CommandEmpty className="p-8 text-center text-muted">{t('ui.noResults')}</CommandEmpty>
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
