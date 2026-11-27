import { invoke } from '@tauri-apps/api/core';
import { HostError } from '@tio/core';
import { ReplicaRepository } from '@tio/native-core/replica';

import { createHostCatalog } from './catalog';

export class NativeReplica extends ReplicaRepository {
  storageComplete = false;
  private catalog = createHostCatalog();
  constructor(instanceId: string, space: string) {
    super(instanceId, space, async (space, action, args) => {
      try {
        return await invoke('workspace', {
          space,
          replica: instanceId,
          request: { action, ...args },
        });
      } catch (code) {
        if (code === 'invalid' || code === 'closed' || code === 'unavailable')
          throw new HostError(code);
        throw code;
      }
    });
    void this.isComplete().catch(() => this.relations.invalidate('ready'));
  }
  async isComplete() {
    if (
      !this.storageComplete &&
      (await this.catalog.read('replica-complete/' + this.instanceId)) === true
    ) {
      this.storageComplete = true;
      this.relations.invalidate('ready');
    }
    return this.storageComplete;
  }
  override async readChanges(since: number) {
    await this.isComplete();
    return super.readChanges(since);
  }
  async setComplete() {
    await this.catalog.write('replica-complete/' + this.instanceId, true);
    this.storageComplete = true;
  }
}
