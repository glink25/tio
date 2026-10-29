import { id, object, visibility } from '@tio/core';
import { FileWorkspaceContent } from '@tio/file-storage';
import { LocalStore } from '@tio/local-store';
import { MemoryProvider } from '@tio/provider-memory';
import { decode, pathFor } from '@tio/serialization';
import { HostSyncRunner, SyncCore } from '@tio/sync';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { basePage as page } from '../../fixtures/objects';
const stores: LocalStore[] = [];
const engines: HostSyncRunner[] = [];
const store = () => {
  const s = new LocalStore(id('instance'), id('db'));
  stores.push(s);
  return s;
};
const engine = (s: LocalStore, p: MemoryProvider) => {
  const e = new HostSyncRunner(s, new FileWorkspaceContent(p, 'base_1'), 'endpoint', 'base_1');
  engines.push(e);
  return e;
};
afterEach(() => {
  stores.forEach((s) => s.close());
  engines.forEach((e) => e.stop());
});
describe('persistence and synchronization', () => {
  it('rejects stale revisions', async () => {
    const s = store(),
      p = page();
    await s.put(p);
    await s.put({ ...p, title: 'new' }, 1);
    await expect(s.put({ ...p, title: 'stale' }, 1)).rejects.toThrow();
    expect((await s.get(p.id))?.object.title).toBe('new');
  });
  it('roundtrips through minimum file provider into fresh store', async () => {
    const a = store(),
      b = store(),
      p = new MemoryProvider(),
      o = page();
    await a.put(o);
    await engine(a, p).sync();
    await engine(b, p).sync();
    expect((await b.get(o.id))?.object).toEqual(o);
  });
  it('merges two independently edited records', async () => {
    const a = store(),
      b = store(),
      p = new MemoryProvider(),
      o = object('record', 'base_1', {
        id: 'r',
        databaseId: 'db',
        properties: { a: 1, b: 1 },
        blocks: [],
      });
    await a.put(o);
    const ea = engine(a, p),
      eb = engine(b, p);
    await ea.sync();
    await eb.sync();
    await a.put({ ...o, properties: { a: 2, b: 1 } });
    await b.put({ ...o, properties: { a: 1, b: 3 } });
    await ea.sync();
    await eb.sync();
    await ea.sync();
    expect((await a.get(o.id))?.object.properties).toEqual({ a: 2, b: 3 });
  });
  it('does not clear edits made during upload', async () => {
    const s = store(),
      p = new MemoryProvider(),
      o = page();
    await s.put(o);
    p.beforeWrite = async () => {
      p.beforeWrite = undefined;
      await s.put({ ...o, title: 'new during upload' });
    };
    const e = engine(s, p);
    await e.sync();
    const current = await s.get(o.id);
    expect(current!.object.title).toBe('new during upload');
    expect(current!.revision).toBeGreaterThan(current!.sync.endpoint.revision);
    await e.sync();
    expect(decode(p.files.get(pathFor(o))!).title).toBe('new during upload');
  });
  it('does not overwrite invalid external JSON or missing managed files', async () => {
    const s = store(),
      p = new MemoryProvider(),
      o = page();
    await s.put(o);
    const e = engine(s, p);
    await e.sync();
    p.files.set(pathFor(o), new TextEncoder().encode('{broken'));
    await e.sync();
    expect(e.issues.length).toBe(1);
    expect(new TextDecoder().decode(p.files.get(pathFor(o)))).toBe('{broken');
    p.files.delete(pathFor(o));
    await e.sync();
    expect(e.issues[0].code).toBe('missing');
    expect(p.files.has(pathFor(o))).toBe(false);
    await e.restore(o.id);
    expect(p.files.has(pathFor(o))).toBe(true);
  });
  it('preserves pending draft on write failure and retries idempotently', async () => {
    const s = store(),
      p = new MemoryProvider(),
      o = page();
    await s.put(o);
    p.beforeWrite = async () => {
      throw new Error('disk full');
    };
    const e = engine(s, p);
    await e.sync();
    expect((await s.get(o.id))?.sync.endpoint).toBeUndefined();
    p.beforeWrite = undefined;
    await e.sync();
    expect((await s.get(o.id))?.sync.endpoint.base).toEqual(o);
  });
  it('uploads attachments before pages and restores them into fresh cache', async () => {
    const a = store(),
      b = store(),
      p = new MemoryProvider(),
      asset = object('asset', 'base_1', {
        id: 'asset_1',
        assetPath: 'assets/asset_1.png',
        mime: 'image/png',
        filename: 'a.png',
        byteSize: 3,
      });
    await a.batch([asset, page()], new Map([['asset_1', new Blob(['abc'])]]));
    const writes: string[] = [];
    p.beforeWrite = async (path) => {
      writes.push(path);
    };
    await engine(a, p).sync();
    expect(writes[0]).toBe('workspaces/base_1/assets/asset_1.png');
    await engine(b, p).sync();
    expect(await (await b.blob('asset_1'))?.text()).toBe('abc');
    const content = new FileWorkspaceContent(p, 'base_1');
    await content.write(object('workspace', 'base_1', { id: 'base_1', name: 'Remote' }));
    const acquiring = store();
    const initial = new SyncCore(acquiring, content, 'endpoint', 'base_1');
    await initial.pull();
    expect(initial.issues).toEqual([]);
    expect(await (await acquiring.blob('asset_1'))?.text()).toBe('abc');
    // An interrupted eager replica may have metadata but require its bytes to be restored.
    await (await acquiring.db).delete('assets', acquiring.instanceId + '/asset_1');
    await initial.pull();
    expect(initial.issues).toEqual([]);
    expect(await (await acquiring.blob('asset_1'))?.text()).toBe('abc');
  });
  it.each(['blocks', 'icon', 'cover'] as const)(
    'blocks publication if a %s attachment cannot upload',
    async (kind) => {
      const s = store(),
        p = new MemoryProvider(),
        asset = object('asset', 'base_1', {
          id: 'asset_1',
          assetPath: 'assets/asset_1.png',
          mime: 'image/png',
          byteSize: 3,
        });
      const linkedPage = page();
      if (kind === 'blocks') linkedPage.blocks![0].props.url = 'asset:asset_1';
      else if (kind === 'icon') linkedPage.icon = { type: 'image', url: 'asset:asset_1' };
      else linkedPage.cover = { type: 'image', url: 'asset:asset_1', positionY: 0.5 };
      await s.batch([asset, linkedPage], new Map([['asset_1', new Blob(['abc'])]]));
      p.beforeWrite = async (path) => {
        if (path.endsWith('.png')) throw new Error('disk full');
      };
      await engine(s, p).sync();
      expect(p.files.has(pathFor(page()))).toBe(false);
    },
  );
});

// These cases protect local receipts and editing while the initial replica is incomplete.
it('progressively receives pinned remote objects without publishing edits or fetching lazy assets', async () => {
  const local = store();
  local.remoteAssets = true;
  const files = new MemoryProvider();
  const writer = new FileWorkspaceContent(files, 'base_1');
  const workspace = object('workspace', 'base_1', {
    id: 'base_1',
    name: 'Remote',
    manualSync: true,
  });
  const parent = { ...page(), id: 'z_parent' };
  const child = { ...page(), id: 'a_child', parentId: parent.id };
  const slow = { ...page(), id: 'zz_slow' };
  const asset = object('asset', 'base_1', {
    id: 'asset',
    filename: 'a.txt',
    mime: 'text/plain',
    byteSize: 1,
    assetPath: 'assets/asset.txt',
  });
  child.blocks = [
    { id: 'image', type: 'image', props: { url: 'asset:asset' }, content: [], children: [] },
  ];
  for (const value of [workspace, parent, child, asset, slow]) await writer.write(value);
  let release!: () => void;
  const blocked = new Promise<void>((done) => {
    release = done;
  });
  const read = writer.read.bind(writer);
  const content = {
    attachmentPolicy: writer.attachmentPolicy,
    authorize: () => writer.authorize(),
    list: () => writer.list(),
    read: async (id: string) => {
      if (id === slow.id) await blocked;
      return read(id);
    },
    readAsset: vi.fn(async () => {
      throw new Error('Lazy asset bytes must not download');
    }),
    write: vi.fn(async () => {
      throw new Error('Initialization must not publish');
    }),
    writeAsset: vi.fn(async () => {
      throw new Error('Initialization must not publish');
    }),
  };
  const publish = vi.fn(async () => {
    throw new Error('Snapshot must remain read-only');
  });
  const core = new SyncCore(
    local,
    { ...content, snapshot: async () => ({ content, revision: 'pinned', publish }) },
    'e',
    'base_1',
  );
  const runtime = await (await import('@tio/workspace')).WorkspaceRuntime.open(local);
  const acquisition = core.pull();
  try {
    await vi.waitFor(async () => expect(await local.get(child.id)).toBeDefined());
    expect(await local.get(slow.id)).toBeUndefined();
    await runtime.poll();
    expect(
      runtime
        .snapshot()
        .filter(visibility(runtime.snapshot()))
        .map((o) => o.id),
    ).toContain(child.id);
    expect(await local.get(asset.id)).toBeDefined();
    await runtime.loadTarget(child.id);
    runtime.patch(child.id, { title: 'Edit during download' });
    await runtime.flush();
    release();
    await acquisition;
    expect(core.issues).toEqual([]);
    const entry = (await local.get(child.id))!;
    expect(entry.object.title).toBe('Edit during download');
    expect(entry.sync.e.base.title).toBe(child.title);
    expect(entry.revision).toBeGreaterThan(entry.sync.e.revision);
    expect(content.readAsset).not.toHaveBeenCalled();
    expect(publish).not.toHaveBeenCalled();
    await core.pull();
    expect((await local.get(child.id))!.object.title).toBe('Edit during download');
  } finally {
    release();
    await acquisition;
    runtime.dispose(true);
  }
});

it('retries a concurrent remote receipt and preserves its remote baseline atomically', async () => {
  const local = store();
  const files = new MemoryProvider();
  const content = new FileWorkspaceContent(files, 'base_1');
  const original = page();
  await content.write(object('workspace', 'base_1', { id: 'base_1', name: 'Remote' }));
  await content.write(original);
  await new SyncCore(local, content, 'e', 'base_1').pull();
  await content.write({ ...original, icon: 'remote-icon' });
  const receive = local.receiveRemote.bind(local);
  vi.spyOn(local, 'receiveRemote').mockImplementationOnce(async (...args) => {
    await local.put({ ...original, title: 'Concurrent local title' });
    return receive(...args);
  });
  const core = new SyncCore(local, content, 'e', 'base_1');
  await core.pull();
  expect(core.issues).toEqual([]);
  const entry = (await local.get(original.id))!;
  expect(entry.object).toMatchObject({ title: 'Concurrent local title', icon: 'remote-icon' });
  expect(entry.sync.e.base).toMatchObject({ title: original.title, icon: 'remote-icon' });
  expect(entry.revision).toBeGreaterThan(entry.sync.e.revision);
  const before = await local.readSnapshot();
  await expect(
    local.receiveRemote({ ...entry.object, title: 1 } as never, entry.revision, 'e', original),
  ).rejects.toThrow();
  expect(await local.readSnapshot()).toEqual(before);
  expect(await local.get(original.id)).toEqual(entry);
});

it('keeps acquired pages when another object is corrupt and resumes without overwriting local input', async () => {
  const local = store();
  const files = new MemoryProvider();
  const content = new FileWorkspaceContent(files, 'base_1');
  const original = { ...page(), id: 'a' };
  const broken = { ...page(), id: 'z' };
  await content.write(object('workspace', 'base_1', { id: 'base_1', name: 'Remote' }));
  await content.write(original);
  await content.write(broken);
  files.files.set(pathFor(broken), new TextEncoder().encode('{broken'));
  const core = new SyncCore(local, content, 'e', 'base_1');
  await core.pull();
  expect(core.issues).toHaveLength(1);
  expect(await local.get(original.id)).toBeDefined();
  await local.put({ ...original, title: 'Local draft' });
  await content.write(broken);
  await core.pull();
  expect(core.issues).toEqual([]);
  expect((await local.get(original.id))!.object.title).toBe('Local draft');
  expect(await local.get(broken.id)).toBeDefined();
});

it('does not repair a partial parent cycle or invent a missing parent', async () => {
  const local = store();
  const files = new MemoryProvider();
  const content = new FileWorkspaceContent(files, 'base_1');
  const a = { ...page(), id: 'a', parentId: 'b' };
  const b = { ...page(), id: 'b', parentId: 'a' };
  await content.write(object('workspace', 'base_1', { id: 'base_1', name: 'Remote' }));
  await content.write(a);
  const core = new SyncCore(local, content, 'e', 'base_1');
  await core.pull();
  expect(core.issues[0].code).toBe('missing');
  expect((await local.get('a'))!.object.parentId).toBe('b');
  await content.write(b);
  await core.pull();
  expect(core.issues).toEqual([]);
  expect((await local.get('a'))!.object.parentId).toBeNull();
  expect((await local.get('a'))!.sync.e.base.parentId).toBe('b');
});
