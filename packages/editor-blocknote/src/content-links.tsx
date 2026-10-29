import { SideMenuExtension } from '@blocknote/core/extensions';
import { useBlockNoteEditor, useComponentsContext, useExtensionState } from '@blocknote/react';
import type { ContentTarget } from '@tio/core';
import { useT } from '@tio/i18n';
import { useNotify } from '@tio/ui';
import { Link } from 'lucide-react';
import { createContext, useContext } from 'react';
export interface ContentLinks {
  acceptsContentLink?: (url: string) => boolean;
  copyBlockLink?: (blockId: string) => Promise<void>;
  parseContentLink?: (url: string) => Promise<ContentTarget | undefined>;
}
export const ContentLinksContext = createContext<ContentLinks>({});
export function CopyBlockLink({ mobile = false }: { mobile?: boolean }) {
  const links = useContext(ContentLinksContext);
  const editor = useBlockNoteEditor();
  const block = useExtensionState(SideMenuExtension, { editor, selector: (state) => state?.block });
  const components = useComponentsContext()!;
  const t = useT();
  const notify = useNotify();
  if (!links.copyBlockLink) return null;
  const copy = () => {
    const id = mobile ? editor.getTextCursorPosition().block.id : block?.id;
    if (id)
      void links.copyBlockLink!(id)
        .then(() => notify(t('links.copied')))
        .catch(() => notify(t('links.copyFailed')));
  };
  if (mobile) {
    const Button = components.FormattingToolbar.Button;
    return (
      <Button mainTooltip={t('links.copyBlock')} onClick={copy}>
        <Link size={16} />
      </Button>
    );
  }
  const Item = components.Generic.Menu.Item;
  return (
    <Item onClick={copy}>
      <Link size={16} />
      {t('links.copyBlock')}
    </Item>
  );
}
