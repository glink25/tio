import { builtinIconNames, coverPresetIds, type DocumentIcon, type DocumentCover } from '@tio/core';
import { useT } from '@tio/i18n';
import { Button, builtinIcons, coverPresets } from '@tio/ui';
import { useLayoutEffect, useRef, useState } from 'react';

import { validateImageUrl } from './image';

const photos = [
  { id: 'lake', image: 'photo-1470770841072-f978cf4d019e', name: 'Luca Bravo', user: 'lucabravo' },
  {
    id: 'forest',
    image: 'photo-1441974231531-c6227db76b6e',
    name: 'Sebastian Unrau',
    user: 'sebastian_unrau',
  },
  {
    id: 'mountain',
    image: 'photo-1464822759023-fed622ff2c3b',
    name: 'Simon Berger',
    user: '8moments',
  },
] as const;
export default function Gallery({
  mode,
  onSelect,
}: {
  mode: 'icons' | 'presets' | 'unsplash';
  onSelect: (value: DocumentIcon | DocumentCover) => void;
}) {
  const t = useT();
  if (mode === 'icons')
    return (
      <div className="grid grid-cols-6 gap-2 p-4">
        {builtinIconNames.map((name) => {
          const Icon = builtinIcons[name];
          return (
            <button
              key={name}
              aria-label={t(`media.icon.${name}`)}
              title={t(`media.icon.${name}`)}
              className="flex aspect-square items-center justify-center rounded-md text-secondary hover:bg-surface-hover focus-visible:outline-2"
              onClick={() => onSelect({ type: 'builtin', name })}
            >
              <Icon size={24} strokeWidth={1.7} />
            </button>
          );
        })}
      </div>
    );
  if (mode === 'presets')
    return (
      <div className="p-4">
        <p className="mb-3 text-xs text-muted">{t('media.colorsAndGradients')}</p>
        <div className="grid grid-cols-3 gap-2">
          {coverPresetIds.map((id) => (
            <button
              key={id}
              aria-label={t(`media.preset.${id}`)}
              title={t(`media.preset.${id}`)}
              className="h-20 rounded-md border border-line focus-visible:outline-2 focus-visible:outline-offset-2"
              style={{ background: coverPresets[id] }}
              onClick={() => onSelect({ type: 'preset', id })}
            />
          ))}
        </div>
      </div>
    );
  return (
    <div className="grid grid-cols-2 gap-3 p-4">
      {photos.map((photo) => (
        <PhotoTile key={photo.id} photo={photo} onSelect={onSelect} />
      ))}
    </div>
  );
}
function PhotoTile({
  photo,
  onSelect,
}: {
  photo: (typeof photos)[number];
  onSelect: (value: DocumentCover) => void;
}) {
  const t = useT();
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const active = useRef(false);
  useLayoutEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
    };
  }, []);
  const url = `https://images.unsplash.com/${photo.image}?auto=format&fit=crop&w=2000&q=85`;
  const credit = {
    name: photo.name,
    url: `https://unsplash.com/@${photo.user}?utm_source=tio&utm_medium=referral`,
  };
  const choose = async () => {
    setBusy(true);
    setFailed(false);
    try {
      await validateImageUrl(url);
      if (active.current) onSelect({ type: 'image', url, positionY: 0.5, credit });
    } catch {
      if (active.current) setFailed(true);
    } finally {
      if (active.current) setBusy(false);
    }
  };
  return (
    <div>
      <button
        disabled={busy}
        className="block w-full rounded focus-visible:outline-2 focus-visible:outline-offset-2 disabled:opacity-50"
        aria-label={t(`media.photo.${photo.id}`)}
        onClick={() => void choose()}
      >
        <img
          src={`https://images.unsplash.com/${photo.image}?auto=format&fit=crop&w=480&q=70`}
          alt={t(`media.photo.${photo.id}`)}
          loading="lazy"
          className="h-28 w-full rounded object-cover"
        />
      </button>
      <p className="mt-1 text-xs text-muted">
        <a href={credit.url} target="_blank" rel="noreferrer" className="hover:underline">
          {photo.name}
        </a>{' '}
        /{' '}
        <a
          href="https://unsplash.com/?utm_source=tio&utm_medium=referral"
          target="_blank"
          rel="noreferrer"
          className="hover:underline"
        >
          Unsplash
        </a>
      </p>
      {busy && <output className="block text-xs text-muted">{t('media.processing')}</output>}
      {failed && (
        <div>
          <p role="alert" className="text-xs text-muted">
            {t('media.imageUnavailable')}
          </p>
          <Button className="px-1 py-1 text-xs" onClick={() => void choose()}>
            {t('media.retry')}
          </Button>
        </div>
      )}
    </div>
  );
}
