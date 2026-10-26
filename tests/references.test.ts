import type { Block } from '@tio/core';
import { describe, expect, it } from 'vitest';

import { referencedPageIds } from '../packages/web-editor/src/references';

const block = (id: string, type = 'pageReference', children: Block[] = []): Block => ({
  id: crypto.randomUUID(),
  type,
  props: { pageId: id },
  content: [],
  children,
});
describe('explicit document references', () => {
  it('preserves reading order across nested blocks and deduplicates targets', () => {
    expect(
      referencedPageIds([
        block('a'),
        block('', 'paragraph', [block('b'), block('a')]),
        block('c'),
        block('b'),
      ]),
    ).toEqual(['a', 'b', 'c']);
  });
  it('ignores empty references and unrelated blocks', () => {
    expect(
      referencedPageIds([block(''), block('a', 'databaseView'), block('b', 'webSlice')]),
    ).toEqual([]);
  });
});
