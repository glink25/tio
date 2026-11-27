import {
  object,
  mentionKey,
  mentionTitle,
  personMentionUrl,
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
  it('keeps provider identity distinct and resolves Gitee people offline', () => {
    const person = { workspaceId: 'w', kind: 'gitee-user' as const, id: '42', login: 'gitee_user' };
    expect(() =>
      validateValue(field, [person, { ...person, kind: 'github-user', login: 'github-user' }]),
    ).not.toThrow();
    expect(() => validateValue(field, [person, { ...person, login: 'renamed' }])).toThrow();
    expect(mentionKey(person)).toBe(mentionKey({ ...person, login: 'renamed' }));
    expect(mentionTitle(person, [])).toBe('@gitee_user');
    expect(personMentionUrl(person)).toBe('https://gitee.com/gitee_user');
  });
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
