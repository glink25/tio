import { id, object, textBlock, repairTree, validate } from '@tio/core';
import { queryRecords } from '@tio/database';
import { FileWorkspaceContent } from '@tio/file-storage';
import { LocalStore } from '@tio/local-store';
import { merge } from '@tio/merge';
import { MemoryProvider } from '@tio/provider-memory';
import { canonical, encode, decode, exportZip, importZip, pathFor } from '@tio/serialization';
import { HostSyncRunner } from '@tio/sync';
import { describe, it, expect, afterEach } from 'vitest';
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
const page = () =>
  object('page', 'base_1', {
    id: 'page_1',
    title: 'Test',
    parentId: null,
    blocks: [textBlock('hello world')],
  });
afterEach(() => {
  stores.forEach((s) => s.close());
  engines.forEach((e) => e.stop());
});
describe('canonical objects', () => {
  it('preserves unknown fields, blocks and versions', () => {
    const p = page();
    p.extra = { future: 42 };
    p.blocks!.push({
      id: 'future',
      type: 'whiteboard',
      props: { new: true },
      content: [],
      children: [],
    });
    expect(decode(encode(p))).toEqual(p);
    expect(canonical({ b: 1, a: 2 })).toBe(canonical({ a: 2, b: 1 }));
    expect(() => validate({ ...p, schemaVersion: 2 })).toThrow('Unsupported schema');
  });
  it('rejects unsafe IDs and malformed blocks', () => {
    expect(() => validate({ ...page(), id: '../file' })).toThrow();
    expect(() => validate({ ...page(), blocks: null })).toThrow();
  });
  it('repairs cycles deterministically', () => {
    const a = { ...page(), id: 'a', parentId: 'b' },
      b = { ...page(), id: 'b', parentId: 'a' };
    expect(repairTree([a, b]).find((o) => o.id === 'a')?.parentId).toBeNull();
    expect(repairTree([b, a]).find((o) => o.id === 'a')?.parentId).toBeNull();
  });
  it('exports complete portable backup including binary assets', async () => {
    const base = object('workspace', 'base_1', { id: 'base_1', name: 'Backup' });
    const asset = object('asset', 'base_1', {
      id: 'asset_1',
      assetPath: 'assets/asset_1.png',
      filename: 'a.png',
      mime: 'image/png',
      byteSize: 3,
    });
    const zip = await exportZip([base, page(), asset], async () => new TextEncoder().encode('abc'));
    const imported = await importZip(zip);
    expect(imported.objects).toHaveLength(3);
    expect(new TextDecoder().decode(imported.assets.get('asset_1'))).toBe('abc');
  });
});
describe('merge', () => {
  it('combines independent fields symmetrically', () => {
    const b = object('record', 'base_1', {
      id: 'r',
      databaseId: 'db',
      properties: { a: 1, b: 2 },
      blocks: [],
    });
    const l = { ...b, properties: { a: 3, b: 2 } },
      r = { ...b, properties: { a: 1, b: 4 } };
    expect(merge(b, l, r).merged.properties).toEqual({ a: 3, b: 4 });
    expect(merge(b, l, r).merged).toEqual(merge(b, r, l).merged);
  });
  it('diff3 combines independent text edits', () => {
    const b = page();
    b.blocks![0].content = [{ type: 'text', text: 'hello world', styles: {} }];
    const l = structuredClone(b),
      r = structuredClone(b);
    (l.blocks![0].content as any)[0].text = 'HELLO world';
    (r.blocks![0].content as any)[0].text = 'hello WORLD';
    expect((merge(b, l, r).merged.blocks![0].content as any)[0].text).toBe('HELLO WORLD');
  });
  it('conflict fallback is symmetric and idempotent', () => {
    const b = page(),
      l = { ...b, title: 'A' },
      r = { ...b, title: 'B' };
    expect(merge(b, l, r).merged).toEqual(merge(b, r, l).merged);
    expect(merge(b, l, l).merged).toEqual(l);
    expect(merge(b, l, r).recovered.length).toBeGreaterThan(0);
  });
  it('delete wins but retains recovered edit', () => {
    const b = page();
    const result = merge(b, { ...b, deleted: true }, { ...b, title: 'edit' });
    expect(result.merged.deleted).toBe(true);
    expect(result.recovered.length).toBeGreaterThan(0);
  });
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
  });
  it('blocks business publication if attachment cannot upload', async () => {
    const s = store(),
      p = new MemoryProvider(),
      asset = object('asset', 'base_1', {
        id: 'asset_1',
        assetPath: 'assets/asset_1.png',
        mime: 'image/png',
        byteSize: 3,
      });
    const linkedPage = page();
    linkedPage.blocks![0].props.url = 'asset:asset_1';
    await s.batch([asset, linkedPage], new Map([['asset_1', new Blob(['abc'])]]));
    p.beforeWrite = async (path) => {
      if (path.endsWith('.png')) throw new Error('disk full');
    };
    await engine(s, p).sync();
    expect(p.files.has(pathFor(page()))).toBe(false);
  });
  it('reads future schema without overwriting it', async () => {
    const s = store(),
      p = new MemoryProvider(),
      o = { ...page(), schemaVersion: 2 };
    p.files.set(pathFor(o), new TextEncoder().encode(canonical(o)));
    const e = engine(s, p);
    await e.sync();
    expect(await s.get(o.id)).toBeUndefined();
    expect(e.issues.length).toBe(1);
  });
  it('queries numeric sort and field filter', () => {
    const db = object('database', 'base_1', { fields: [{ id: 'n', type: 'number', name: 'n' }] });
    const rs = [10, 2, 3].map((n) =>
      object('record', 'base_1', { databaseId: db.id, properties: { n }, blocks: [] }),
    );
    const v = object('databaseView', 'base_1', {
      sorts: [{ fieldId: 'n', direction: 'asc' }],
      filters: [],
    });
    expect(queryRecords(rs, db, v).map((r) => r.properties!.n)).toEqual([2, 3, 10]);
  });
});

it('preserves emoji graphemes when merging independent text edits', () => {
  const b = page();
  b.blocks![0].content = [{ type: 'text', text: '👨‍👩‍👧‍👦 hello world', styles: {} }];
  const l = structuredClone(b),
    r = structuredClone(b);
  (l.blocks![0].content as { text: string }[])[0].text = '👨‍👩‍👧‍👦 HELLO world';
  (r.blocks![0].content as { text: string }[])[0].text = '👨‍👩‍👧‍👦 hello WORLD';
  expect((merge(b, l, r).merged.blocks![0].content as { text: string }[])[0].text).toBe(
    '👨‍👩‍👧‍👦 HELLO WORLD',
  );
});
