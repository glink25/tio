import { FolderOpen } from 'lucide-react';

import { folderSupported } from '../folder-access';
import type { ConnectionEntry, ConnectionEntryActions } from './types';

export function folderEntries(actions: ConnectionEntryActions): ConnectionEntry[] {
  const available = folderSupported();
  return [
    {
      id: 'folder',
      label: 'welcome.folder',
      icon: FolderOpen,
      emphasis: 'secondary',
      available,
      run: actions.folder,
    },
  ];
}
