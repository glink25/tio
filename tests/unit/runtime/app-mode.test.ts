import { object, textBlock } from '@tio/core';
import { MemoryRepository } from '@tio/provider-memory';
import { WorkspaceRuntime } from '@tio/workspace';
import { expect, it } from 'vitest';

it('persists, reopens, undoes and receives external app mode changes without changing body or content time', async () => {
  const repository = new MemoryRepository();
  const page = object('page', 'w', {
    id: 'p',
    blocks: [textBlock('Body')],
    opaque: { retained: true },
  });
  await repository.commit({ id: 'seed', expectedVersion: 0, changes: [page], assetIds: [] });
  const one = await WorkspaceRuntime.open(repository, undefined, undefined, { targetId: 'p' });
  const two = await WorkspaceRuntime.open(repository, undefined, undefined, { targetId: 'p' });
  try {
    one.patch('p', { appMode: true });
    await one.flush();
    await expect.poll(() => two.snapshot().find((o) => o.id === 'p')?.appMode).toBe(true);
    one.undo();
    await one.flush();
    expect(one.snapshot().find((o) => o.id === 'p')?.appMode).not.toBe(true);
    one.redo();
    await one.flush();
    const reopened = await WorkspaceRuntime.open(repository, undefined, undefined, {
      targetId: 'p',
    });
    try {
      expect(reopened.snapshot().find((o) => o.id === 'p')).toMatchObject({
        appMode: true,
        blocks: page.blocks,
        opaque: page.opaque,
        updatedAt: page.updatedAt,
      });
    } finally {
      reopened.dispose();
    }
  } finally {
    one.dispose();
    two.dispose();
  }
});
