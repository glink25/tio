import type { Block, TioObject } from './index';

/** Document order, including nested blocks, never follows content references. */
export function firstAppSlice(blocks: Block[]): Block | undefined {
  for (const block of blocks) {
    if (block.type === 'appSlice') return block;
    const nested = firstAppSlice(block.children);
    if (nested) return nested;
  }
}
export function isAppMode(page: TioObject | undefined): boolean {
  return page?.type === 'page' && page.appMode === true;
}
export function canToggleAppMode(page: TioObject): boolean {
  return page.type === 'page' && (isAppMode(page) || !!firstAppSlice(page.blocks ?? []));
}
