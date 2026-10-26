import { fullAccess, object, type AccessPolicy } from '@tio/core';
import { FileWorkspaceContent } from '@tio/file-storage';
import { LocalStore } from '@tio/local-store';
import { MemoryProvider } from '@tio/provider-memory';
import { HostSyncRunner } from '@tio/sync';
import { WorkspaceRuntime } from '@tio/workspace';
import { it, expect } from 'vitest';
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
it('fresh remote permission prevents publication but preserves the local draft until discarded', async () => {
  const host = new LocalStore('permission', crypto.randomUUID());
  const files = new MemoryProvider();
  const content = new FileWorkspaceContent(files, 'w');
  let policy: AccessPolicy = fullAccess;
  content.authorize = async () => policy;
  const engine = new HostSyncRunner(host, content, 'endpoint', 'w');
  const runtime = await WorkspaceRuntime.open(host);
  try {
    runtime.create([object('page', 'w', { id: 'p', title: 'Published', blocks: [] })]);
    await runtime.flush();
    await engine.sync();
    policy = { version: 'revoked', allows: (_r, operation) => operation === 'read' };
    runtime.patch('p', { title: 'Offline draft' });
    await runtime.flush();
    await engine.sync();
    expect(engine.status).toBe('permission');
    expect((await host.get('p'))?.object.title).toBe('Offline draft');
    expect((await content.read('p'))?.title).toBe('Published');
    await engine.discard('p');
    expect((await host.get('p'))?.object.title).toBe('Published');
  } finally {
    await runtime.close();
    await engine.stop();
    host.close();
  }
});
it('propagates mid-publication authorization expiry to the host instead of an object conflict', async () => {
  const { ConnectionAccessError } = await import('@tio/core');
  const host = new LocalStore('expired', crypto.randomUUID());
  const content = new FileWorkspaceContent(new MemoryProvider(), 'w');
  const error = new ConnectionAccessError({
    code: 'reauthorization-required',
    scope: { connectionId: 'remote' },
  });
  content.write = async () => {
    throw error;
  };
  const failures: unknown[] = [];
  const runner = new HostSyncRunner(host, content, 'remote', 'w', {
    onError: (failure) => failures.push(failure),
  });
  try {
    await host.batch([object('page', 'w', { id: 'p', title: 'Draft', blocks: [] })]);
    await runner.sync();
    expect(failures).toEqual([error]);
    expect((await host.get('p'))?.object.title).toBe('Draft');
  } finally {
    await runner.stop();
    host.close();
  }
});
