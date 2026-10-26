import { object, textBlock } from '@tio/core';
import { queryRecords } from '@tio/database';
import { LocalStore } from '@tio/local-store';
import { expect, it } from 'vitest';
it.each([1000, 10000])(
  'queries %i records and persists a 100-page workspace',
  async (count) => {
    const db = object('database', 'base_perf', {
      fields: [{ id: 'n', type: 'number', name: 'Number' }],
    });
    const rows = Array.from({ length: count }, (_, n) =>
      object('record', 'base_perf', {
        databaseId: db.id,
        properties: { n: count - n },
        blocks: [],
      }),
    );
    const view = object('databaseView', 'base_perf', {
      databaseId: db.id,
      visibleFieldIds: ['n'],
      filters: [],
      sorts: [{ fieldId: 'n', direction: 'asc' }],
    });
    const start = performance.now();
    const result = queryRecords(rows, db, view);
    const duration = performance.now() - start;
    expect(result).toHaveLength(count);
    expect(result[0].properties?.n).toBe(1);
    expect(duration).toBeLessThan(3000);
    const store = new LocalStore('perf-' + count, 'perf-' + count);
    try {
      await store.batch([
        ...rows,
        ...Array.from({ length: 100 }, () =>
          object('page', 'base_perf', { title: 'Page', blocks: [textBlock('Content')] }),
        ),
      ]);
      expect(await store.all()).toHaveLength(count + 100);
    } finally {
      store.close();
    }
    console.info(
      `Query ${count} records: ${duration.toFixed(1)} ms (synthetic test; not a device benchmark)`,
    );
  },
  20000,
);

it('resolves a deep navigation tree without repeated workspace scans', async () => {
  const { visibility } = await import('@tio/core');
  const pages = Array.from({ length: 10000 }, (_, n) =>
    object('page', 'w', {
      id: `p${n}`,
      parentId: n ? `p${n - 1}` : null,
      blocks: [],
    }),
  );
  const isVisible = visibility(pages);
  expect(pages.filter(isVisible)).toHaveLength(10000);
  expect(visibility([{ ...pages[0], deleted: true }, ...pages.slice(1)])(pages[9999])).toBe(false);
  const orphan = { ...pages[0], parentId: 'missing' };
  expect(visibility([orphan])(orphan)).toBe(false);
});

it('editing one object reads only changed host entries in a large workspace', async () => {
  const { WorkspaceRuntime } = await import('@tio/workspace');
  const store = new LocalStore('incremental', crypto.randomUUID());
  try {
    await store.batch(
      Array.from({ length: 1000 }, (_, n) => object('page', 'w', { id: `p${n}`, blocks: [] })),
    );
    const runtime = await WorkspaceRuntime.open(store);
    store.readSnapshot = async () => {
      throw new Error('Unexpected whole workspace read');
    };
    runtime.patch('p500', { title: 'Edited' });
    await runtime.flush();
    expect((await store.get('p500'))?.object.title).toBe('Edited');
    expect((await store.readChanges(1)).entries.map((entry) => entry.object.id)).toEqual(['p500']);
    runtime.dispose();
  } finally {
    store.close();
  }
});
