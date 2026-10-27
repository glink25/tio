import { object, validate } from '@tio/core';
import { queryRecords } from '@tio/database';
import { newDatabase } from '@tio/workspace';
import { expect, it } from 'vitest';
it('keeps named view configurations independent', () => {
  const [db, view] = newDatabase('ws');
  const title = db.fields![0].id;
  const records = [
    object('record', 'ws', {
      id: 'a',
      databaseId: db.id,
      properties: { [title]: 'Alpha', amount: 2 },
    }),
    object('record', 'ws', {
      id: 'b',
      databaseId: db.id,
      properties: { [title]: 'Beta', amount: 1 },
    }),
  ];
  db.fields!.push({ id: 'amount', type: 'number', name: 'Amount' });
  const next = validate({
    ...view,
    id: 'second',
    name: 'Sorted',
    sorts: [{ fieldId: 'amount', direction: 'asc' }],
    fieldOrder: ['amount', title],
    columnWidths: { amount: 200 },
  });
  expect(queryRecords(records, db, next).map((r) => r.id)).toEqual(['b', 'a']);
  expect(queryRecords(records, db, view).map((r) => r.id)).toEqual(['a', 'b']);
  expect(validate(view).columnWidths).toBeUndefined();
  expect(() => validate({ ...view, columnWidths: { amount: -1 } })).toThrow();
  expect(() => validate({ ...view, fieldOrder: [title, title] })).toThrow();
});
it('evaluates typed date equality and excludes empty multiselects from notEmpty', () => {
  const [db, view] = newDatabase('ws');
  db.fields!.push(
    { id: 'date', name: 'Date', type: 'date' },
    { id: 'tags', name: 'Tags', type: 'multiSelect' },
  );
  const records = [
    object('record', 'ws', {
      id: 'a',
      databaseId: db.id,
      properties: { date: { start: '2026-10-23' }, tags: [] },
    }),
    object('record', 'ws', {
      id: 'b',
      databaseId: db.id,
      properties: { date: { start: '2026-10-23' }, tags: ['one'] },
    }),
  ];
  expect(
    queryRecords(records, db, {
      ...view,
      filters: [
        { fieldId: 'date', op: 'eq', value: { start: '2026-10-23' } },
        { fieldId: 'tags', op: 'notEmpty' },
      ],
    }).map((r) => r.id),
  ).toEqual(['b']);
});

it('restores trash only through an explicit intent; delayed patches cannot resurrect content', async () => {
  const { executeCommand } = await import('../../../packages/workspace/src/commands');
  const page = object('page', 'ws', {
    id: 'deleted-page',
    title: 'Keep content',
    deleted: true,
    blocks: [],
  });
  expect(() =>
    executeCommand({ type: 'patch', id: page.id, changes: { title: 'late' } }, [page]),
  ).toThrow();
  const restored = executeCommand({ type: 'undelete', id: page.id }, [page]);
  expect(restored[0]).toMatchObject({ title: 'Keep content', deleted: false });
});
