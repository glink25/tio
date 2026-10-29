import { titleOf, type ContentTarget, type TioObject } from '@tio/core';
import { useT } from '@tio/i18n';
import { Button, cn, IconButton, useNotify } from '@tio/ui';
import { ChevronRight, Link } from 'lucide-react';

import { contentUrl } from '../../services/navigation';

export function Breadcrumbs({
  ancestors,
  current,
  navigate,
}: {
  ancestors: TioObject[];
  current?: TioObject;
  navigate: (object: TioObject) => void;
}) {
  const t = useT();
  const notify = useNotify();
  const objects = current ? [...ancestors, current] : ancestors;
  const copy = async (object: TioObject) => {
    try {
      await navigator.clipboard.writeText(
        contentUrl({
          workspaceId: object.workspaceId,
          kind: object.type as ContentTarget['kind'],
          id: object.id,
        }),
      );
      notify(t('links.copied'));
    } catch {
      notify(t('links.copyFailed'));
    }
  };
  return (
    <nav
      aria-label={t('links.breadcrumbs')}
      className="flex min-w-0 items-center gap-11 overflow-x-auto pr-11 md:gap-[21px] md:pr-[21px]"
    >
      {objects.map((object, index) => (
        <div
          key={object.id}
          className={cn(
            'group relative flex min-w-0 items-center',
            object.id !== current?.id && 'max-w-28 shrink-0 sm:max-w-36',
          )}
        >
          <Button
            aria-current={object.id === current?.id ? 'page' : undefined}
            className="max-w-full min-w-0 shrink justify-start p-1 text-sm"
            onClick={() => navigate(object)}
          >
            <span className="truncate">{titleOf(object)}</span>
          </Button>
          {(index < objects.length - 1 || !current) && (
            <span
              className="pointer-events-none absolute left-full flex size-[21px] items-center justify-center max-md:hidden md:group-focus-within:opacity-0 md:group-hover:opacity-0"
              aria-hidden
            >
              <ChevronRight size={13} />
            </span>
          )}
          <IconButton
            label={t('links.copyPage', { title: titleOf(object) })}
            className="absolute left-full size-11 p-1 text-muted hover:text-ink md:pointer-events-none md:size-[21px] md:opacity-0 md:group-focus-within:pointer-events-auto md:group-focus-within:opacity-100 md:group-hover:pointer-events-auto md:group-hover:opacity-100"
            onClick={() => void copy(object)}
          >
            <Link size={13} />
          </IconButton>
        </div>
      ))}
      {!current && <span className="truncate">{t('workspace.home')}</span>}
    </nav>
  );
}
