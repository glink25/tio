import { deviceEntries } from './device';
import { folderEntries } from './folder';
import { gitEntries } from './github';
import type { ConnectionEntryActions } from './types';

export function connectionEntries(actions: ConnectionEntryActions) {
  return [
    (a: ConnectionEntryActions) => gitEntries('github', a),
    (a: ConnectionEntryActions) => gitEntries('gitee', a),
    folderEntries,
    deviceEntries,
  ].flatMap((entries) => {
    const buttons = entries(actions).filter((entry) => entry.available);
    return buttons.length ? [{ id: buttons[0].id, label: buttons[0].label, buttons }] : [];
  });
}
