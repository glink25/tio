import { object, type TioObject } from '@tio/core';
import { MemoryRepository } from '@tio/provider-memory';
import { WorkspaceRuntime, navigationTree } from '@tio/workspace';
import { expect, it } from 'vitest';

import { executeCommand } from '../../../packages/workspace/src/commands';

const page = (id: string, order: number, parentId: string | null = null) =>
  object('page', 'w', { id, order, parentId, title: id, blocks: [] });
async function setup() {
  const repository = new MemoryRepository();
  await repository.commit({
    id: 'seed',
    expectedVersion: 0,
    assetIds: [],
    changes: [page('a', 0), page('b', 0), page('child', 10, 'a')],
  });
  return { repository, runtime: await WorkspaceRuntime.open(repository) };
}
const ids = (objects: TioObject[]) => navigationTree(objects).map((o) => o.id);

it('persists same-level and cross-level ordering as one undoable command without changing content times', async () => {
  const { repository, runtime } = await setup();
  try {
    const before = runtime.snapshot().map((o) => [o.id, o.updatedAt]);
    runtime.place('b', null, 'a');
    await runtime.flush();
    expect(ids(runtime.snapshot())).toEqual(['b', 'a', 'child']);
    runtime.place('b', 'a', 'child');
    await runtime.flush();
    expect(ids(runtime.snapshot())).toEqual(['a', 'b', 'child']);
    expect(runtime.snapshot().map((o) => [o.id, o.updatedAt])).toEqual(before);
    runtime.undo();
    await runtime.flush();
    expect(ids(runtime.snapshot())).toEqual(['b', 'a', 'child']);
    runtime.redo();
    await runtime.flush();
    const reopened = await WorkspaceRuntime.open(repository);
    expect(ids(reopened.snapshot())).toEqual(['a', 'b', 'child']);
    await reopened.close();
  } finally {
    await runtime.close();
  }
});

it('rejects cycles and cross-workspace moves without changing the tree', async () => {
  const { runtime } = await setup();
  try {
    await runtime.ensure(['a', 'child']);
    expect(() => runtime.place('a', 'child', null)).toThrow();
    expect(ids(runtime.snapshot())).toEqual(['a', 'child', 'b']);
    expect(() =>
      executeCommand({ type: 'place', id: 'a', parentId: 'foreign', beforeId: null }, [
        ...runtime.snapshot(),
        object('page', 'other', { id: 'foreign', blocks: [] }),
      ]),
    ).toThrow();
  } finally {
    await runtime.close();
  }
});

it('publishes the dropped order synchronously and never reverts while dependencies and persistence are delayed', async () => {
  const { repository, runtime } = await setup();
  let releaseRead!: () => void;
  let releaseCommit!: () => void;
  const readGate = new Promise<void>((resolve) => {
    releaseRead = resolve;
  });
  const commitGate = new Promise<void>((resolve) => {
    releaseCommit = resolve;
  });
  const read = repository.readObjects.bind(repository);
  const commit = repository.commit.bind(repository);
  repository.readObjects = async (selected) => {
    if (selected.includes('b')) await readGate;
    return read(selected);
  };
  repository.commit = async (request) => {
    await commitGate;
    return commit(request);
  };
  const observed: string[][] = [];
  try {
    runtime.place('b', null, 'a');
    expect(ids(runtime.snapshot())).toEqual(['b', 'a', 'child']);
    const stop = runtime.state.subscribe(() => observed.push(ids(runtime.snapshot())));
    const flushing = runtime.flush();
    releaseRead();
    await runtime.ensure(['child']);
    expect(ids(runtime.snapshot())).toEqual(['b', 'a', 'child']);
    releaseCommit();
    await flushing;
    stop();
    expect(observed.length).toBeGreaterThan(0);
    expect(
      observed.every((order) => JSON.stringify(order) === JSON.stringify(['b', 'a', 'child'])),
    ).toBe(true);
    runtime.undo();
    await runtime.flush();
    expect(ids(runtime.snapshot())).toEqual(['a', 'child', 'b']);
  } finally {
    releaseRead();
    releaseCommit();
    await runtime.close();
  }
});
