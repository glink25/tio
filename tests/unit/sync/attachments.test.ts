import { object } from '@tio/core';
import { FileWorkspaceContent } from '@tio/file-storage';
import { LocalStore } from '@tio/local-store';
import { MemoryProvider } from '@tio/provider-memory';
import { HostSyncRunner } from '@tio/sync';
import { expect, it } from 'vitest';
it('repaired binary is promoted even when metadata is unchanged and survives staging cleanup', async () => {
  const host = new LocalStore('repair', crypto.randomUUID());
  const files = new MemoryProvider();
  const asset = object('asset', 'w', {
    id: 'asset',
    assetPath: 'assets/asset.bin',
    mime: 'application/octet-stream',
    byteSize: 3,
  });
  const engine = new HostSyncRunner(host, new FileWorkspaceContent(files, 'w'), 'folder', 'w');
  try {
    await host.batch([asset], new Map([['asset', new Blob(['abc'])]]));
    await engine.sync();
    await (await host.db).delete('assets', 'repair/asset');
    expect(await host.readAsset('asset')).toBeUndefined();
    await engine.sync();
    await host.releaseAsset('asset');
    expect(new TextDecoder().decode((await host.readAsset('asset'))?.bytes)).toBe('abc');
  } finally {
    await engine.stop();
    host.close();
  }
});
