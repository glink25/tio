import { object, textBlock } from '@tio/core';
import { FileRepository, FileWorkspaceContent } from '@tio/file-storage';
import { MemoryProvider } from '@tio/provider-memory';
import { WorkspaceRuntime, executeBasic } from '@tio/workspace';
import { describe, expect, it } from 'vitest';

import type { FileJournalState } from '../../../packages/file-storage/src/repository';

function folder() {
  const files = new MemoryProvider();
  const content = new FileWorkspaceContent(files, 'w');
  let saved: FileJournalState | undefined;
  const journal = {
    load: async () => structuredClone(saved),
    save: async (state: FileJournalState) => {
      saved = structuredClone(state);
    },
  };
  return { files, content, journal, repository: new FileRepository(content, 'w', journal) };
}
const page = (id: string, title = id) =>
  object('page', 'w', { id, title, blocks: [textBlock(title)] });

describe('direct file repository', () => {
  it('writes files, compacts body receipts, reopens and supports headless commands', async () => {
    const f = folder();
    const runtime = await WorkspaceRuntime.open(f.repository);
    runtime.create([page('a')]);
    await runtime.flush();
    expect((await f.content.read('a'))?.title).toBe('a');
    const journal = await f.journal.load();
    expect(journal?.pending).toBeUndefined();
    expect(journal?.receipts).toEqual({});
    expect(JSON.stringify(journal)).not.toContain('blocks');
    runtime.dispose();
    f.repository.close();
    const reopened = new FileRepository(f.content, 'w', f.journal);
    await executeBasic(reopened, {
      version: 1,
      workspaceId: 'w',
      type: 'rename',
      id: 'a',
      name: 'headless',
    });
    expect((await f.content.read('a'))?.title).toBe('headless');
    reopened.close();
  });
  it('recovers an interrupted multi-object publication and never acknowledges early', async () => {
    const f = folder();
    let count = 0;
    f.files.beforeWrite = async (path) => {
      if (path.includes('/objects/') && ++count === 2) throw new Error('interrupted');
    };
    const request = {
      id: 'write',
      clientId: 'client',
      sequence: 1,
      expectedVersion: 0,
      changes: [page('a'), page('b')],
      assetIds: [],
    };
    await expect(f.repository.commit(request)).rejects.toThrow('interrupted');
    expect((await f.journal.load())?.pending?.request.id).toBe('write');
    expect((await f.journal.load())?.receipts.write).toBeUndefined();
    f.repository.close();
    f.files.beforeWrite = undefined;
    const reopened = new FileRepository(f.content, 'w', f.journal);
    expect(await reopened.getCommitResult('write')).toMatchObject({ status: 'committed' });
    expect((await reopened.readSnapshot()).entries).toHaveLength(2);
    await reopened.acknowledgeCommits('client', 1);
    expect(await reopened.commit(request)).toMatchObject({ status: 'compacted' });
    reopened.close();
  });
  it('refuses to overwrite an external edit during recovery', async () => {
    const f = folder();
    let count = 0;
    f.files.beforeWrite = async () => {
      if (++count === 2) throw new Error('interrupted');
    };
    await expect(
      f.repository.commit({
        id: 'write',
        expectedVersion: 0,
        changes: [page('a'), page('b')],
        assetIds: [],
      }),
    ).rejects.toThrow();
    f.files.beforeWrite = undefined;
    await f.content.write(page('a', 'external'));
    await expect(f.repository.getCommitResult('write')).rejects.toMatchObject({ code: 'conflict' });
    expect((await f.content.read('a'))?.title).toBe('external');
    expect((await f.journal.load())?.pending).toBeDefined();
    f.repository.close();
  });
  it('retains the journal on revoked write access and recovers after reauthorization', async () => {
    const f = folder();
    let count = 0;
    f.files.beforeWrite = async () => {
      if (++count === 2) throw new Error('interrupted');
    };
    await expect(
      f.repository.commit({
        id: 'write',
        expectedVersion: 0,
        changes: [page('a'), page('b')],
        assetIds: [],
      }),
    ).rejects.toThrow();
    f.files.beforeWrite = undefined;
    const authorize = f.content.authorize.bind(f.content);
    f.content.authorize = async () => ({ version: 'denied', allows: (_r, op) => op === 'read' });
    await expect(f.repository.getCommitResult('write')).rejects.toThrow();
    expect((await f.journal.load())?.pending).toBeDefined();
    f.content.authorize = authorize;
    expect(await f.repository.getCommitResult('write')).toMatchObject({ status: 'committed' });
    f.repository.close();
  });
  it('reports missing files rather than inventing tombstones or an incomplete export', async () => {
    const f = folder();
    await f.repository.commit({
      id: 'write',
      expectedVersion: 0,
      changes: [page('a')],
      assetIds: [],
    });
    f.files.files.delete('workspaces/w/objects/a.json');
    await expect(f.repository.readSnapshot()).rejects.toThrow('missing');
    f.repository.close();
  });
});
