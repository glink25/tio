import { object, textBlock } from '@tio/core';
import { FileWorkspaceContent } from '@tio/file-storage';
import { LocalStore } from '@tio/local-store';
import { merge } from '@tio/merge';
import { MemoryProvider } from '@tio/provider-memory';
import { pathFor } from '@tio/serialization';
import { SyncCore } from '@tio/sync';
import { expect, it } from 'vitest';

const page = () => object('page', 'review', { id: 'p', blocks: [textBlock('hello')] });

it('a restore after an acknowledged deletion survives synchronization', async () => {
  const store = new LocalStore('restore', crypto.randomUUID());
  const core = new SyncCore(
    store,
    new FileWorkspaceContent(new MemoryProvider(), 'review'),
    'e',
    'review',
  );
  try {
    const p = page();
    await store.put(p);
    await core.run();
    await store.put({ ...p, deleted: true });
    await core.run();
    await store.put({ ...p, deleted: false });
    await core.run();
    expect((await store.get('p'))?.object.deleted).toBe(false);
  } finally {
    store.close();
  }
});

it('moving a block to another parent retains its concurrent edit', () => {
  const p = page();
  const a = { ...textBlock('A'), id: 'a' };
  const b = { ...textBlock('B'), id: 'b' };
  const x = { ...textBlock('original'), id: 'x' };
  p.blocks = [{ ...a, children: [x] }, b];
  const local = { ...p, blocks: [a, { ...b, children: [x] }] };
  const remote = {
    ...p,
    blocks: [
      { ...a, children: [{ ...x, content: [{ type: 'text', text: 'edited', styles: {} }] }] },
      b,
    ],
  };
  const result = merge(p, local, remote);
  expect(result.merged.blocks?.[1].children[0]?.content).toEqual([
    { type: 'text', text: 'edited', styles: {} },
  ]);
});

it('a malformed remote object does not block unrelated local publication', async () => {
  const store = new LocalStore('isolation', crypto.randomUUID());
  const files = new MemoryProvider();
  files.files.set('workspaces/review/objects/broken.json', new TextEncoder().encode('{broken'));
  const core = new SyncCore(store, new FileWorkspaceContent(files, 'review'), 'e', 'review');
  try {
    const p = page();
    await store.put(p);
    await core.run().catch(() => undefined);
    expect(files.files.has(pathFor(p))).toBe(true);
  } finally {
    store.close();
  }
});

it('repairs proven concurrent parent cycles without detaching missing parents', async () => {
  const { repairTree } = await import('@tio/core');
  const a = object('page', 'w', { id: 'a', parentId: 'b', blocks: [] });
  const b = object('page', 'w', { id: 'b', parentId: 'a', blocks: [] });
  const child = object('page', 'w', { id: '0', parentId: 'b', blocks: [] });
  const orphan = object('page', 'w', { id: 'orphan', parentId: 'unavailable', blocks: [] });
  const repaired = repairTree([child, b, orphan, a]);
  expect(repaired.find((o) => o.id === 'a')?.parentId).toBeNull();
  expect(repaired.find((o) => o.id === '0')).toBe(child);
  expect(repaired.find((o) => o.id === 'orphan')).toBe(orphan);
  const store = new LocalStore('cycles', crypto.randomUUID());
  const content = new FileWorkspaceContent(new MemoryProvider(), 'w');
  try {
    await store.batch([{ ...a, parentId: null }, b]);
    await content.write(a);
    await content.write(b);
    await new SyncCore(store, content, 'e', 'w').run();
    expect((await store.get('a'))?.object.parentId).toBeNull();
  } finally {
    store.close();
  }
});
