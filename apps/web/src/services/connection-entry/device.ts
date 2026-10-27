import { HardDrive } from 'lucide-react';

import type { ConnectionEntry, ConnectionEntryActions } from './types';

export function deviceEntries(actions: ConnectionEntryActions): ConnectionEntry[] {
  return [
    {
      id: 'device',
      label: 'welcome.offline',
      icon: HardDrive,
      emphasis: 'secondary',
      available: true,
      run: actions.device,
    },
  ];
}
