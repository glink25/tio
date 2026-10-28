import { useTranslation } from '@tio/i18n';
import { Notifications, toast, ThemeContext, LoadingSkeleton, SidebarSkeleton } from '@tio/ui';
import { useEffect, lazy, Suspense } from 'react';

import { useWorkspace } from '../features/workspace/use-workspace';
import { WelcomePage } from '../pages/welcome-page';
import { usePresentation } from '../services/browser-presentation';
import { ConnectionDialogs } from './connection-dialogs';
import { GitHubDialog } from './github-dialog';
import { WorkspaceActionDialog } from './workspace-action-dialog';
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
      <ConnectionDialogs model={model} />
      <WorkspaceActionDialog model={model} />
      {model.githubOpen && <GitHubDialog model={model} />}
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
    <div className="flex min-h-dvh">
      <aside className="hidden w-[260px] shrink-0 border-r border-line bg-surface md:block">
        <SidebarSkeleton />
      </aside>
      <div className="min-w-0 flex-1">
        <div aria-hidden="true" className="h-12" />
        <LoadingSkeleton />
      </div>
    </div>
  );
}
