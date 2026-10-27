import { object, repairTree, validate } from '@tio/core';
import { merge } from '@tio/merge';
import { canonical, decode, encode } from '@tio/serialization';
import { describe, expect, it } from 'vitest';

import { basePage as page } from '../../fixtures/objects';
describe('canonical objects', () => {
  it('preserves unknown fields, blocks and versions', () => {
    const p = page();
    p.extra = { future: 42 };
    p.blocks!.push({
      id: 'future',
      type: 'whiteboard',
      props: { new: true },
      content: [],
      children: [],
    });
    expect(decode(encode(p))).toEqual(p);
    expect(canonical({ b: 1, a: 2 })).toBe(canonical({ a: 2, b: 1 }));
    expect(() => validate({ ...p, schemaVersion: 2 })).toThrow('Unsupported schema');
  });
  it('rejects unsafe IDs and malformed blocks', () => {
    expect(() => validate({ ...page(), id: '../file' })).toThrow();
    expect(() => validate({ ...page(), blocks: null })).toThrow();
  });
  it('repairs cycles deterministically', () => {
    const a = { ...page(), id: 'a', parentId: 'b' },
      b = { ...page(), id: 'b', parentId: 'a' };
    expect(repairTree([a, b]).find((o) => o.id === 'a')?.parentId).toBeNull();
    expect(repairTree([b, a]).find((o) => o.id === 'a')?.parentId).toBeNull();
  });
});
describe('merge', () => {
  it('combines independent fields symmetrically', () => {
    const b = object('record', 'base_1', {
      id: 'r',
      databaseId: 'db',
      properties: { a: 1, b: 2 },
      blocks: [],
    });
    const l = { ...b, properties: { a: 3, b: 2 } },
      r = { ...b, properties: { a: 1, b: 4 } };
    expect(merge(b, l, r).merged.properties).toEqual({ a: 3, b: 4 });
    expect(merge(b, l, r).merged).toEqual(merge(b, r, l).merged);
  });
  it('diff3 combines independent text edits', () => {
    const b = page();
    b.blocks![0].content = [{ type: 'text', text: 'hello world', styles: {} }];
    const l = structuredClone(b),
      r = structuredClone(b);
    (l.blocks![0].content as any)[0].text = 'HELLO world';
    (r.blocks![0].content as any)[0].text = 'hello WORLD';
    expect((merge(b, l, r).merged.blocks![0].content as any)[0].text).toBe('HELLO WORLD');
  });
  it('conflict fallback is symmetric and idempotent', () => {
    const b = page(),
      l = { ...b, title: 'A' },
      r = { ...b, title: 'B' };
    expect(merge(b, l, r).merged).toEqual(merge(b, r, l).merged);
    expect(merge(b, l, l).merged).toEqual(l);
    expect(merge(b, l, r).recovered.length).toBeGreaterThan(0);
  });
  it('delete wins but retains recovered edit', () => {
    const b = page();
    const result = merge(b, { ...b, deleted: true }, { ...b, title: 'edit' });
    expect(result.merged.deleted).toBe(true);
    expect(result.recovered.length).toBeGreaterThan(0);
  });
});

it('preserves emoji graphemes when merging independent text edits', () => {
  const b = page();
  b.blocks![0].content = [{ type: 'text', text: '👨‍👩‍👧‍👦 hello world', styles: {} }];
  const l = structuredClone(b),
    r = structuredClone(b);
  (l.blocks![0].content as { text: string }[])[0].text = '👨‍👩‍👧‍👦 HELLO world';
  (r.blocks![0].content as { text: string }[])[0].text = '👨‍👩‍👧‍👦 hello WORLD';
  expect((merge(b, l, r).merged.blocks![0].content as { text: string }[])[0].text).toBe(
    '👨‍👩‍👧‍👦 HELLO WORLD',
  );
});
