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
