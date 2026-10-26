import { applyCommit, object, createDomain, createDefaultRegistry, textBlock } from '@tio/core';
import { FileWorkspaceContent } from '@tio/file-storage';
import { LocalStore } from '@tio/local-store';
import { merge } from '@tio/merge';
import { MemoryProvider } from '@tio/provider-memory';
import { encode, pathFor } from '@tio/serialization';
import { SyncCore } from '@tio/sync';
import { expect, it } from 'vitest';

import { editBlocks } from '../packages/workspace/src/commands';

// Regression acceptance cases for the audited defects.
// See docs/architecture-review-2026-10-23.md for scope and remediation.
const page = () => object('page', 'review', { id: 'p', blocks: [textBlock('hello')] });

it('R01: a restore after an acknowledged deletion survives synchronization', async () => {
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

it('R02: moving a block to another parent retains its concurrent edit', () => {
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

it('R03: overlapping local document intents resolve without blocking the save queue', () => {
  const p = page();
  const local = [{ ...p.blocks![0], content: [{ type: 'text', text: 'left', styles: {} }] }];
  const remote = {
    ...p,
    blocks: [{ ...p.blocks![0], content: [{ type: 'text', text: 'right', styles: {} }] }],
  };
  expect(() => editBlocks(p.id, local, p.blocks!)([remote])).not.toThrow();
});

it('R04: the host rejects invalid known field values even when bypassing editor commands', () => {
  const db = object('database', 'review', {
    id: 'db',
    fields: [{ id: 'n', name: 'Number', type: 'number' }],
  });
  const row = object('record', 'review', {
    id: 'r',
    databaseId: 'db',
    properties: { n: 1 },
    blocks: [],
  });
  expect(() =>
    applyCommit(
      {
        version: 1,
        entries: [
          { object: db, revision: 1 },
          { object: row, revision: 1 },
        ],
      },
      {
        id: 'bad-value',
        expectedVersion: 1,
        changes: [{ ...row, properties: { n: 'not-a-number' } }],
        assetIds: [],
      },
    ),
  ).toThrow();
});

it('R05: registered validators apply to direct host commits', () => {
  const type = 'review-custom-validator';
  const domain = createDomain();
  domain.objects.register({
    type,
    currentVersion: 1,
    validate(value) {
      if (value.required !== true) throw new Error('Required flag missing');
      return value;
    },
  });
  expect(() =>
    applyCommit(
      { version: 0, entries: [] },
      {
        id: 'bad-plugin',
        expectedVersion: 0,
        changes: [object(type, 'review')],
        assetIds: [],
      },
      domain,
    ),
  ).toThrow();
});

it('R06: a malformed remote object does not block unrelated local publication', async () => {
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

it('R07 evidence: a minimal provider downloads an unchanged object once per sync', async () => {
  const store = new LocalStore('reads', crypto.randomUUID());
  const files = new MemoryProvider();
  const p = page();
  files.files.set(pathFor(p), encode(p));
  const core = new SyncCore(store, new FileWorkspaceContent(files, 'review'), 'e', 'review');
  try {
    await core.run();
    let reads = 0;
    const read = files.read.bind(files);
    files.read = (path) => {
      reads++;
      return read(path);
    };
    await core.run();
    expect(reads).toBe(1);
  } finally {
    store.close();
  }
});

it('R09: historical schemas are rejected instead of migrated', () => {
  const types = createDefaultRegistry();
  types.register({ type: 'review-current', currentVersion: 2, validate: (value) => value });
  expect(() => types.decode(object('review-current', 'review'))).toThrow('Unsupported schema');
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
