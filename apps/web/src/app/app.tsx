import { t, useTranslation } from '@tio/i18n';
import { Notifications, toast, ThemeContext } from '@tio/ui';
import { useEffect, lazy, Suspense } from 'react';

import { useWorkspace } from '../features/workspace/use-workspace';
import { WelcomePage } from '../pages/welcome-page';
import { usePresentation } from '../services/browser-presentation';
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
        <Suspense fallback={<div className="p-10 text-sm text-muted">{t('common.loading')}</div>}>
          <WorkspacePage key={model.session.id} model={model} />
        </Suspense>
      ) : (
        <WelcomePage model={model} />
      )}
      {model.session && (
        <Suspense fallback={null}>
          <WorkspaceDialogs key={model.session?.id} model={model} />
        </Suspense>
      )}
    </ThemeContext.Provider>
  );
}
