import { supported } from '@tio/adapter-local-folder';
import { FolderOpen } from 'lucide-react';

import type { ConnectionEntry, ConnectionEntryActions } from './types';

export function folderEntries(actions: ConnectionEntryActions): ConnectionEntry[] {
  const available = supported();
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
