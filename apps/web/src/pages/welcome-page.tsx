import { t } from '@tio/i18n';
import { Button, IconButton } from '@tio/ui';
import { ArrowLeft, LoaderCircle, Plus } from 'lucide-react';
import { useRef, useState } from 'react';

import { Brand } from '../components/brand';
import { EmptyStateIllustration } from '../components/empty-state-illustration';
import { Identity } from '../components/identity';
import { LoginHero } from '../components/login-hero';
import type { WorkspaceController } from '../features/workspace/use-workspace';
import { connectionEntries } from '../services/connection-entry';

export function WelcomePage({ model: m }: { model: WorkspaceController }) {
  const starting = useRef(false);
  const [startingEntry, setStartingEntry] = useState(false);
  const entries = connectionEntries({
    github: () => m.github(),
    token: () => m.setGithubOpen(true),
    device: m.offline,
    folder: m.folder,
  });
  async function start(run: () => void | Promise<void>) {
    if (starting.current || m.busy) return;
    starting.current = true;
    setStartingEntry(true);
    try {
      await run();
    } finally {
      starting.current = false;
      setStartingEntry(false);
    }
  }
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
          ) : (
            <>
              <h1 className="mb-4 text-lg font-medium">{t('workspace.choose')}</h1>
              {!m.sessions.length ? (
                <div className="flex min-h-0 flex-1 items-center justify-center">
                  <EmptyStateIllustration kind="workspaces" />
                </div>
              ) : (
                m.sessions.map((s) => (
                  <Button
                    disabled={m.busy}
                    key={s.id}
                    variant="outline"
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
                ))
              )}
            </>
          )}
        </div>
        {m.connection && !m.loading && !m.loadError && (
          <Button
            variant="primary"
            disabled={m.busy}
            className="w-full shrink-0 py-3"
            onClick={() => m.setCreating(true)}
          >
            <Plus size={18} />
            {t(m.sessions.length ? 'workspace.new' : 'workspace.create')}
          </Button>
        )}
      </main>
    );
  return (
    <main className="login-page">
      <LoginHero />
      <section className="login-auth" aria-label={t('welcome.connections')}>
        <div className="login-actions">
          {entries.map(({ id, label, buttons }) => (
            <div key={id} className="flex flex-col gap-2">
              <fieldset className="flex gap-3" aria-label={t(label)}>
                {buttons.map(
                  ({
                    id: buttonId,
                    label: buttonLabel,
                    icon: Icon,
                    emphasis,
                    available,
                    hint,
                    run,
                    iconOnly,
                  }) =>
                    iconOnly ? (
                      <Button
                        key={buttonId}
                        aria-label={t(buttonLabel)}
                        title={t(buttonLabel)}
                        variant={emphasis === 'primary' ? 'primary' : 'outline'}
                        className="size-[54px] [&>svg]:size-[19px]"
                        disabled={m.busy || startingEntry || !available}
                        onClick={() => void start(run)}
                      >
                        <Icon />
                      </Button>
                    ) : (
                      <Button
                        key={buttonId}
                        variant={emphasis === 'primary' ? 'primary' : 'outline'}
                        className={
                          buttons.length > 1
                            ? 'min-h-[54px] flex-1 py-3 [&>svg]:size-[19px]'
                            : 'connection-button'
                        }
                        disabled={m.busy || startingEntry || !available}
                        aria-describedby={hint ? `${buttonId}-hint` : undefined}
                        onClick={() => void start(run)}
                      >
                        <Icon />
                        <span>{t(buttonLabel)}</span>
                      </Button>
                    ),
                )}
              </fieldset>
              {buttons.map(
                ({ id: buttonId, hint }) =>
                  hint && (
                    <p key={buttonId} id={`${buttonId}-hint`} className="text-xs text-muted">
                      {t(hint)}
                    </p>
                  ),
              )}
            </div>
          ))}
        </div>
      </section>
    </main>
  );
}
