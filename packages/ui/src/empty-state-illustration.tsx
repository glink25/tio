// Source consumers outside Vite also need the ambient SVG declaration.
// oxlint-disable-next-line typescript/triple-slash-reference
/// <reference path="./assets.d.ts" />
import { useT } from '@tio/i18n';

import pages from './illustrations/empty-pages.svg?raw';
import trash from './illustrations/empty-trash.svg?raw';
import workspaces from './illustrations/empty-workspaces.svg?raw';

const illustrations = {
  pages: { svg: pages, label: 'ui.emptyPages' },
  workspaces: { svg: workspaces, label: 'workspace.noSpaces' },
  trash: { svg: trash, label: 'ui.emptyTrash' },
} as const;

export function EmptyStateIllustration({ kind }: { kind: keyof typeof illustrations }) {
  const t = useT();
  const { svg, label } = illustrations[kind];
  return (
    <span className="inline-flex size-32 shrink-0 text-muted">
      <span className="sr-only">{t(label)}</span>
      <span
        className="size-full [&>svg]:size-full"
        aria-hidden="true"
        dangerouslySetInnerHTML={{ __html: svg }}
      />
    </span>
  );
}
