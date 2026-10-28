import {
  object,
  validateValue,
  validateFieldReference,
  type Field,
  type MentionReference,
} from '@tio/core';
import { displayValue, queryRecords } from '@tio/database';
import { convertValue } from '@tio/database/conversion';
import { MemoryRepository } from '@tio/provider-memory';
import { WorkspaceRuntime } from '@tio/workspace';
import { describe, expect, it } from 'vitest';

import { AppSliceBroker } from '../../../packages/web-editor/src/app-slice/broker';

const first: MentionReference = { workspaceId: 'w', kind: 'page', id: 'first' };
const second: MentionReference = { workspaceId: 'w', kind: 'database', id: 'second' };
const field: Field = { id: 'mentions', name: 'Mentions', type: 'mention' };
const single: Field = { ...field, multiple: false };
const db = object('database', 'w', { id: 'db', name: 'DB', fields: [field] });
const row = object('record', 'w', {
  id: 'row',
  databaseId: db.id,
  properties: { mentions: [first, second] },
  blocks: [],
});
const targets = [
  object('page', 'w', { id: 'first', title: 'Alpha', blocks: [] }),
  object('database', 'w', { id: 'second', name: 'Beta', fields: [] }),
];
const objects = [object('workspace', 'w', { id: 'w' }), db, row, ...targets];

describe('mention field cardinality', () => {
  it('validates shape, full identity uniqueness and every workspace', () => {
    for (const value of [[], [first, second], null])
      expect(() => validateValue(field, value)).not.toThrow();
    for (const value of [first, [first, first], [first, {}]])
      expect(() => validateValue(field, value)).toThrow();
    expect(() => validateValue(single, first)).not.toThrow();
    expect(() => validateValue(single, [first])).toThrow();
    expect(() => validateValue(field, [first, { ...first, kind: 'database' }])).not.toThrow();
    expect(() =>
      validateFieldReference(field, [first, { ...second, workspaceId: 'other' }], row, objects),
    ).toThrow();
    expect(() => validateFieldReference(field, [first, second], row, [])).not.toThrow();
  });
  it('renders all titles, matches any exact identity and preserves missing targets', () => {
    expect(displayValue([first, second], field, objects, 'en')).toBe('Alpha, Beta');
    expect(displayValue([first, second], field, [], 'en')).toBe(
      'Unavailable reference, Unavailable reference',
    );
    const view = object('databaseView', 'w', {
      databaseId: db.id,
      layout: 'table',
      filters: [{ fieldId: field.id, op: 'eq', value: second }],
    });
    expect(queryRecords(objects, db, view).map((r) => r.id)).toEqual(['row']);
    expect(
      queryRecords(objects, db, {
        ...view,
        filters: [{ fieldId: field.id, op: 'eq', value: { ...second, kind: 'page' } }],
      }),
    ).toEqual([]);
  });
  it('converts cardinality and exports all readable titles to text', () => {
    expect(convertValue(first, single, field, objects, row)).toEqual([first]);
    expect(convertValue([first, second], field, single, objects, row)).toEqual(first);
    expect(convertValue(null, single, field, objects, row)).toEqual([]);
    expect(convertValue([], field, single, objects, row)).toBeNull();
    expect(convertValue([first, second], field, { ...field, type: 'text' }, objects, row)).toBe(
      'Alpha, Beta',
    );
  });
  it('commits cardinality with values and undoes and redoes both', async () => {
    const repository = new MemoryRepository();
    await repository.commit({ id: 'seed', expectedVersion: 0, changes: objects, assetIds: [] });
    const runtime = await WorkspaceRuntime.open(repository, undefined, undefined, {
      targetId: 'db',
    });
    const snapshot = await runtime.databaseSnapshot('db');
    expect(displayValue([first, second], field, snapshot.objects, 'en')).toBe('Alpha, Beta');
    await runtime.convertField('db', single);
    const value = () => runtime.snapshot().find((o) => o.id === 'row')!.properties!.mentions;
    expect(value()).toEqual(first);
    runtime.undo();
    await runtime.flush();
    expect(value()).toEqual([first, second]);
    expect(runtime.snapshot().find((o) => o.id === 'db')!.fields![0].multiple).toBeUndefined();
    runtime.redo();
    await runtime.flush();
    expect(value()).toEqual(first);
    await runtime.convertField('db', field);
    expect(value()).toEqual([first]);
    expect(runtime.snapshot().every((o) => o.schemaVersion === 1)).toBe(true);
    await runtime.close();
  });
  it('discovers all record mentions and rejects any unauthorized array entry in App Slice', async () => {
    const repository = new MemoryRepository();
    const appSlice = {
      id: 'app-slice',
      type: 'appSlice',
      props: { title: 'App Slice', html: '', runtimeVersion: 1, autoHeight: false, height: 300 },
      content: [],
      children: [],
    };
    await repository.commit({
      id: 'seed',
      expectedVersion: 0,
      changes: objects.map((o) =>
        o.id === 'row'
          ? {
              ...o,
              properties: { mentions: [first, { workspaceId: 'w', kind: 'database', id: 'db' }] },
              blocks: [appSlice],
            }
          : o,
      ),
      assetIds: [],
    });
    const runtime = await WorkspaceRuntime.open(repository, undefined, undefined, {
      targetId: 'row',
    });
    const broker = new AppSliceBroker({
      runtime,
      pageId: 'row',
      blockId: 'app-slice',
      workspaceId: 'w',
      permission: () => ({ data: 'readWrite', allowExternalResources: false }),
      readOnly: () => false,
      context: () => ({}),
      resize: () => {},
    });
    try {
      await expect(broker.invoke('pages.get', { pageId: 'first' })).resolves.toMatchObject({
        id: 'first',
      });
      await expect(
        broker.invoke('records.create', {
          databaseId: 'db',
          properties: { mentions: [first, second] },
        }),
      ).rejects.toMatchObject({ code: 'PERMISSION_DENIED' });
      await expect(
        broker.invoke('records.create', { databaseId: 'db', properties: { mentions: [first] } }),
      ).resolves.toMatchObject({ properties: { mentions: [first] } });
    } finally {
      broker.dispose();
      await runtime.close();
    }
  });
});

it('supports record and GitHub references with stable user identity in mention fields', () => {
  const record: MentionReference = { workspaceId: 'w', kind: 'record', id: 'row' };
  const user: MentionReference = {
    workspaceId: 'w',
    kind: 'github-user',
    id: '42',
    login: 'octocat',
  };
  expect(() => validateValue(field, [record, user])).not.toThrow();
  expect(() => validateValue(field, [user, { ...user, login: 'renamed' }])).toThrow();
  expect(() => validateValue(field, [{ ...user, login: 'javascript:alert(1)' }])).toThrow();
  expect(displayValue([user], field, objects, 'en')).toBe('@octocat');
  expect(() =>
    validateFieldReference(field, [{ ...user, workspaceId: 'foreign' }], row, objects),
  ).toThrow();
});
