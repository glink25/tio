import { fullAccess, object, type Block, type AccessPolicy } from '@tio/core';
import { MemoryRepository } from '@tio/provider-memory';
import { WorkspaceRuntime } from '@tio/workspace';
import { describe, expect, it } from 'vitest';

import { SliceBroker } from '../packages/web-editor/src/web-slice/broker';
import { runnerDocument } from '../packages/web-editor/src/web-slice/runner';

async function fixture(access: AccessPolicy = fullAccess) {
  const slice: Block = {
    id: 'slice',
    type: 'webSlice',
    props: { title: 'test', html: '<h1>Hi</h1>', runtimeVersion: 1, height: 320, autoHeight: true },
    content: [],
    children: [],
  };
  const page = object('page', 'w', { id: 'p', title: 'Page', blocks: [slice] });
  const hidden = object('database', 'w', {
    id: 'secret',
    name: 'Secret',
    fields: [{ id: 'x', name: 'Secret', type: 'text' }],
  });
  const repository = new MemoryRepository();
  await repository.commit({
    id: 'seed',
    expectedVersion: 0,
    changes: [page, hidden],
    assetIds: [],
  });
  const runtime = await WorkspaceRuntime.open(repository, access);
  let write = false,
    readOnly = false;
  const broker = new SliceBroker({
    runtime,
    pageId: 'p',
    blockId: 'slice',
    workspaceId: 'w',
    permission: () => ({ data: write ? 'readWrite' : 'read', allowExternalResources: false }),
    readOnly: () => readOnly,
    context: () => ({}),
    resize: () => {},
  });
  return {
    broker,
    runtime,
    repository,
    page,
    write: () => {
      write = true;
    },
    revoke: () => {
      write = false;
    },
    forceReadOnly: () => {
      readOnly = true;
    },
  };
}
const database = {
  name: 'Ledger',
  fields: [
    { id: 'amount', name: 'Amount', type: 'number' },
    { id: 'note', name: 'Note', type: 'title' },
  ],
};
describe('Web Slice authority and writes', () => {
  it('defaults read-only and refuses guessed resources and general host methods', async () => {
    const f = await fixture();
    expect(await f.broker.invoke('databases.list')).toEqual([]);
    await expect(f.broker.invoke('databases.get', { databaseId: 'secret' })).rejects.toMatchObject({
      code: 'PERMISSION_DENIED',
    });
    await expect(f.broker.invoke('databases.create', database)).rejects.toMatchObject({
      code: 'PERMISSION_DENIED',
    });
    await expect(f.broker.invoke('readSnapshot')).rejects.toBeDefined();
    f.broker.dispose();
    await f.runtime.close();
  });
  it('initializes, persists, deduplicates, edits with version checks and undoes writes', async () => {
    const f = await fixture();
    f.write();
    const db: any = await f.broker.invoke('databases.create', database, 'init');
    expect(await f.broker.invoke('databases.create', database, 'init')).toEqual(db);
    const record: any = await f.broker.invoke(
      'records.create',
      { databaseId: db.id, properties: { amount: 12 } },
      'entry',
    );
    await f.broker.invoke(
      'records.create',
      { databaseId: db.id, properties: { amount: 12 } },
      'entry',
    );
    expect(
      (await f.repository.readSnapshot()).entries.filter((e) => e.object.type === 'record'),
    ).toHaveLength(1);
    await f.broker.invoke('records.update', {
      databaseId: db.id,
      id: record.id,
      version: record.version,
      properties: { amount: 20 },
    });
    await expect(
      f.broker.invoke('records.update', {
        databaseId: db.id,
        id: record.id,
        version: record.version,
        properties: { amount: 30 },
      }),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
    f.runtime.undo();
    await f.runtime.flush();
    expect(
      ((await f.broker.invoke('records.get', { databaseId: db.id, id: record.id })) as any)
        .properties.amount,
    ).toBe(12);
    f.broker.dispose();
    await f.runtime.close();
  });
  it('rejects self-expansion, rewriting another slice and ancestor removal', async () => {
    const f = await fixture();
    f.write();
    const page: any = await f.broker.invoke('page.get');
    const reference = {
      id: 'ref',
      type: 'databaseView',
      props: { databaseId: 'secret' },
      content: [],
      children: [],
    };
    await expect(
      f.broker.invoke('page.insertBlocks', { version: page.version, blocks: [reference] }),
    ).rejects.toMatchObject({ code: 'PERMISSION_DENIED' });
    await expect(
      f.broker.invoke('page.updateBlock', {
        version: page.version,
        id: 'slice',
        changes: { props: { ...f.page.blocks![0].props, html: '<script>evil()</script>' } },
      }),
    ).rejects.toMatchObject({ code: 'PERMISSION_DENIED' });
    await expect(
      f.broker.invoke('page.removeBlock', { version: page.version, id: 'slice' }),
    ).rejects.toMatchObject({ code: 'PERMISSION_DENIED' });
    f.broker.dispose();
    await f.runtime.close();
  });
  it('ignores view filters by default, redacts record bodies, revokes removed references', async () => {
    const f = await fixture();
    f.write();
    const db: any = await f.broker.invoke('databases.create', database);
    await f.broker.invoke('records.create', { databaseId: db.id, properties: { amount: 4 } });
    await f.broker.invoke('records.create', { databaseId: db.id, properties: { amount: 9 } });
    const view: any = await f.broker.invoke('views.create', {
      databaseId: db.id,
      changes: { filters: [{ fieldId: 'amount', op: 'eq', value: 4 }] },
    });
    const all: any = await f.broker.invoke('records.query', { databaseId: db.id });
    expect(all.records).toHaveLength(2);
    expect(all.records[0]).not.toHaveProperty('blocks');
    expect(
      ((await f.broker.invoke('records.query', { databaseId: db.id, viewId: view.id })) as any)
        .records,
    ).toHaveLength(1);
    f.runtime.patch('p', { blocks: f.page.blocks });
    await f.runtime.flush();
    await expect(f.broker.invoke('records.query', { databaseId: db.id })).rejects.toMatchObject({
      code: 'PERMISSION_DENIED',
    });
    f.broker.dispose();
    await f.runtime.close();
  });
  it('rechecks permission for queued calls and enforces host read-only', async () => {
    const f = await fixture();
    f.write();
    const result = f.broker.invoke('databases.create', database);
    f.revoke();
    await expect(result).rejects.toMatchObject({ code: 'PERMISSION_DENIED' });
    f.write();
    f.forceReadOnly();
    await expect(f.broker.invoke('databases.create', database)).rejects.toMatchObject({
      code: 'PERMISSION_DENIED',
    });
    f.broker.dispose();
    await f.runtime.close();
  });
  it('does not emit events for unrelated database writes', async () => {
    const f = await fixture();
    const events: unknown[] = [];
    f.broker.subscribe((e) => events.push(e));
    f.runtime.patch('secret', { name: 'Renamed' });
    await f.runtime.flush();
    expect(events).toHaveLength(0);
    f.broker.dispose();
    await f.runtime.close();
  });
});
it('places immutable CSP before the bootstrap and keeps user source out of it', () => {
  const html = runnerDocument('session', false);
  expect(html.indexOf('Content-Security-Policy')).toBeLessThan(html.indexOf('<script>'));
  expect(html).toContain("connect-src 'none'");
  expect(runnerDocument('session', true)).toContain('connect-src https: wss:');
});

it('commit guard revocation rejects queued atomic writes without leaving a poisoned queue', async () => {
  const f = await fixture();
  let allow = true;
  const old = f.runtime.snapshot().find((o) => o.id === 'p')!;
  const pending = f.runtime.checked([old], [{ ...old, title: 'Never commit' }], () => {
    if (!allow) throw new Error('revoked');
  });
  allow = false;
  await expect(pending).rejects.toThrow('revoked');
  await f.runtime.flush();
  expect(f.runtime.state.getState().status).toBe('saved');
  expect(f.runtime.state.getState().canUndo).toBe(false);
  expect(f.runtime.snapshot().find((o) => o.id === 'p')!.title).toBe('Page');
  f.broker.dispose();
  await f.runtime.close();
});

it('redacts private fields and never exposes cached derived values', async () => {
  const f = await fixture({
    version: 'test',
    allows: (resource, operation) => !(operation === 'read' && resource.fieldId === 'private'),
  });
  f.write();
  const db: any = await f.broker.invoke('databases.create', {
    name: 'Scoped',
    fields: [
      { id: 'public', name: 'Public', type: 'text' },
      { id: 'private', name: 'Private', type: 'text' },
      { id: 'derived', name: 'Derived', type: 'formula' },
    ],
  });
  f.runtime.create([
    object('record', 'w', {
      id: 'row',
      databaseId: db.id,
      properties: { public: 'shown', private: 'hidden' },
      blocks: [],
    }),
  ]);
  await f.runtime.flush();
  const row: any = await f.broker.invoke('records.get', { databaseId: db.id, id: 'row' });
  expect(row.properties).toEqual({ public: 'shown' });
  expect(db.fields.map((field: any) => field.id)).not.toContain('private');
  await expect(
    f.broker.invoke('records.update', {
      databaseId: db.id,
      id: 'row',
      version: row.version,
      properties: { private: 'overwrite' },
    }),
  ).rejects.toMatchObject({ code: 'PERMISSION_DENIED' });
  f.broker.dispose();
  await f.runtime.close();
});

it('record-body context does not grant access to its parent database', async () => {
  const f = await fixture();
  const record = object('record', 'w', {
    id: 'body',
    databaseId: 'secret',
    properties: {},
    blocks: f.page.blocks,
  });
  f.runtime.create([record]);
  await f.runtime.flush();
  const broker = new SliceBroker({
    runtime: f.runtime,
    pageId: 'body',
    blockId: 'slice',
    workspaceId: 'w',
    permission: () => ({ data: 'read', allowExternalResources: false }),
    readOnly: () => false,
    context: () => ({}),
    resize: () => {},
  });
  expect(await broker.invoke('databases.list')).toEqual([]);
  expect(await broker.invoke('page.get')).toMatchObject({ id: 'body', type: 'record' });
  await expect(broker.invoke('databases.get', { databaseId: 'secret' })).rejects.toMatchObject({
    code: 'PERMISSION_DENIED',
  });
  broker.dispose();
  f.broker.dispose();
  await f.runtime.close();
});

it('retains HTML through editor codecs, file serialization and lossless backups', async () => {
  const { toEditor, fromEditor } = await import('../packages/editor-blocknote/src/codec');
  const { encode, decode, exportZip, importZip } = await import('@tio/serialization');
  const f = await fixture();
  const block = f.page.blocks![0];
  block.props.html =
    '<!doctype html>\n<script>const x = "<&中文>";</script>\n<style>body{color:red}</style>';
  const schema = {
    blockSchema: { webSlice: { content: 'none', propSchema: {} } },
    styleSchema: {},
    inlineContentSchema: {},
  };
  expect(fromEditor(toEditor([block], schema), [block])).toEqual([block]);
  expect(decode(encode(f.page))).toEqual(f.page);
  const zip = await exportZip(
    [object('workspace', 'w', { id: 'w', name: 'Test' }), f.page],
    async () => undefined,
  );
  const restored = await importZip(zip);
  expect(restored.objects.find((o) => o.id === 'p')?.blocks).toEqual(f.page.blocks);
  expect(JSON.stringify(restored.objects)).not.toContain('allowExternalResources');
  f.broker.dispose();
  await f.runtime.close();
});

it('rejects concurrent remote changes instead of overwriting them', async () => {
  const f = await fixture();
  const before = f.runtime.snapshot().find((o) => o.id === 'p')!;
  const snapshot = await f.repository.readSnapshot();
  await f.repository.commit({
    id: 'remote',
    expectedVersion: snapshot.version,
    changes: [{ ...before, title: 'Remote' }],
    assetIds: [],
  });
  await expect(
    f.runtime.checked([before], [{ ...before, title: 'Local' }], () => {}),
  ).rejects.toMatchObject({ code: 'conflict' });
  await f.runtime.flush();
  expect(
    (await f.repository.readSnapshot()).entries.find((e) => e.object.id === 'p')?.object.title,
  ).toBe('Remote');
  expect(f.runtime.state.getState().status).toBe('saved');
  f.broker.dispose();
  await f.runtime.close();
});
