import {
  blockMentions,
  contentMentions,
  isMentionReference,
  mentionKey,
  textBlock,
  validateValue,
} from '@tio/core';
import { describe, expect, it } from 'vitest';
const ref = { workspaceId: 'w', kind: 'page' as const, id: 'target' };
const inline = { type: 'mention', props: ref };
describe('structured mentions', () => {
  it('finds direct references in nested blocks and table cells without traversing arbitrary props', () => {
    const block = {
      ...textBlock(''),
      content: [inline],
      children: [
        {
          ...textBlock(''),
          type: 'table',
          content: {
            type: 'tableContent',
            rows: [{ cells: [{ type: 'tableCell', content: [inline] }] }],
          },
        },
      ],
    };
    expect(blockMentions([block])).toEqual([ref, ref]);
    expect(contentMentions({ type: 'extension', props: { content: [inline] } })).toEqual([]);
  });
  it('validates single references and keeps workspace identity', () => {
    expect(isMentionReference(ref)).toBe(true);
    expect(isMentionReference({ ...ref, kind: 'record' })).toBe(false);
    expect(() => validateValue({ id: 'm', name: 'Mention', type: 'mention' }, [ref])).toThrow();
    expect(() => validateValue({ id: 'm', name: 'Mention', type: 'mention' }, null)).not.toThrow();
    expect(mentionKey(ref)).not.toBe(mentionKey({ ...ref, workspaceId: 'other' }));
    expect(() => contentMentions({ type: 'mention', props: { id: 'x' } })).toThrow();
  });
});
