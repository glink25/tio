import { useTranslation } from '@tio/i18n';
import { OverlayPresence } from '@tio/ui';
import { Notifications, toast, ThemeContext, LoadingSkeleton, SidebarSkeleton } from '@tio/ui';
import { useEffect, lazy, Suspense } from 'react';

import { useWorkspace } from '../features/workspace/use-workspace';
import { WelcomePage } from '../pages/welcome-page';
import { usePresentation } from '../services/browser-presentation';
import { ConnectionDialogs } from './connection-dialogs';
import { GitHubDialog } from './github-dialog';
import { WorkspaceActionDialog } from './workspace-action-dialog';
const SiteToolsHost = lazy(() =>
  import('../features/site-tools/host').then((m) => ({ default: m.SiteToolsHost })),
);
const WorkspacePage = lazy(() =>
  import('../pages/workspace-page').then((m) => ({ default: m.WorkspacePage })),
);
const WorkspaceDialogs = lazy(() =>
  import('./workspace-dialogs').then((m) => ({ default: m.WorkspaceDialogs })),
);
export function App() {
  useTranslation();
  const model = useWorkspace();
  const presentation = usePresentation();
  useEffect(() => {
    if (model.error) toast.error(model.error, { id: 'host-error' });
  }, [model.error]);
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (
        model.session &&
        model.manualSync &&
        !model.openingWorkspace &&
        (e.metaKey || e.ctrlKey) &&
        e.key.toLowerCase() === 's' &&
        !e.altKey &&
        !e.shiftKey &&
        !e.isComposing
      ) {
        e.preventDefault();
        if (!e.repeat) void model.syncWorkspace();
        return;
      }
      if ((e.metaKey || e.ctrlKey) && e.key === 'k' && model.session) {
        e.preventDefault();
        model.setSearching(true);
      }
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [model]);
  return (
    <ThemeContext.Provider value={presentation.theme}>
      <Notifications />
      {'modelContext' in document && (
        <Suspense fallback={null}>
          <SiteToolsHost model={model} />
        </Suspense>
      )}
      <ConnectionDialogs model={model} />
      <OverlayPresence>
        {model.workspaceAction && <WorkspaceActionDialog model={model} />}
      </OverlayPresence>
      <OverlayPresence>{model.githubOpen && <GitHubDialog model={model} />}</OverlayPresence>
      <input
        ref={model.importRef}
        className="hidden"
        type="file"
        accept=".zip"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void model.importFile(f);
          e.target.value = '';
        }}
      />
      {model.session ? (
        <div hidden={model.openingWorkspace}>
          <Suspense fallback={<WorkspaceLoading />}>
            <WorkspacePage key={model.session.id} model={model} />
          </Suspense>
        </div>
      ) : (
        !model.openingWorkspace && <WelcomePage model={model} />
      )}
      {model.openingWorkspace && <WorkspaceLoading />}
      {model.session && (
        <Suspense fallback={null}>
          <WorkspaceDialogs key={model.session?.id} model={model} />
        </Suspense>
      )}
    </ThemeContext.Provider>
  );
}

function WorkspaceLoading() {
  return (
    <div className="tio-workspace-loading flex">
      <aside className="tio-loading-sidebar hidden w-[260px] shrink-0 border-r border-line bg-surface md:block">
        <SidebarSkeleton />
      </aside>
      <div className="tio-workspace-loading-content min-w-0 flex-1">
        <div aria-hidden="true" className="tio-workspace-header" />
        <LoadingSkeleton />
      </div>
    </div>
  );
}
