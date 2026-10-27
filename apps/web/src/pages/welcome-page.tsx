import { supported } from '@tio/adapter-local-folder';
import { t, translateStatus } from '@tio/i18n';
import { Button, LanguageSwitcher, ThemeSwitcher } from '@tio/ui';
import { FolderOpen, HardDrive, Upload } from 'lucide-react';

import { Brand } from '../components/brand';
import type { WorkspaceController } from '../features/workspace/use-workspace';
import { usePresentation, setPresentation } from '../services/browser-presentation';
export function WelcomePage({ model: m }: { model: WorkspaceController }) {
  const presentation = usePresentation();
  return (
    <div className="flex min-h-dvh flex-col bg-panel p-6">
      <header className="flex justify-end gap-2">
        <ThemeSwitcher
          value={presentation.theme}
          onChange={(theme) => setPresentation({ theme })}
        />
        <LanguageSwitcher
          value={presentation.locale}
          onChange={(locale) => setPresentation({ locale })}
        />
      </header>
      <main className="m-auto w-full max-w-sm py-12">
        <div className="mb-8 flex items-center gap-3 text-2xl font-semibold">
          <Brand />
          <h1>Tio</h1>
        </div>
        <div className="flex flex-col gap-3">
          {m.connection && (
            <>
              <h2>{m.connection.name}</h2>
              {m.supportsSync && (
                <Button onClick={() => void m.syncNow()}>{translateStatus(m.syncStatus)}</Button>
              )}
              <Button onClick={() => void m.logout()}>{t('workspace.disconnect')}</Button>
            </>
          )}
          <Button
            variant="outline"
            className="justify-start py-3"
            disabled={m.busy}
            onClick={() => void m.offline()}
          >
            <HardDrive size={18} />
            {m.connection ? t('workspace.new') : t('welcome.offline')}
          </Button>
          {!m.connection && (
            <Button
              variant="outline"
              className="justify-start py-3"
              onClick={() => m.setGithubOpen(true)}
            >
              GitHub
            </Button>
          )}
          {!m.connection && (
            <Button
              variant="outline"
              className="justify-start py-3"
              disabled={m.busy || !supported()}
              onClick={() => void m.folder()}
            >
              <FolderOpen size={18} />
              {t('welcome.folder')}
            </Button>
          )}
          {!supported() && <p className="text-xs text-muted">{t('welcome.unsupported')}</p>}
          <Button className="justify-start" onClick={() => m.importRef.current?.click()}>
            <Upload size={16} />
            {t('welcome.import')}
          </Button>
        </div>
        {m.sessions.length > 0 && (
          <section className="mt-8 border-t border-line pt-4">
            <h2 className="mb-2 text-xs text-muted">{t('welcome.recent')}</h2>
            {m.sessions.map((s) => (
              <Button
                key={s.id}
                className="w-full justify-start truncate"
                onClick={() => void m.activate(s)}
              >
                {m.connection?.kind === 'folder' ? (
                  <FolderOpen size={16} />
                ) : (
                  <HardDrive size={16} />
                )}{' '}
                {s.name}
              </Button>
            ))}
          </section>
        )}
      </main>
    </div>
  );
}
