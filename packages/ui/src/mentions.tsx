import {
  isMentionReference,
  mentionKey,
  type MentionService,
  type MentionReference,
  type MentionResolution,
} from '@tio/core';
import { useTranslation } from '@tio/i18n';
import { createContext, useContext, useEffect, useState, useMemo } from 'react';

import { ReferencePicker } from './reference-picker';

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
  inline = false,
  label,
}: {
  value: unknown;
  onChange: (value: MentionReference | null) => void;
  inline?: boolean;
  label?: string;
}) {
  const service = useContext(MentionContext);
  const { i18n } = useTranslation();
  const zh = i18n.language === 'zh';
  const [active, setActive] = useState(inline);
  const [query, setQuery] = useState('');
  const [after, setAfter] = useState<string>();
  const [items, setItems] = useState<Awaited<ReturnType<MentionService['query']>>['items']>([]);
  const [next, setNext] = useState<string>();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    if (!active) return;
    let live = true;
    setLoading(true);
    setError(false);
    if (!service) {
      setError(true);
      setLoading(false);
      return;
    }
    void service.query(query, after).then(
      (page) => {
        if (!live) return;
        setItems((previous) =>
          after
            ? [
                ...previous,
                ...page.items.filter(
                  (item) =>
                    !previous.some((p) => mentionKey(p.reference) === mentionKey(item.reference)),
                ),
              ]
            : page.items,
        );
        setNext(page.next);
        setLoading(false);
      },
      () => {
        if (live) {
          setError(true);
          setLoading(false);
        }
      },
    );
    return () => {
      live = false;
    };
  }, [service, active, query, after, retry]);
  return (
    <ReferencePicker
      label={label ?? (zh ? '搜索提及目标' : 'Search mention targets')}
      inline={inline}
      selected={
        isMentionReference(value)
          ? [
              {
                id: mentionKey(value),
                kind: value.kind,
                text: zh ? '提及' : 'Mention',
                label: <MentionLabel reference={value} />,
              },
            ]
          : []
      }
      options={items.map((item) => ({
        id: mentionKey(item.reference),
        kind: item.reference.kind,
        text: item.title,
        label: item.title,
      }))}
      query={query}
      onQuery={(text) => {
        setQuery(text);
        setAfter(undefined);
      }}
      onActiveChange={setActive}
      onSelect={(id) => {
        const item = items.find((i) => mentionKey(i.reference) === id);
        if (item) onChange(item.reference);
      }}
      onRemove={() => onChange(null)}
      loading={loading}
      error={error}
      retry={() => setRetry((n) => n + 1)}
      more={next ? () => setAfter(next) : undefined}
    />
  );
}
