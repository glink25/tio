import { SuggestionMenu as SuggestionMenuExtension } from '@blocknote/core/extensions';
import {
  SuggestionMenuController,
  useBlockNoteEditor,
  type DefaultReactSuggestionItem,
  type SuggestionMenuProps,
} from '@blocknote/react';
import { mentionKey, type MentionReference } from '@tio/core';
import { useT, type TranslationKey } from '@tio/i18n';
import { MentionContext, ReferenceIcon, OptionsPanel, usePagedOptions } from '@tio/ui';
import { closeHistory } from '@tiptap/pm/history';
import { useCallback, useContext, useState } from 'react';

type QueryItem = DefaultReactSuggestionItem & { query: string };
function Menu(props: SuggestionMenuProps<QueryItem>) {
  const service = useContext(MentionContext);
  const editor = useBlockNoteEditor();
  const t = useT();
  const [kind, setKind] = useState('all');
  const query = props.items[0]?.query ?? '';
  const page = usePagedOptions({
    active: !!service,
    source: service,
    queryKey: JSON.stringify([query, kind]),
    key: (item: import('@tio/core').MentionCandidate) => mentionKey(item.reference),
    load: (after) =>
      service!.query(query, after, kind === 'all' ? undefined : (kind as MentionReference['kind'])),
  });
  return (
    <div className="tio-mention-menu bn-suggestion-menu w-[360px] max-w-[calc(100vw-24px)] rounded-lg border border-line bg-panel p-1 shadow-xl">
      <OptionsPanel
        label={t('database.searchReferences')}
        search={false}
        remote
        query={query}
        externalInput={editor.domElement}
        loading={page.loading}
        more={page.more}
        tabs={[
          { id: 'all', label: t('picker.all') },
          ...(service?.kinds ?? ['page', 'database', 'record']).map((id) => ({
            id,
            label: t(`picker.${id}` as TranslationKey),
          })),
        ]}
        tab={kind}
        onTab={setKind}
        onClose={() => editor.getExtension(SuggestionMenuExtension)?.closeMenu()}
        options={page.items.map((item) => ({
          id: mentionKey(item.reference),
          text: item.title,
          icon: <ReferenceIcon kind={item.reference.kind} />,
          label: (
            <span className="block min-w-0">
              <span className="block truncate">{item.title}</span>
              {item.description && (
                <span className="block truncate text-xs text-muted">{item.description}</span>
              )}
            </span>
          ),
        }))}
        onSelect={(id) => {
          const item = page.items.find((candidate) => mentionKey(candidate.reference) === id);
          if (!item) return;
          props.onItemClick?.({
            title: item.title,
            query,
            onItemClick: () => {
              editor.transact((tr) => closeHistory(tr));
              editor.insertInlineContent([{ type: 'mention', props: item.reference } as any, ' ']);
              editor.transact((tr) => closeHistory(tr));
            },
          });
        }}
      />
    </div>
  );
}
export function MentionMenu() {
  const service = useContext(MentionContext);
  const getItems = useCallback(
    async (query: string): Promise<QueryItem[]> => [{ title: '', query, onItemClick: () => {} }],
    [],
  );
  return service ? (
    <SuggestionMenuController
      triggerCharacter="@"
      getItems={getItems}
      suggestionMenuComponent={Menu}
    />
  ) : null;
}
/** Slash completion shares the same surface and keyboard controller. */
export function SlashMenu(props: SuggestionMenuProps<DefaultReactSuggestionItem>) {
  const editor = useBlockNoteEditor();
  const t = useT();
  return (
    <div className="w-80 max-w-[calc(100vw-24px)] rounded-lg border border-line bg-panel p-1 shadow-xl">
      <OptionsPanel
        label={t('common.edit')}
        search={false}
        remote
        externalInput={editor.domElement}
        loading={props.loadingState !== 'loaded'}
        onClose={() => editor.getExtension(SuggestionMenuExtension)?.closeMenu()}
        options={props.items.map((item, index) => ({
          id: String(index),
          text: item.title,
          label: item.title,
          icon: item.icon,
          group: item.group,
        }))}
        onSelect={(id) => props.onItemClick?.(props.items[Number(id)])}
      />
    </div>
  );
}
