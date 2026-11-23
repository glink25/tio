import { HardDrive } from 'lucide-react';

import { platform } from '../../platform';
import type { ConnectionEntry, ConnectionEntryActions } from './types';

export function deviceEntries(actions: ConnectionEntryActions): ConnectionEntry[] {
  return [
    {
      id: 'device',
      label: platform().deviceLabel,
      icon: HardDrive,
      emphasis: 'secondary',
      available: true,
      run: actions.device,
    },
  ];
}
