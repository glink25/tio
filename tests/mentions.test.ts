import { fullAccess, object, type MentionReference } from '@tio/core';
import { queryRecords } from '@tio/database';
import { LocalStore } from '@tio/local-store';
import { MemoryRepository } from '@tio/provider-memory';
import { WorkspaceRuntime } from '@tio/workspace';
import { expect, it, vi } from 'vitest';

import { createMentionService } from '../packages/web-editor/src/mentions';

const ref = (id: string): MentionReference => ({ workspaceId: 'w', kind: 'page', id });
it('batches metadata, redacts denied titles and separates tombstones, missing and foreign references', async () => {
  const repository = new MemoryRepository({
    ...fullAccess,
    allows: (r, op) => !(r.id === 'secret' && op === 'read'),
  });
  await repository.commit({
    id: 'seed',
    expectedVersion: 0,
    assetIds: [],
    changes: [
      object('page', 'w', { id: 'root', title: 'Root', blocks: [] }),
      object('page', 'w', { id: 'target', title: 'Target', blocks: [] }),
      object('page', 'w', { id: 'secret', title: 'Do not reveal', blocks: [] }),
      object('page', 'w', { id: 'gone', title: 'Gone', blocks: [], deleted: true }),
    ],
  });
  const runtime = await WorkspaceRuntime.open(repository, undefined, undefined, {
    targetId: 'root',
  });
  const read = vi.spyOn(repository, 'readMetadata');
  const navigate = vi.fn();
  const service = createMentionService(runtime, 'w', navigate);
  const [a, b] = await Promise.all([
    service.resolve([ref('target'), ref('secret')]),
    service.resolve([ref('gone'), ref('missing'), { ...ref('target'), workspaceId: 'other' }]),
  ]);
  expect(read).toHaveBeenCalledTimes(1);
  expect(a.map((v) => v.status)).toEqual(['ready', 'denied']);
  expect(JSON.stringify(a)).not.toContain('Do not reveal');
  expect(b.map((v) => v.status)).toEqual(['deleted', 'missing', 'denied']);
  expect(runtime.state.getState().loads.target).toBeUndefined();
  service.navigate({ ...ref('target'), workspaceId: 'other' });
  expect(navigate).not.toHaveBeenCalled();
  runtime.dispose();
});
it('device provider pages candidate matches and strips all bodies from metadata', async () => {
  const repository = new LocalStore('w', `mention-${crypto.randomUUID()}`);
  await repository.commit({
    id: 'seed',
    expectedVersion: 0,
    assetIds: [],
    changes: Array.from({ length: 55 }, (_, i) =>
      object('page', 'w', { id: `page-${String(i).padStart(2, '0')}`, title: 'Match', blocks: [] }),
    ),
  });
  const first = await repository.queryNavigation({ limit: 50, text: 'match', mentionsOnly: true });
  expect(first.items).toHaveLength(50);
  expect(first.next).toBeDefined();
  const second = await repository.queryNavigation({
    limit: 50,
    text: 'match',
    mentionsOnly: true,
    after: first.next,
  });
  expect(second.items).toHaveLength(5);
  expect((await repository.readMetadata(['page-00'])).entries[0].object.blocks).toBeUndefined();
  repository.close();
});
it('mention equality compares identity, sorting uses titles, and deletion preserves stored references', () => {
  const database = object('database', 'w', {
    id: 'd',
    fields: [{ id: 'm', name: 'Mention', type: 'mention' }],
  });
  const rows = ['a', 'b'].map((id) =>
    object('record', 'w', {
      id: `r-${id}`,
      databaseId: 'd',
      properties: { m: ref(id) },
      blocks: [],
    }),
  );
  const objects = [
    database,
    ...rows,
    object('page', 'w', { id: 'a', title: 'Zulu', blocks: [] }),
    object('page', 'w', { id: 'b', title: 'Alpha', blocks: [] }),
  ];
  expect(
    queryRecords(objects, database, {
      ...database,
      filters: [{ fieldId: 'm', op: 'eq', value: ref('a') }],
    }).map((r) => r.id),
  ).toEqual(['r-a']);
  expect(
    queryRecords(objects, database, {
      ...database,
      sorts: [{ fieldId: 'm', direction: 'asc' }],
    }).map((r) => r.id),
  ).toEqual(['r-b', 'r-a']);
  objects[3].deleted = true;
  expect(
    queryRecords(objects, database, { ...database, filters: [{ fieldId: 'm', op: 'notEmpty' }] }),
  ).toHaveLength(2);
  expect(rows[0].properties?.m).toEqual(ref('a'));
});
it('refreshes labels after an optimistic rename has been acknowledged by the provider', async () => {
  const repository = new MemoryRepository();
  await repository.commit({
    id: 'seed',
    expectedVersion: 0,
    changes: [object('page', 'w', { id: 'target', title: 'Before', blocks: [] })],
    assetIds: [],
  });
  const runtime = await WorkspaceRuntime.open(repository, undefined, undefined, {
    targetId: 'target',
  });
  const service = createMentionService(runtime, 'w', () => {});
  let title = '';
  let resolution = Promise.resolve();
  const stop = service.subscribe(() => {
    resolution = service.resolve([ref('target')]).then(([item]) => {
      if (item.status === 'ready') title = item.title;
    });
  });
  runtime.patch('target', { title: 'After' });
  await runtime.flush();
  await resolution;
  expect(title).toBe('After');
  stop();
  runtime.dispose();
});
