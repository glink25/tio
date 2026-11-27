import type { GitProvider } from '@tio/provider-github/credentials';
import { KeyRound } from 'lucide-react';

import { GiteeIcon } from '../../components/gitee-icon';
import { GitHubIcon } from '../../components/github-icon';
import { authOrigin } from '../github-auth';
import type { ConnectionEntry, ConnectionEntryActions } from './types';

export function gitEntries(
  provider: GitProvider,
  actions: ConnectionEntryActions,
): ConnectionEntry[] {
  return [
    {
      id: provider,
      label: provider === 'gitee' ? 'welcome.gitee' : 'welcome.github',
      icon: provider === 'gitee' ? GiteeIcon : GitHubIcon,
      emphasis: 'primary',
      available: Boolean(authOrigin()),
      run: () => actions.git(provider),
    },
    {
      id: provider + '-token',
      iconOnly: true,
      label: provider === 'gitee' ? 'welcome.giteeToken' : 'welcome.token',
      icon: KeyRound,
      emphasis: 'primary',
      available: true,
      run: () => actions.token(provider),
    },
  ];
}
