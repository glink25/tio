import { supported } from '@tio/adapter-local-folder';
import { t } from '@tio/i18n';
import { Button, IconButton } from '@tio/ui';
import {
  ArrowLeft,
  FolderOpen,
  HardDrive,
  KeyRound,
  LoaderCircle,
  Plus,
  Layers,
} from 'lucide-react';

import { Brand } from '../components/brand';
import { Identity } from '../components/identity';
import type { WorkspaceController } from '../features/workspace/use-workspace';
import { authOrigin } from '../services/github-auth';

export function WelcomePage({ model: m }: { model: WorkspaceController }) {
  if (m.connection || m.loading || m.loadError)
    return (
      <main className="mx-auto flex h-dvh w-full max-w-xl flex-col gap-8 p-6 md:py-16">
        <header className="flex shrink-0 items-center justify-between gap-4">
          {m.connection ? (
            <IconButton label={t('ui.back')} onClick={() => m.setLogoutOpen(true)}>
              <ArrowLeft size={20} />
            </IconButton>
          ) : (
            <Brand />
          )}
          <div className="flex min-w-0 items-center gap-2 text-sm text-muted">
            <Identity identity={m.identity} />
          </div>
        </header>
        {m.syncStatus.access?.code === 'reauthorization-required' && (
          <Button
            onClick={() =>
              void m
                .authorize()
                .then(() => m.loadSpaces())
                .catch((error) => m.setError(String(error)))
            }
          >
            {t('status.reauthorize')}
          </Button>
        )}
        <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto py-8">
          {m.loading ? (
            <output className="my-auto flex items-center justify-center gap-3 text-sm text-muted">
              <LoaderCircle className="animate-spin" size={20} />
              {t(m.connection ? 'welcome.loadingSpaces' : 'welcome.initializing')}
            </output>
          ) : m.loadError ? (
            <div role="alert" className="my-auto space-y-4 text-center text-sm">
              <p>{m.loadError}</p>
              <Button onClick={() => (m.connection ? void m.loadSpaces() : location.reload())}>
                {t('common.retry')}
              </Button>
            </div>
          ) : !m.sessions.length ? (
            <div className="flex flex-1 items-center justify-center">
              <div className="flex size-24 items-center justify-center rounded-3xl bg-surface text-muted">
                <Layers size={38} strokeWidth={1.25} aria-label={t('workspace.noSpaces')} />
              </div>
            </div>
          ) : (
            <>
              <h1 className="mb-4 text-lg font-medium">{t('workspace.name')}</h1>
              {m.sessions.map((s) => (
                <Button
                  disabled={m.busy}
                  key={s.id}
                  className="w-full justify-between py-4 text-left"
                  onClick={() => void m.activate(s)}
                >
                  <span className="truncate">{s.name}</span>
                  {m.recent === s.id && (
                    <span className="shrink-0 rounded bg-surface-hover px-2 py-1 text-xs text-muted">
                      {t('ui.recent')}
                    </span>
                  )}
                </Button>
              ))}
            </>
          )}
        </div>
        {m.connection && !m.loading && !m.loadError && (
          <Button
            variant="outline"
            disabled={m.busy}
            className="w-full shrink-0 py-3"
            onClick={() => m.setCreating(true)}
          >
            <Plus size={18} />
            {t('workspace.new')}
          </Button>
        )}
      </main>
    );
  return (
    <main className="flex min-h-dvh items-center justify-center bg-panel p-6">
      <div className="flex w-full max-w-3xl flex-col items-center gap-12 md:flex-row md:justify-between md:gap-24">
        <div className="flex items-center gap-4 text-4xl font-semibold">
          <Brand />
          <h1>Tio</h1>
        </div>
        <div className="flex w-full max-w-sm flex-col gap-3">
          <fieldset className="flex" aria-label="GitHub">
            <Button
              variant="primary"
              className="flex-1 rounded-r-none py-3"
              disabled={m.busy || !authOrigin}
              onClick={() => void m.github()}
            >
              {t('welcome.github')}
            </Button>
            <IconButton
              label={t('welcome.token')}
              className="rounded-l-none border border-line px-4"
              disabled={m.busy}
              onClick={() => m.setGithubOpen(true)}
            >
              <KeyRound size={18} />
            </IconButton>
          </fieldset>
          {!authOrigin && <p className="text-xs text-muted">{t('welcome.oauthUnavailable')}</p>}
          <Button
            variant="outline"
            className="justify-start py-3"
            disabled={m.busy}
            onClick={() => void m.offline()}
          >
            <HardDrive size={18} />
            {t('welcome.offline')}
          </Button>
          <Button
            variant="outline"
            className="justify-start py-3"
            disabled={m.busy || !supported()}
            onClick={() => void m.folder()}
          >
            <FolderOpen size={18} />
            {t('welcome.folder')}
          </Button>
          {!supported() && <p className="text-xs text-muted">{t('welcome.unsupported')}</p>}
        </div>
      </div>
    </main>
  );
}
