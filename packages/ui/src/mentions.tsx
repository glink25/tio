import {
  mentionKey,
  mentionReferences,
  type MentionService,
  type MentionReference,
  type MentionResolution,
} from '@tio/core';
import { useT } from '@tio/i18n';
import { useTranslation } from '@tio/i18n';
import { createContext, useContext, useEffect, useState, useMemo, useRef } from 'react';

import { useNotify } from './overlays';
import { ReferencePicker, ReferenceIcon } from './reference-picker';
import { LoadingIndicator } from './skeleton';
import { usePagedOptions } from './use-paged-options';

export const MentionContext = createContext<MentionService | undefined>(undefined);
export function MentionLabel({
  reference,
  showIcon = true,
}: {
  reference: MentionReference;
  showIcon?: boolean;
}) {
  const service = useContext(MentionContext);
  const { i18n } = useTranslation();
  const zh = i18n.language === 'zh';
  const { workspaceId, kind, id } = reference;
  const login = reference.kind === 'github-user' ? reference.login : undefined;
  const stableReference = useMemo<MentionReference>(
    () =>
      kind === 'github-user' ? { workspaceId, kind, id, login: login! } : { workspaceId, kind, id },
    [workspaceId, kind, id, login],
  );
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

  const notify = useNotify();
  const notifyRef = useRef(notify);
  notifyRef.current = notify;
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
            notifyRef.current(zh ? '提及目标读取失败' : 'Failed to load reference');
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
  }, [service, stableReference, zh]);
  const title =
    result?.status === 'ready'
      ? result.title
      : !result
        ? ''
        : result.status === 'deleted'
          ? zh
            ? '提及目标已删除'
            : 'Deleted reference'
          : result.status === 'denied'
            ? zh
              ? '无访问权限'
              : 'Access denied'
            : result.status === 'error'
              ? zh
                ? '提及目标读取失败'
                : 'Failed to load reference'
              : zh
                ? '提及目标不可用'
                : 'Reference unavailable';
  return (
    <button
      type="button"
      contentEditable={false}
      title={failed ? (zh ? '提及目标读取失败' : 'Failed to load reference') : undefined}
      data-refresh-error={failed || undefined}
      style={failed ? { textDecorationStyle: 'wavy' } : undefined}
      className={`inline-flex max-w-full items-center gap-1 rounded px-1 align-baseline underline ${result?.status === 'ready' ? '' : 'text-muted'}`}
      onClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
        if (result?.status === 'ready') service?.navigate(reference);
        else if (result?.status === 'error')
          notifyRef.current(zh ? '提及目标读取失败' : 'Failed to load reference');
        else if (result?.status === 'deleted')
          notifyRef.current(zh ? '提及目标已被删除' : 'The referenced target has been deleted');
      }}
    >
      {showIcon && <ReferenceIcon kind={reference.kind} />}
      {result ? title : <LoadingIndicator />}
    </button>
  );
}
export function MentionPicker({
  value,
  onChange,
  inline = false,
  multiple = false,
  label,
}: {
  value: unknown;
  onChange: (value: MentionReference | MentionReference[] | null) => void;
  multiple?: boolean;
  inline?: boolean;
  label?: string;
}) {
  const service = useContext(MentionContext);
  const { i18n } = useTranslation();
  const zh = i18n.language === 'zh';
  const [active, setActive] = useState(inline);
  const [query, setQuery] = useState('');
  const t = useT();
  const [kind, setKind] = useState<string>('all');
  const page = usePagedOptions({
    active,
    source: service,
    queryKey: JSON.stringify([query, kind]),
    key: (item: import('@tio/core').MentionCandidate) => mentionKey(item.reference),
    load: (after) =>
      service
        ? service.query(
            query,
            after,
            kind === 'all' ? undefined : (kind as MentionReference['kind']),
          )
        : Promise.reject(new Error('Unavailable')),
  });
  const items = page.items;
  return (
    <ReferencePicker
      label={label ?? (zh ? '搜索提及目标' : 'Search mention targets')}
      inline={inline}
      multiple={multiple}
      tabs={[
        { id: 'all', label: t('picker.all') },
        ...(service?.kinds ?? ['page', 'database', 'record']).map((id) => ({
          id,
          label: t(`picker.${id}` as import('@tio/i18n').TranslationKey),
        })),
      ]}
      tab={kind}
      onTab={setKind}
      selected={mentionReferences(value).map((ref) => ({
        id: mentionKey(ref),
        kind: ref.kind,
        text: zh ? '提及' : 'Mention',
        label: <MentionLabel reference={ref} showIcon={false} />,
      }))}
      options={items.map((item) => ({
        id: mentionKey(item.reference),
        kind: item.reference.kind,
        text: item.title,
        label: (
          <span className="flex min-w-0 flex-col">
            <span className="truncate">{item.title}</span>
            {item.description && (
              <span className="truncate text-xs text-muted">{item.description}</span>
            )}
          </span>
        ),
      }))}
      query={query}
      onQuery={(text) => {
        setQuery(text);
      }}
      onActiveChange={setActive}
      onSelect={(id) => {
        const item = items.find((i) => mentionKey(i.reference) === id);
        if (item) {
          const selected = mentionReferences(value);
          onChange(
            multiple
              ? selected.some((ref) => mentionKey(ref) === id)
                ? selected.filter((ref) => mentionKey(ref) !== id)
                : [...selected, item.reference]
              : item.reference,
          );
        }
      }}
      onRemove={(id) =>
        onChange(multiple ? mentionReferences(value).filter((ref) => mentionKey(ref) !== id) : null)
      }
      loading={page.loading}
      error={page.failed}
      more={page.more}
    />
  );
}
