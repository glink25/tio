import { coverPresetIds, type DocumentIcon, type DocumentCover } from '@tio/core';
import { useT } from '@tio/i18n';
import { Button, coverPresets } from '@tio/ui';
import { useLayoutEffect, useRef, useState } from 'react';

import { validateImageUrl } from './image';
import { photoCategories, type CoverPhoto } from './photo-catalog';

export default function Gallery({
  mode,
  onSelect,
}: {
  mode: 'presets' | 'unsplash';
  onSelect: (value: DocumentIcon | DocumentCover) => void;
}) {
  const t = useT();
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
    <div className="space-y-5 p-4">
      {photoCategories.map((category) => (
        <section key={category.id} aria-label={t(`media.photoCategory.${category.id}`)}>
          <h3 className="mb-3 text-xs font-medium text-muted">
            {t(`media.photoCategory.${category.id}`)}
          </h3>
          <div className="grid grid-cols-2 gap-3">
            {category.photos.map((photo) => (
              <PhotoTile key={photo.id} photo={photo} onSelect={onSelect} />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

function PhotoTile({
  photo,
  onSelect,
}: {
  photo: CoverPhoto;
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
        type="button"
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
