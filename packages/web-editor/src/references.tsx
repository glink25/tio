import {
  HostError,
  type RelationPage,
  type ReferenceGroup,
  type ReferenceOccurrence,
  type RelationsProvider,
} from '@tio/core';
import { useT } from '@tio/i18n';
import { Button, ObjectIcon } from '@tio/ui';
import { ChevronRight, Network } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

import type { EditorController } from './controller';

function useRelations<T>(
  provider: RelationsProvider | undefined,
  key: string,
  query: (after?: string) => Promise<RelationPage<T>>,
) {
  const [state, setState] = useState<{
    items: T[];
    loading: boolean;
    error: boolean;
    next?: string;
    total?: number;
    complete?: boolean;
  }>({ items: [], loading: true, error: false });
  const current = useRef(query);
  current.current = query;
  const generation = useRef(0);
  const version = useRef('');
  const loadRef = useRef<(after?: string) => Promise<void>>(async () => {});
  const load = async (after?: string) => {
    const token = ++generation.current;
    setState((v) => ({ ...v, loading: true, error: false }));
    try {
      const result = await current.current(after);
      if (generation.current !== token) return;
      if (after && result.version !== version.current) {
        void loadRef.current();
        return;
      }
      version.current = result.version;
      setState((v) => ({
        items: after ? [...v.items, ...result.items] : result.items,
        loading: false,
        error: false,
        next: result.next,
        total: result.total,
        complete: result.complete,
      }));
    } catch (error) {
      if (generation.current !== token) return;
      if (after && error instanceof HostError && error.code === 'conflict') {
        void loadRef.current();
        return;
      }
      setState((v) => ({ ...v, loading: false, error: true }));
    }
  };
  loadRef.current = load;
  useEffect(() => {
    setState({ items: [], loading: true, error: false });
    if (!provider) return;
    void loadRef.current();
    let timer: ReturnType<typeof setTimeout>;
    const stop = provider.subscribe((reason) => {
      generation.current++;
      clearTimeout(timer);
      setState((v) =>
        reason === 'access' ? { items: [], loading: true, error: false } : { ...v, loading: true },
      );
      timer = setTimeout(() => void loadRef.current(), reason === 'access' ? 0 : 150);
    });
    return () => {
      // This is a request-generation counter, not a DOM ref.
      // oxlint-disable-next-line react-hooks/exhaustive-deps
      generation.current++;
      clearTimeout(timer);
      stop();
    };
  }, [provider, key]);
  return { ...state, load };
}
function Occurrences({
  provider,
  sourceId,
  targetId,
  model,
}: {
  provider: RelationsProvider;
  sourceId: string;
  targetId: string;
  model: EditorController;
}) {
  const t = useT();
  const state = useRelations<ReferenceOccurrence>(provider, `${sourceId}:${targetId}`, (after) =>
    provider.queryReferenceOccurrences({ sourceId, targetId, after, limit: 20 }),
  );
  return (
    <div className="ml-7 border-l border-line pl-3">
      {state.items.map((item, i) => (
        <button
          key={i}
          className="my-1 block w-full rounded p-2 text-left text-sm text-secondary hover:bg-panel"
          onClick={() => model.mentions.navigate(item.source)}
        >
          {item.fieldName ? `${item.fieldName}: ` : ''}
          {item.excerpt || t('links.mention')}
        </button>
      ))}
      {state.loading && <output className="p-2 text-sm text-muted">{t('links.updating')}</output>}
      {state.error && <Button onClick={() => void state.load()}>{t('links.retry')}</Button>}
      {state.next && !state.loading && (
        <Button onClick={() => void state.load(state.next)}>{t('links.more')}</Button>
      )}
    </div>
  );
}
export function ReferenceFooter({ model, id }: { model: EditorController; id: string }) {
  const t = useT();
  const provider = model.runtime.relations;
  const [direction, setDirection] = useState<'in' | 'out'>('in');
  const [expanded, setExpanded] = useState(new Set<string>());
  const incoming = useRelations<ReferenceGroup>(provider, `${id}:in`, (after) =>
    provider!.queryReferences({ id, direction: 'in', after, limit: 50 }),
  );
  const outgoing = useRelations<ReferenceGroup>(provider, `${id}:out`, (after) =>
    provider!.queryReferences({ id, direction: 'out', after, limit: 50 }),
  );
  const state = direction === 'in' ? incoming : outgoing;
  return (
    <footer className="mt-12 rounded-xl bg-surface p-4 text-sm" aria-label={t('links.references')}>
      <div className="mb-3 flex flex-wrap items-center gap-3 border-b border-line pb-2">
        {(['in', 'out'] as const).map((d) => (
          <button
            key={d}
            aria-pressed={direction === d}
            className={`border-b-2 px-1 py-2 ${direction === d ? 'border-current text-primary' : 'border-transparent text-muted'}`}
            onClick={() => {
              setDirection(d);
              setExpanded(new Set());
            }}
          >
            {t(d === 'in' ? 'links.incoming' : 'links.outgoing')} (
            {(d === 'in' ? incoming : outgoing).total ?? '…'})
          </button>
        ))}
        {model.onOpenGraph && (
          <Button className="ml-auto" onClick={() => model.onOpenGraph!(id)}>
            <Network size={16} />
            {t('links.graph')}
          </Button>
        )}
      </div>
      {!provider ? (
        <p className="text-muted">{t('links.unsupported')}</p>
      ) : (
        <>
          {state.loading && <output className="py-2 text-muted">{t('links.updating')}</output>}
          {!state.loading && state.complete === false && (
            <output className="py-2 text-muted">{t('links.partial')}</output>
          )}
          {state.error && <Button onClick={() => void state.load()}>{t('links.retry')}</Button>}
          {!state.loading && !state.error && state.complete && !state.items.length && (
            <p className="py-2 text-muted">{t('links.empty')}</p>
          )}
          {state.items.map((item) => (
            <div key={item.node.target.id}>
              <div className="flex items-center gap-2 py-2">
                <button
                  aria-label={t('links.context')}
                  aria-expanded={expanded.has(item.node.target.id)}
                  onClick={() =>
                    setExpanded((v) => {
                      const next = new Set(v);
                      if (next.has(item.node.target.id)) next.delete(item.node.target.id);
                      else next.add(item.node.target.id);
                      return next;
                    })
                  }
                >
                  <ChevronRight
                    size={16}
                    className={expanded.has(item.node.target.id) ? 'rotate-90' : ''}
                  />
                </button>
                <ObjectIcon type={item.node.target.kind} />
                <button
                  className="min-w-0 truncate text-left hover:underline disabled:text-muted"
                  disabled={item.status !== 'ready'}
                  onClick={() => model.mentions.navigate(item.node.target)}
                >
                  {item.status === 'ready' ? item.node.title : t('links.unavailable')}
                </button>
                <span className="text-xs text-muted">{item.count}</span>
              </div>
              {expanded.has(item.node.target.id) && (
                <Occurrences
                  provider={provider}
                  sourceId={direction === 'in' ? item.node.target.id : id}
                  targetId={direction === 'in' ? id : item.node.target.id}
                  model={model}
                />
              )}
            </div>
          ))}
          {state.next && !state.loading && (
            <Button onClick={() => void state.load(state.next)}>{t('links.more')}</Button>
          )}
        </>
      )}
    </footer>
  );
}
