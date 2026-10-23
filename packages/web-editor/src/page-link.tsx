import { titleOf, type Block } from '@tio/core';
import { useT } from '@tio/i18n';
import { Button, EmptyNotice, ObjectIcon } from '@tio/ui';

import type { EditorController } from './controller';
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
function references(blocks: Block[], id: string): boolean {
  return blocks.some(
    (block) =>
      (block.type === 'pageReference' && block.props.pageId === id) ||
      references(block.children, id),
  );
}
export function Backlinks({ model }: { model: EditorController }) {
  const t = useT();
  const links = model.nav.filter(
    (o) => o.id !== model.current?.id && references(o.blocks ?? [], model.current!.id),
  );
  if (!links.length) return null;
  return (
    <aside className="mt-8 border-t border-line pt-4">
      <h2 className="mb-2 text-xs text-muted">{t('page.backlinks')}</h2>
      {links.map((o) => (
        <PageLink key={o.id} model={model} pageId={o.id} />
      ))}
    </aside>
  );
}
