import {
  object,
  validateValue,
  validateFieldReference,
  type Field,
  type MentionReference,
} from '@tio/core';
import { describe, expect, it } from 'vitest';

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
});
