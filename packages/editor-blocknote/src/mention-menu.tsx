/* oxlint-disable jsx-a11y/prefer-tag-over-role -- Keyboard-driven popup options retain editor focus. */
import {
  SuggestionMenuController,
  useBlockNoteEditor,
  type DefaultReactSuggestionItem,
  type SuggestionMenuProps,
} from '@blocknote/react';
import { useTranslation } from '@tio/i18n';
import { MentionContext } from '@tio/ui';
import { closeHistory } from '@tiptap/pm/history';
import { createContext, useCallback, useContext, useRef, useState } from 'react';

type Item = DefaultReactSuggestionItem & { placeholder?: boolean };
const PagingContext = createContext<{ next?: () => void; first?: () => void; retry?: () => void }>(
  {},
);
function Menu(props: SuggestionMenuProps<Item>) {
  const paging = useContext(PagingContext);
  const { i18n } = useTranslation();
  const zh = i18n.language === 'zh';
  return (
    <div className="rounded border border-line bg-panel p-1 shadow-lg">
      <div
        className="bn-suggestion-menu max-h-64 overflow-y-auto"
        id="bn-suggestion-menu"
        role="listbox"
        aria-label={zh ? '提及目标' : 'Mention targets'}
      >
        {props.loadingState !== 'loaded' ? (
          <output>{zh ? '加载中…' : 'Loading…'}</output>
        ) : (
          props.items.map((item, index) =>
            item.placeholder ? null : (
              <button
                type="button"
                role="option"
                aria-selected={props.selectedIndex === index}
                id={`bn-suggestion-menu-item-${index}`}
                key={index}
                className="block w-full rounded px-3 py-2 text-left hover:bg-surface-hover aria-selected:bg-surface-hover"
                onClick={() => props.onItemClick?.(item)}
              >
                {item.title}
              </button>
            ),
          )
        )}
        {props.loadingState === 'loaded' &&
          props.items.every((item) => item.placeholder) &&
          !paging.retry && <p>{zh ? '无匹配文档' : 'No matching documents'}</p>}
      </div>
      {props.loadingState === 'loaded' && (
        <div className="flex gap-2 p-2">
          {paging.retry && (
            <button type="button" onClick={paging.retry}>
              {zh ? '读取失败，点击重试' : 'Failed to load; retry'}
            </button>
          )}
          {paging.first && (
            <button type="button" onClick={paging.first}>
              {zh ? '返回首页' : 'First page'}
            </button>
          )}
          {paging.next && (
            <button type="button" onClick={paging.next}>
              {zh ? '下一页 →' : 'Next page →'}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
/** Page controls do not consume the active @ query or disturb the insertion cursor. */
export function MentionMenu() {
  const service = useContext(MentionContext);
  const editor = useBlockNoteEditor();
  const [cursor, setCursor] = useState<{ query: string; after?: string }>({ query: '' });
  const [retry, setRetry] = useState(0);
  const [result, setResult] = useState<{
    query: string;
    next?: string;
    after?: string;
    error?: boolean;
  }>({ query: '' });
  const latest = useRef<Promise<Item[]>>();
  const generation = useRef(0);
  const getItems = useCallback(
    (query: string): Promise<Item[]> => {
      void retry;
      const after = cursor.query === query ? cursor.after : undefined;
      const current = ++generation.current;
      const work = Promise.resolve().then(async (): Promise<Item[]> => {
        if (!service) return [];
        try {
          const page = await service.query(query, after);
          if (generation.current !== current) return latest.current!;
          setResult({ query, next: page.next, after });
          return page.items.length
            ? page.items.map((item) => ({
                title: item.title,
                onItemClick: () => {
                  if (generation.current !== current) return;
                  editor.transact((tr) => closeHistory(tr));
                  editor.insertInlineContent([
                    { type: 'mention', props: item.reference } as any,
                    ' ',
                  ]);
                  editor.transact((tr) => closeHistory(tr));
                },
              }))
            : [{ title: '', placeholder: true, onItemClick: () => {} }];
        } catch {
          if (generation.current !== current) return latest.current!;
          setResult({ query, after, error: true });
          return [{ title: '', placeholder: true, onItemClick: () => {} }];
        }
      });
      const pending = work;
      latest.current = pending;
      return pending;
    },
    [service, editor, cursor, retry],
  );
  return service ? (
    <PagingContext.Provider
      value={{
        next: result.next
          ? () => setCursor({ query: result.query, after: result.next })
          : undefined,
        first: result.after ? () => setCursor({ query: result.query }) : undefined,
        retry: result.error ? () => setRetry((n) => n + 1) : undefined,
      }}
    >
      <SuggestionMenuController
        triggerCharacter="@"
        getItems={getItems}
        suggestionMenuComponent={Menu}
      />
    </PagingContext.Provider>
  ) : null;
}
