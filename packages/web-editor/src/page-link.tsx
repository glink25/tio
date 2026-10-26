import { titleOf } from '@tio/core';
import { useT } from '@tio/i18n';
import { Button, EmptyNotice, ObjectIcon } from '@tio/ui';
import { useId } from 'react';

import type { EditorController } from './controller';
import { referencedPageIds } from './references';
export function PageLink({ model, pageId }: { model: EditorController; pageId: string }) {
  const t = useT();
  const target = model.nav.find((o) => o.id === pageId);
  return target ? (
    <Button className="w-full justify-start underline" onClick={() => model.navigate(target)}>
      <ObjectIcon type={target.type} />
      {titleOf(target)}
    </Button>
  ) : (
    <EmptyNotice>{t('page.missing')}</EmptyNotice>
  );
}
export function ReferencedPages({ model }: { model: EditorController }) {
  const t = useT();
  const headingId = useId();
  const links = referencedPageIds(model.current?.blocks ?? []);
  if (!links.length) return null;
  return (
    <footer
      className="tio-page-references mt-12 border-t border-line pt-6"
      aria-labelledby={headingId}
    >
      <div className="rounded-lg border border-line bg-surface p-4">
        <h2
          id={headingId}
          className="mb-3 flex items-center gap-2 text-sm font-medium text-secondary"
        >
          {t('page.references')}
          <span className="rounded bg-panel px-1.5 text-xs text-muted">{links.length}</span>
        </h2>
        <ul className="m-0 list-none space-y-1 p-0">
          {links.map((id) => (
            <li key={id}>
              <PageLink model={model} pageId={id} />
            </li>
          ))}
        </ul>
      </div>
    </footer>
  );
}
