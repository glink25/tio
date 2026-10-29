import type { SearchHit } from '@tio/core';
import { t } from '@tio/i18n';
import { OptionsPanel, usePagedOptions } from '@tio/ui';
import { Modal, ObjectIcon } from '@tio/ui';
import { useState } from 'react';
import { useStore } from 'zustand';

import type { WorkspaceController } from '../features/workspace/use-workspace';
export function SearchDialog({ model: m }: { model: WorkspaceController }) {
  const version = useStore(m.runtime!.state, (state) => state.version);
  const [type, setType] = useState('all');
  const [selected, setSelected] = useState('');
  const page = usePagedOptions({
    active: true,
    source: m.runtime,
    queryKey: JSON.stringify([m.query, type, version]),
    key: (object: SearchHit) => object.id,
    load: (after) => m.runtime!.search({ text: m.query, type, after, limit: 50 }),
  });
  const results = page.items;
  const item = results.find((o) => o.id === selected) ?? results[0];
  const name = (hit: SearchHit) => hit.title;
  const path = (hit: SearchHit) => hit.path;
  const excerpt = (hit: SearchHit) => hit.excerpt;
  return (
    <Modal
      mobilePlacement="center"
      wide
      title={t('workspace.searchTitle')}
      close={() => m.setSearching(false)}
    >
      <div className="grid min-w-0 gap-5 md:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
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
            icon: <ObjectIcon type={o.target.kind} />,
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
            if (object) void m.navigateTarget(object.target);
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
