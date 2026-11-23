import { t } from '@tio/i18n';
import { Button, Modal } from '@tio/ui';

import type { WorkspaceController } from '../features/workspace/use-workspace';
export function GitHubDialog({ model: m }: { model: WorkspaceController }) {
  return (
    <Modal
      mobilePlacement="center"
      title={t('welcome.tokenTitle')}
      close={() => m.setGithubOpen(false)}
    >
      <form
        className="mt-4 flex flex-col gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          const token = new FormData(e.currentTarget).get('token');
          if (typeof token === 'string') void m.github(token.trim());
        }}
      >
        <label className="sr-only" htmlFor="github-token">
          {t('welcome.tokenTitle')}
        </label>
        <input
          id="github-token"
          name="token"
          type="password"
          autoComplete="off"
          disabled={m.busy}
          required
          className="w-full"
        />
        <Button variant="primary" disabled={m.busy} type="submit">
          {t('common.signIn')}
        </Button>
      </form>
    </Modal>
  );
}
