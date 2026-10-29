import type { DocumentCover, DocumentIcon as IconValue, TioObject } from '@tio/core';
import { useT } from '@tio/i18n';
import { Button, ObjectIcon, cn, type MediaResolver } from '@tio/ui';
import { ImagePlus, Smile } from 'lucide-react';

import { MediaPicker } from './media/picker';
export interface DocumentMediaProps {
  object: TioObject;
  editable: boolean;
  patch: (changes: Partial<TioObject>) => void;
  upload: (file: File) => Promise<string>;
  resolve: MediaResolver;
}
export function DocumentIcon({ object, editable, patch, upload, resolve }: DocumentMediaProps) {
  const t = useT();
  if (!object.icon) return null;
  const icon = <ObjectIcon type={object.type} icon={object.icon} size={64} resolve={resolve} />;
  return (
    <div
      className={cn(
        'pointer-events-none h-16 text-muted',
        object.cover ? 'relative mb-2 -translate-y-8' : 'mb-10',
      )}
    >
      {editable ? (
        <MediaPicker
          kind="icon"
          present
          label={t('document.changeIcon')}
          upload={upload}
          onSelect={(value) => patch({ icon: value as IconValue })}
          trigger={
            <Button
              className="pointer-events-auto rounded-md p-0"
              aria-label={t('document.changeIcon')}
            >
              {icon}
            </Button>
          }
        />
      ) : (
        icon
      )}
    </div>
  );
}
export function DocumentMediaActions({ object, editable, patch, upload }: DocumentMediaProps) {
  const t = useT();
  if (!editable || (object.icon && object.cover)) return null;
  return (
    <div className="tio-title-actions absolute bottom-full left-0 flex gap-1 pb-1">
      {!object.icon && (
        <MediaPicker
          kind="icon"
          present={false}
          label={t('document.changeIcon')}
          upload={upload}
          onSelect={(value) => patch({ icon: value as IconValue })}
          trigger={
            <Button className="px-2 py-1 text-xs text-muted" aria-label={t('document.addIcon')}>
              <Smile size={15} />
              {t('document.addIcon')}
            </Button>
          }
        />
      )}
      {!object.cover && (
        <MediaPicker
          kind="cover"
          present={false}
          label={t('document.changeCover')}
          upload={upload}
          onSelect={(value) => patch({ cover: value as DocumentCover })}
          trigger={
            <Button className="px-2 py-1 text-xs text-muted" aria-label={t('document.addCover')}>
              <ImagePlus size={15} />
              {t('document.addCover')}
            </Button>
          }
        />
      )}
    </div>
  );
}
