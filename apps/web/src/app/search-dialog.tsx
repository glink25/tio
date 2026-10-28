import { titleOf, valueText, type TioObject } from '@tio/core';
import { t } from '@tio/i18n';
import { OptionsPanel, usePagedOptions } from '@tio/ui';
import { Modal, ObjectIcon } from '@tio/ui';
import { useState } from 'react';
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
  const page = usePagedOptions({
    active: true,
    source: m.runtime,
    queryKey: JSON.stringify([m.query, type, version]),
    key: (object: TioObject) => object.id,
    load: (after) => m.runtime!.search({ text: m.query, type, after, limit: 50 }),
  });
  const results = page.items;
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
      <div className="grid gap-5 md:grid-cols-[1.3fr_1fr]">
        <OptionsPanel
          label={t('workspace.search')}
          query={m.query}
          onQuery={m.setQuery}
          remote
          loading={page.loading}
          more={page.more}
          onHighlight={setSelected}
          tabs={(['all', 'page', 'database', 'record'] as const).map((id) => ({
            id,
            label: t(`picker.${id}`),
          }))}
          tab={type}
          onTab={setType}
          onClose={() => m.setSearching(false)}
          options={results.map((o) => ({
            id: o.id,
            text: name(o),
            icon: <ObjectIcon type={o.type} />,
            label: (
              <span className="block min-w-0">
                <span className="block truncate font-medium">{name(o)}</span>
                <span className="mt-1 block truncate text-xs text-muted">{path(o)}</span>
                <span className="mt-1 line-clamp-2 text-xs text-secondary">{excerpt(o)}</span>
              </span>
            ),
          }))}
          onSelect={(id) => {
            const object = results.find((o) => o.id === id);
            if (object) m.navigate(object);
          }}
        />
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
    </Modal>
  );
}
