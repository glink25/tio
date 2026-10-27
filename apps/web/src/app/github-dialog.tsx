import { i18n } from '@tio/i18n';
import { Button, Modal } from '@tio/ui';

import type { WorkspaceController } from '../features/workspace/use-workspace';
import { authOrigin } from '../services/github-auth';
export function GitHubDialog({ model: m }: { model: WorkspaceController }) {
  const en = i18n.language === 'en';
  return (
    <Modal title="GitHub" close={() => m.setGithubOpen(false)}>
      {authOrigin && (
        <Button disabled={m.busy} onClick={() => void m.github()}>
          {en ? 'Sign in with GitHub' : '使用 GitHub 登录'}
        </Button>
      )}
      <form
        className="mt-4 flex flex-col gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          const token = new FormData(e.currentTarget).get('token');
          if (typeof token === 'string') void m.github(token.trim());
        }}
      >
        <label htmlFor="github-token">{en ? 'Personal access token' : '个人访问令牌'}</label>
        <input
          id="github-token"
          name="token"
          type="password"
          autoComplete="off"
          required
          className="w-full"
        />
        <Button disabled={m.busy} type="submit">
          {en ? 'Connect with token' : '使用 Token 连接'}
        </Button>
      </form>
      {m.connection?.kind === 'github' && (
        <a
          className="mt-4 block text-sm underline"
          href="https://github.com/settings/installations"
          target="_blank"
          rel="noreferrer"
        >
          {en ? 'Manage GitHub access' : '管理 GitHub 授权'}
        </a>
      )}
    </Modal>
  );
}
