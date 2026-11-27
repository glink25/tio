import { t } from '@tio/i18n';
import { Button, Modal } from '@tio/ui';

import type { WorkspaceController } from '../features/workspace/use-workspace';
export function GitTokenDialog({ model: m }: { model: WorkspaceController }) {
  const provider = m.tokenProvider;
  if (!provider) return null;
  const title = t(provider === 'gitee' ? 'welcome.giteeTokenTitle' : 'welcome.tokenTitle');
  return (
    <Modal mobilePlacement="center" title={title} close={() => m.setTokenProvider(undefined)}>
      <form
        className="mt-4 flex flex-col gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          const token = new FormData(e.currentTarget).get('token');
          if (typeof token === 'string' && token.trim()) void m.signInGit(provider, token.trim());
        }}
      >
        <label className="sr-only" htmlFor="git-token">
          {title}
        </label>
        <input
          id="git-token"
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
