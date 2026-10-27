import { KeyRound } from 'lucide-react';

import { GitHubIcon } from '../../components/github-icon';
import { authOrigin } from '../github-auth';
import type { ConnectionEntry, ConnectionEntryActions } from './types';

export function githubEntries(actions: ConnectionEntryActions): ConnectionEntry[] {
  return [
    {
      id: 'github',
      label: 'welcome.github',
      icon: GitHubIcon,
      emphasis: 'primary',
      available: Boolean(authOrigin),
      hint: !authOrigin ? 'welcome.oauthUnavailable' : undefined,
      run: actions.github,
    },
    {
      id: 'github-token',
      iconOnly: true,
      label: 'welcome.token',
      icon: KeyRound,
      emphasis: 'primary',
      available: true,
      run: actions.token,
    },
  ];
}
