import { isMediaUrl } from '@tio/core';
import { errorMessage, useT } from '@tio/i18n';
import { Button, FilePicker, useAssetPolicy } from '@tio/ui';
import { Image } from 'lucide-react';
import { useLayoutEffect, useRef, useState } from 'react';

import { MediaImageError, validateImageFile, validateImageUrl } from './image';

export default function ImagePanel({
  mode,
  upload,
  onSelect,
}: {
  mode: 'upload' | 'link';
  upload: (file: File) => Promise<string>;
  onSelect: (url: string) => void;
}) {
  const t = useT();
  const policy = useAssetPolicy();
  const [link, setLink] = useState('');
  const [preview, setPreview] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const generation = useRef(0);
  useLayoutEffect(
    () => () => {
      generation.current++;
    },
    [],
  );
  const run = async (action: () => Promise<void>) => {
    const token = generation.current;
    setBusy(true);
    setError('');
    try {
      await action();
    } catch (error) {
      if (token === generation.current)
        setError(
          error instanceof MediaImageError
            ? t(`media.error.${error.code}`)
            : errorMessage(error, t),
        );
    } finally {
      if (token === generation.current) setBusy(false);
    }
  };
  return (
    <div className="space-y-4 p-4" data-history="native">
      {mode === 'upload' ? (
        <FilePicker
          accept="image/png,image/jpeg,image/webp,image/gif"
          icon={<Image size={24} />}
          label={t('media.uploadImage')}
          hint={t('media.uploadHint', { maxMB: policy.maxImageBytes / (1024 * 1024) })}
          busy={busy}
          onSelect={([file]) => {
            const token = ++generation.current;
            void run(async () => {
              await validateImageFile(file, policy.maxImageBytes);
              if (token !== generation.current) return;
              const url = await upload(file);
              if (token === generation.current) onSelect(url);
            });
          }}
        />
      ) : (
        <form
          className="space-y-3"
          onSubmit={(event) => {
            event.preventDefault();
            const token = ++generation.current;
            void run(async () => {
              const url = link.trim();
              if (!/^https?:\/\//i.test(url) || !isMediaUrl(url)) throw new MediaImageError('url');
              await validateImageUrl(url);
              if (token === generation.current) setPreview(url);
            });
          }}
        >
          <input
            className="w-full rounded border border-line bg-panel p-2"
            aria-label={t('media.imageUrl')}
            placeholder="https://…"
            value={link}
            onChange={(event) => {
              generation.current++;
              setBusy(false);
              setLink(event.target.value);
              setPreview('');
            }}
          />
          {preview && (
            <img
              src={preview}
              alt={t('media.preview')}
              className="max-h-48 w-full rounded object-contain"
            />
          )}
          <div className="flex justify-end gap-2">
            <Button variant="outline" type="submit" disabled={busy}>
              {t('media.preview')}
            </Button>
            <Button
              variant="primary"
              type="button"
              disabled={!preview || busy}
              onClick={() => onSelect(preview)}
            >
              {t('media.useImage')}
            </Button>
          </div>
        </form>
      )}
      {busy && <output className="block text-sm text-muted">{t('media.processing')}</output>}
      {error && (
        <p role="alert" className="text-sm text-secondary">
          {error}
        </p>
      )}
    </div>
  );
}
