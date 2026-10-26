import { createDomain, object } from '@tio/core';
import { FileWorkspaceContent } from '@tio/file-storage';
import { merge } from '@tio/merge';
import { MemoryProvider, MemoryRepository } from '@tio/provider-memory';
import { WorkspaceRuntime } from '@tio/workspace';
import { expect, it } from 'vitest';

it('isolates registered types across hosts and uses their validator in runtime, commit and file encoding', async () => {
  const domain = createDomain();
  domain.objects.register({
    type: 'counter',
    currentVersion: 1,
    validate(value) {
      if (typeof value.count !== 'number') throw new Error('Invalid counter');
      return value;
    },
    merge(base, local, remote) {
      return {
        merged: {
          ...local,
          count: Number(local.count) + Number(remote.count) - Number(base?.count ?? 0),
        },
        warnings: [],
        recovered: [],
      };
    },
  });
  const host = new MemoryRepository(undefined, domain);
  const runtime = await WorkspaceRuntime.open(host, undefined, domain);
  const value = object('counter', 'w', { id: 'counter', count: 0 });
  runtime.create([value]);
  await runtime.flush();
  runtime.patch(value.id, { count: 2 });
  await runtime.flush();
  expect((await host.readSnapshot()).entries[0].object.count).toBe(2);
  expect(() => runtime.patch(value.id, { count: 'invalid' })).toThrow('Invalid counter');
  await expect(
    host.commit({
      id: 'invalid',
      expectedVersion: 2,
      changes: [{ ...value, count: 'bad' }],
      assetIds: [],
    }),
  ).rejects.toThrow('Invalid counter');
  const content = new FileWorkspaceContent(new MemoryProvider(), 'w', { types: domain.objects });
  await expect(content.write({ ...value, count: 'bad' })).rejects.toThrow('Invalid counter');
  expect(
    merge(value, { ...value, count: 2 }, { ...value, count: 3 }, domain.objects).merged.count,
  ).toBe(5);
  const separate = createDomain();
  expect(separate.objects.supports(value)).toBe(false);
  expect(separate.objects.decode(value)).toEqual(value);
  runtime.dispose();
});

it('enforces custom field validators through direct host commits', async () => {
  const domain = createDomain();
  domain.fields.register({
    type: 'rating',
    validate: (value) => Number.isInteger(value) && Number(value) >= 1 && Number(value) <= 5,
  });
  const host = new MemoryRepository(undefined, domain);
  const db = object('database', 'w', {
    id: 'db',
    fields: [{ id: 'rating', type: 'rating', name: 'Rating' }],
  });
  const row = object('record', 'w', {
    id: 'r',
    databaseId: 'db',
    properties: { rating: 4 },
    blocks: [],
  });
  await host.commit({ id: 'seed', expectedVersion: 0, changes: [db, row], assetIds: [] });
  await expect(
    host.commit({
      id: 'bad',
      expectedVersion: 1,
      changes: [{ ...row, properties: { rating: 10 } }],
      assetIds: [],
    }),
  ).rejects.toThrow('Invalid rating');
});
