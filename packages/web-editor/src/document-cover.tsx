import type { DocumentCover as CoverValue } from '@tio/core';
import { useT } from '@tio/i18n';
import { Button, cn, coverPresets, useMediaUrl } from '@tio/ui';
import { useEffect, useRef, useState } from 'react';

import type { DocumentMediaProps } from './document-icon';
import { MediaPicker } from './media/picker';

export function DocumentCover(props: DocumentMediaProps) {
  const { object, editable, patch, resolve, upload } = props;
  if (!object.cover) return null;
  return (
    <Cover
      key={`${object.id}:${JSON.stringify(object.cover)}:${editable}`}
      cover={object.cover}
      editable={editable}
      patch={patch}
      resolve={resolve}
      upload={upload}
    />
  );
}
function Cover({
  cover,
  editable,
  patch,
  resolve,
  upload,
}: Omit<DocumentMediaProps, 'object'> & { cover: CoverValue }) {
  const t = useT();
  const [draft, setDraft] = useState<number | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [failed, setFailed] = useState(false);
  const url = useMediaUrl(cover.type === 'image' ? cover.url : undefined, resolve, attempt);
  const image = useRef<HTMLImageElement>(null);
  const positioner = useRef<HTMLInputElement>(null);
  const repositioning = draft !== null;
  useEffect(() => {
    if (repositioning) positioner.current?.focus();
  }, [repositioning]);
  const drag = useRef<{ y: number; position: number; overflow: number } | null>(null);
  const position = draft ?? (cover.type === 'image' ? cover.positionY : 0.5);
  return (
    <div
      className={cn(
        'tio-document-cover relative h-[180px] w-full bg-surface md:h-[280px]',
        draft !== null && 'cursor-ns-resize touch-none select-none',
      )}
      style={cover.type === 'preset' ? { background: coverPresets[cover.id] } : undefined}
    >
      {cover.type === 'image' && url && !failed && (
        <img
          key={`${url}:${attempt}`}
          ref={image}
          src={url}
          alt={t('document.cover')}
          draggable={false}
          className="h-full w-full object-cover"
          style={{ objectPosition: `center ${position * 100}%` }}
          onError={() => setFailed(true)}
        />
      )}
      {draft !== null && (
        <input
          type="range"
          min={0}
          max={100}
          step={5}
          value={draft * 100}
          onChange={(event) => setDraft(Number(event.target.value) / 100)}
          className="absolute inset-0 h-full w-full cursor-ns-resize opacity-0"
          ref={positioner}
          tabIndex={0}
          aria-label={t('document.coverPosition')}
          aria-valuemin={draft !== null ? 0 : undefined}
          aria-valuemax={draft !== null ? 100 : undefined}
          aria-valuenow={draft !== null ? Math.round(draft * 100) : undefined}
          onKeyDown={(event) => {
            if (draft === null) return;
            if (event.key === 'Escape') {
              event.stopPropagation();
              setDraft(null);
            }
            if (['ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) {
              event.preventDefault();
              setDraft(
                event.key === 'Home'
                  ? 0
                  : event.key === 'End'
                    ? 1
                    : Math.max(0, Math.min(1, draft + (event.key === 'ArrowDown' ? 0.05 : -0.05))),
              );
            }
          }}
          onPointerDown={(event) => {
            if (draft === null || (event.target as Element).closest('button, a')) return;
            event.preventDefault();
            event.currentTarget.focus();
            const img = image.current;
            if (!img) return;
            const rect = event.currentTarget.getBoundingClientRect();
            const height =
              img.naturalHeight *
              Math.max(rect.width / img.naturalWidth, rect.height / img.naturalHeight);
            drag.current = {
              y: event.clientY,
              position: draft,
              overflow: Math.max(0, height - rect.height),
            };
            event.currentTarget.setPointerCapture(event.pointerId);
          }}
          onPointerMove={(event) => {
            if (!drag.current || draft === null || !drag.current.overflow) return;
            setDraft(
              Math.max(
                0,
                Math.min(
                  1,
                  drag.current.position - (event.clientY - drag.current.y) / drag.current.overflow,
                ),
              ),
            );
          }}
          onPointerUp={() => {
            drag.current = null;
          }}
          onPointerCancel={() => {
            drag.current = null;
          }}
        />
      )}
      {cover.type === 'image' && (failed || !url) && (
        <div className="absolute inset-0 flex items-center justify-center gap-2 text-sm text-muted">
          <span>{t('media.imageUnavailable')}</span>
          <Button
            variant="outline"
            onClick={() => {
              setFailed(false);
              setAttempt(attempt + 1);
            }}
          >
            {t('media.retry')}
          </Button>
        </div>
      )}
      {editable && (
        <div
          className={cn(
            'tio-cover-actions absolute right-4 bottom-4 flex gap-1 rounded-md border border-line bg-panel/95 p-1 shadow-sm',
            draft !== null && 'opacity-100',
          )}
        >
          {draft !== null ? (
            <>
              <Button
                className="px-2 py-1 text-xs"
                onClick={() => {
                  if (cover.type === 'image') patch({ cover: { ...cover, positionY: draft } });
                  setDraft(null);
                }}
              >
                {t('media.savePosition')}
              </Button>
              <Button className="px-2 py-1 text-xs" onClick={() => setDraft(null)}>
                {t('common.cancel')}
              </Button>
            </>
          ) : (
            <>
              <MediaPicker
                kind="cover"
                present
                label={t('document.changeCover')}
                upload={upload}
                onSelect={(value) => patch({ cover: value as CoverValue | null })}
                trigger={
                  <Button className="px-2 py-1 text-xs" aria-label={t('document.changeCover')}>
                    {t('document.changeCover')}
                  </Button>
                }
              />
              {cover.type === 'image' && !failed && url && (
                <Button className="px-2 py-1 text-xs" onClick={() => setDraft(position)}>
                  {t('document.reposition')}
                </Button>
              )}
            </>
          )}
        </div>
      )}
      {draft !== null && (
        <p className="pointer-events-none absolute inset-x-0 top-3 text-center text-sm text-white drop-shadow">
          {t('document.dragCover')}
        </p>
      )}
      {cover.type === 'image' && cover.credit && (
        <p className="absolute top-3 right-3 rounded bg-black/50 px-2 py-1 text-xs text-white">
          <a
            href={cover.credit.url}
            target="_blank"
            rel="noreferrer"
            className="text-white hover:underline"
          >
            {cover.credit.name}
          </a>{' '}
          /{' '}
          <a
            href="https://unsplash.com/?utm_source=tio&utm_medium=referral"
            target="_blank"
            rel="noreferrer"
            className="text-white hover:underline"
          >
            Unsplash
          </a>
        </p>
      )}
    </div>
  );
}
