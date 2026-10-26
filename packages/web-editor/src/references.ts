import type { Block } from '@tio/core';

/** Explicit document references in depth-first reading order. */
export function referencedPageIds(blocks: Block[]): string[] {
  const ids = new Set<string>();
  const visit = (items: Block[]) => {
    for (const block of items) {
      if (
        block.type === 'pageReference' &&
        typeof block.props.pageId === 'string' &&
        block.props.pageId
      )
        ids.add(block.props.pageId);
      visit(block.children);
    }
  };
  visit(blocks);
  return [...ids];
}
