import type {
  HostPreferences,
  WorkspaceCatalog,
  WorkspaceDescriptor,
  WorkspacePreferences,
  WorkspaceSession,
} from '@tio/core';
import { HostError } from '@tio/core';

import { openHostDatabase } from './database';
/** Catalog and personal preferences are separate from workspace business repositories. */
export class LocalCatalog implements HostPreferences, WorkspaceCatalog {
  private db = openHostDatabase('tio-workspaces');
  async list(): Promise<WorkspaceDescriptor[]> {
    return (await this.db).getAll('sessions');
  }
  async sessions(): Promise<WorkspaceSession[]> {
    return Promise.all(
      (await this.list()).map(async (descriptor) => ({
        ...descriptor,
        ...(((await this.read('preferences/' + descriptor.id)) as WorkspacePreferences) ?? {}),
      })),
    );
  }
  async saveSession(session: WorkspaceSession) {
    const { selectedId, favorites, ...descriptor } = session;
    const tx = (await this.db).transaction(['sessions', 'settings'], 'readwrite');
    if (await tx.objectStore('settings').get('workspace-lifecycle/' + session.id)) {
      await tx.done;
      throw new HostError('closed');
    }
    await tx.objectStore('sessions').put(descriptor, descriptor.id);
    await tx.objectStore('settings').put({ selectedId, favorites }, 'preferences/' + descriptor.id);
    await tx.done;
  }
  async removeSession(id: string) {
    const tx = (await this.db).transaction(['sessions', 'settings'], 'readwrite');
    await tx.objectStore('sessions').delete(id);
    await tx.objectStore('settings').delete('preferences/' + id);
    if ((await tx.objectStore('settings').get('active')) === id)
      await tx.objectStore('settings').delete('active');
    await tx.done;
  }
  async read(key: string): Promise<any> {
    return (await this.db).get('settings', key);
  }
  async write(key: string, value: unknown) {
    await (await this.db).put('settings', value, key);
  }
  setting(key: string, ...values: [unknown?]) {
    return values.length ? this.write(key, values[0]) : this.read(key);
  }
  async close() {
    (await this.db).close();
  }
}
