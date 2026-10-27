import {
  isMentionReference,
  type MentionService,
  type MentionReference,
  type MentionResolution,
} from '@tio/core';
import { useTranslation } from '@tio/i18n';
import { createContext, useContext, useEffect, useState, useMemo, useRef } from 'react';

export const MentionContext = createContext<MentionService | undefined>(undefined);
export function MentionLabel({ reference }: { reference: MentionReference }) {
  const service = useContext(MentionContext);
  const { i18n } = useTranslation();
  const zh = i18n.language === 'zh';
  const { workspaceId, kind, id } = reference;
  const stableReference = useMemo(() => ({ workspaceId, kind, id }), [workspaceId, kind, id]);
  const [resolved, setResolved] = useState<{
    service: MentionService | undefined;
    reference: MentionReference;
    result: MentionResolution;
    failed: boolean;
  }>();
  const current =
    resolved && resolved.service === service && resolved.reference === stableReference
      ? resolved
      : undefined;
  const result = current?.result;
  const failed = current?.failed;

  const [retry, setRetry] = useState(0);
  useEffect(() => {
    let live = true,
      generation = 0;
    const read = () => {
      const current = ++generation;
      if (!service) return;
      void service.resolve([stableReference]).then(
        (items) => {
          if (live && current === generation)
            setResolved((previous) => {
              const result = items[0] ?? { reference: stableReference, status: 'error' as const };
              if (
                previous?.service === service &&
                previous.reference === stableReference &&
                !previous.failed &&
                JSON.stringify(previous.result) === JSON.stringify(result)
              )
                return previous;
              return { service, reference: stableReference, result, failed: false };
            });
        },
        () => {
          if (live && current === generation)
            setResolved((previous) => ({
              service,
              reference: stableReference,
              failed: true,
              result:
                previous?.service === service && previous.reference === stableReference
                  ? previous.result
                  : { reference: stableReference, status: 'error' },
            }));
        },
      );
    };
    read();
    const stop = service?.subscribe(read);
    return () => {
      live = false;
      stop?.();
    };
  }, [service, stableReference, retry]);
  const title =
    result?.status === 'ready'
      ? result.title
      : !result
        ? zh
          ? '加载中…'
          : 'Loading…'
        : result.status === 'deleted'
          ? zh
            ? '已删除文档'
            : 'Deleted document'
          : result.status === 'denied'
            ? zh
              ? '无访问权限'
              : 'Access denied'
            : result.status === 'error'
              ? zh
                ? '读取失败，点击重试'
                : 'Failed to load; retry'
              : zh
                ? '文档不存在'
                : 'Document unavailable';
  return (
    <button
      type="button"
      contentEditable={false}
      title={failed ? (zh ? '刷新失败，点击重试' : 'Refresh failed; click to retry') : undefined}
      data-refresh-error={failed || undefined}
      style={failed ? { textDecorationStyle: 'wavy' } : undefined}
      className={`inline rounded px-1 underline ${result?.status === 'ready' ? '' : 'text-muted'}`}
      onClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
        if (failed) setRetry((n) => n + 1);
        else if (result?.status === 'ready') service?.navigate(reference);
        else if (result?.status === 'error') setRetry((n) => n + 1);
        else if (result?.status === 'deleted')
          window.alert(zh ? '源文档已被删除' : 'The source document has been deleted');
      }}
    >
      {title}
    </button>
  );
}
export function MentionPicker({
  value,
  onChange,
}: {
  value: unknown;
  onChange: (value: MentionReference | null) => void;
}) {
  const service = useContext(MentionContext);
  const { i18n } = useTranslation();
  const zh = i18n.language === 'zh';
  const choices = useRef<HTMLDivElement>(null);
  const [query, setQuery] = useState('');
  const [after, setAfter] = useState<string>();
  const [page, setPage] = useState<Awaited<ReturnType<MentionService['query']>>>();
  const [error, setError] = useState(false),
    [retry, setRetry] = useState(0);
  useEffect(() => {
    let live = true;
    setPage(undefined);
    setError(false);
    if (!service) {
      setError(true);
      return;
    }
    void service.query(query, after).then(
      (p) => {
        if (live) setPage(p);
      },
      () => {
        if (live) setError(true);
      },
    );
    return () => {
      live = false;
    };
  }, [service, query, after, retry]);
  return (
    <div className="space-y-2">
      {isMentionReference(value) && <MentionLabel reference={value} />}
      <input
        aria-label={zh ? '搜索提及目标' : 'Search mention targets'}
        value={query}
        onKeyDown={(event) => {
          if (event.nativeEvent.isComposing) return;
          if (event.key === 'ArrowDown') {
            event.preventDefault();
            choices.current?.querySelector<HTMLButtonElement>('button')?.focus();
          }
          if (event.key === 'Enter') {
            event.preventDefault();
            event.stopPropagation();
            if (page?.items[0]) onChange(page.items[0].reference);
          }
        }}
        onChange={(e) => {
          setQuery(e.target.value);
          setAfter(undefined);
        }}
      />
      <button type="button" onClick={() => onChange(null)}>
        {zh ? '清空' : 'Clear'}
      </button>
      {error ? (
        <button type="button" onClick={() => setRetry((n) => n + 1)}>
          {zh ? '读取失败，重试' : 'Failed; retry'}
        </button>
      ) : !page ? (
        <output>{zh ? '加载中…' : 'Loading…'}</output>
      ) : (
        <>
          <div ref={choices}>
            {page.items.map((item) => (
              <button
                type="button"
                className="block w-full text-left"
                key={item.reference.id}
                onKeyDown={(event) => {
                  if (!['ArrowDown', 'ArrowUp'].includes(event.key)) return;
                  event.preventDefault();
                  const buttons = Array.from(
                    choices.current?.querySelectorAll<HTMLButtonElement>('button') ?? [],
                  );
                  const index = buttons.indexOf(event.currentTarget);
                  buttons[
                    (index + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length
                  ]?.focus();
                }}
                onClick={() => onChange(item.reference)}
              >
                {item.title}
              </button>
            ))}
          </div>
          {!page.items.length && <p>{zh ? '无匹配文档' : 'No matching documents'}</p>}
          {after && (
            <button type="button" onClick={() => setAfter(undefined)}>
              {zh ? '首页' : 'First page'}
            </button>
          )}
          {page.next && (
            <button type="button" onClick={() => setAfter(page.next)}>
              {zh ? '下一页' : 'Next page'}
            </button>
          )}
        </>
      )}
    </div>
  );
}
