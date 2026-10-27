import { t } from '@tio/i18n';
import { Button, Modal } from '@tio/ui';

import type { WorkspaceController } from '../features/workspace/use-workspace';
export function GitHubDialog({ model: m }: { model: WorkspaceController }) {
  return (
    <Modal mobilePlacement="center" title="GitHub" close={() => m.setGithubOpen(false)}>
      <form
        className="mt-4 flex flex-col gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          const token = new FormData(e.currentTarget).get('token');
          if (typeof token === 'string') void m.github(token.trim());
        }}
      >
        <label htmlFor="github-token">{t('welcome.token')}</label>
        <input
          id="github-token"
          name="token"
          type="password"
          autoComplete="off"
          required
          className="w-full"
        />
        <Button disabled={m.busy} type="submit">
          {t('welcome.token')}
        </Button>
      </form>
      {m.connection?.kind === 'github' && (
        <a
          className="mt-4 block text-sm underline"
          href="https://github.com/settings/installations"
          target="_blank"
          rel="noreferrer"
        >
          {t('welcome.manageGithub')}
        </a>
      )}
    </Modal>
  );
}
