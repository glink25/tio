import { applyCommit, object, registry, textBlock } from '@tio/core';
import { LocalStore } from '@tio/local-store';
import { merge } from '@tio/merge';
import { MemoryProvider } from '@tio/provider-memory';
import { encode, pathFor } from '@tio/serialization';
import { FileWorkspaceContent, SyncCore } from '@tio/sync';
import { expect, it } from 'vitest';

import { editBlocks } from '../packages/workspace/src/commands';

// Known defects, not acceptance passes. Remove `.fails` when each finding is fixed.
// See docs/architecture-review-2026-10-23.md for scope and remediation.
const page = () => object('page', 'review', { id: 'p', blocks: [textBlock('hello')] });

it.fails('R01: a restore after an acknowledged deletion survives synchronization', async () => {
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

it.fails('R02: moving a block to another parent retains its concurrent edit', () => {
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

it.fails('R03: overlapping local document intents resolve without blocking the save queue', () => {
  const p = page();
  const local = [{ ...p.blocks![0], content: [{ type: 'text', text: 'left', styles: {} }] }];
  const remote = {
    ...p,
    blocks: [{ ...p.blocks![0], content: [{ type: 'text', text: 'right', styles: {} }] }],
  };
  expect(() => editBlocks(p.id, local, p.blocks!)([remote])).not.toThrow();
});

it.fails('R04: the host rejects invalid known field values even when bypassing editor commands', () => {
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

it.fails('R05: registered validators apply to direct host commits', () => {
  const type = 'review-custom-validator';
  registry().register({
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
    ),
  ).toThrow();
});

it.fails('R06: a malformed remote object does not block unrelated local publication', async () => {
  const store = new LocalStore('isolation', crypto.randomUUID());
  const files = new MemoryProvider();
  files.files.set('workspaces/review/pages/broken.json', new TextEncoder().encode('{broken'));
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

it('R07 evidence: an unchanged object is downloaded three times per sync', async () => {
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
    expect(reads).toBe(3);
  } finally {
    store.close();
  }
});

it.fails('R09: upgrading an existing local object from a supported remote version reaches durable storage', async () => {
  const type = 'review-migration';
  const old = object(type, 'review', { id: 'm', name: 'old' });
  const store = new LocalStore('migration', crypto.randomUUID());
  const files = new MemoryProvider();
  try {
    await store.put(old);
    registry().register({
      type,
      currentVersion: 2,
      validate: (value) => value,
      migrations: { 1: (value) => ({ ...value, schemaVersion: 2, name: 'migrated' }) },
    });
    files.files.set(pathFor(old), encode(old));
    const core = new SyncCore(store, new FileWorkspaceContent(files, 'review'), 'e', 'review');
    await core.run();
    expect((await store.get('m'))?.object.schemaVersion).toBe(2);
  } finally {
    store.close();
  }
});
