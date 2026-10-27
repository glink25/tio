import { t } from '@tio/i18n';

import trash from './illustrations/empty-trash.svg?raw';
import workspaces from './illustrations/empty-workspaces.svg?raw';

const illustrations = {
  workspaces: { svg: workspaces, label: 'workspace.noSpaces' },
  trash: { svg: trash, label: 'ui.emptyTrash' },
} as const;

export function EmptyStateIllustration({ kind }: { kind: keyof typeof illustrations }) {
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
