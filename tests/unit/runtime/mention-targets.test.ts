import { mentionKey, object, textBlock, type MentionReference } from '@tio/core';
import { MemoryRepository } from '@tio/provider-memory';
import { WorkspaceRuntime } from '@tio/workspace';
import { describe, expect, it, vi } from 'vitest';

import { createMentionService } from '../../../packages/web-editor/src/mentions';

const ref: MentionReference = { workspaceId: 'w', kind: 'record', id: 'row' };
const person: MentionReference = {
  workspaceId: 'w',
  kind: 'github-user',
  id: '42',
  login: 'octocat',
};
async function setup() {
  const repository = new MemoryRepository();
  await repository.commit({
    id: 'seed',
    expectedVersion: 0,
    assetIds: [],
    changes: [
      object('workspace', 'w', { id: 'w' }),
      object('page', 'w', { id: 'page', title: 'Page', blocks: [] }),
      object('database', 'w', {
        id: 'db',
        name: 'Tasks',
        fields: [{ id: 'title', name: 'Name', type: 'title' }],
      }),
      object('record', 'w', {
        id: 'row',
        databaseId: 'db',
        properties: { title: 'Ship editor' },
        blocks: [textBlock('Private body')],
      }),
    ],
  });
  const runtime = await WorkspaceRuntime.open(repository);
  return { repository, runtime };
}

describe('mention targets', () => {
  it('searches record titles, paginates after filtering and returns only summaries', async () => {
    const { repository, runtime } = await setup();
    try {
      const page = await repository.queryMentions({ text: 'ship', limit: 1 });
      expect(page.items).toEqual([{ reference: ref, title: 'Ship editor', description: 'Tasks' }]);
      expect(JSON.stringify(page)).not.toContain('Private body');
      expect(runtime.state.getState().loads.row).toBeUndefined();
      const first = await repository.queryMentions({ text: '', limit: 1 });
      const second = await repository.queryMentions({ text: '', limit: 1, after: first.next });
      expect(second.items[0].reference.id).not.toBe(first.items[0].reference.id);
      const service = createMentionService(runtime, 'w', vi.fn());
      expect(await service.resolve([ref])).toEqual([
        { reference: ref, status: 'ready', title: 'Ship editor' },
      ]);
      runtime.patch('db', { deleted: true });
      await runtime.flush();
      expect((await repository.queryMentions({ text: 'ship', limit: 10 })).items).toEqual([]);
      expect((await service.resolve([ref]))[0].status).toBe('deleted');
    } finally {
      await runtime.close();
    }
  });

  it('filters types before paging, binds cursors to filters and queries only selected sources', async () => {
    const { repository, runtime } = await setup();
    const people = vi.fn(async () => [{ reference: person, title: '@octocat' }]);
    try {
      const records = await repository.queryMentions({ text: '', kind: 'record', limit: 1 });
      expect(records.items.map((item) => item.reference.kind)).toEqual(['record']);
      const first = await repository.queryMentions({ text: '', limit: 1 });
      await expect(
        repository.queryMentions({ text: '', kind: 'page', limit: 1, after: first.next }),
      ).rejects.toMatchObject({ code: 'invalid' });
      const service = createMentionService(runtime, 'w', vi.fn(), people);
      const content = vi.spyOn(runtime, 'mentionCandidates');
      expect(
        (await service.query('', undefined, 'page')).items.map((item) => item.reference.kind),
      ).toEqual(['page']);
      expect(people).not.toHaveBeenCalled();
      content.mockClear();
      expect((await service.query('', undefined, 'github-user')).items).toEqual([
        { reference: person, title: '@octocat' },
      ]);
      expect(content).not.toHaveBeenCalled();
      const all = await service.query('');
      if (all.next)
        await expect(service.query('', all.next, 'page')).rejects.toMatchObject({
          code: 'invalid',
        });
      expect(createMentionService(runtime, 'w', vi.fn()).kinds).not.toContain('github-user');
    } finally {
      await runtime.close();
    }
  });

  it('keeps optimistic record titles and rejects cross-workspace references', async () => {
    const { runtime } = await setup();
    try {
      await runtime.loadTarget('row');
      const service = createMentionService(runtime, 'w', vi.fn());
      runtime.cell('row', 'title', 'Latest input');
      expect((await service.resolve([ref]))[0]).toMatchObject({
        status: 'ready',
        title: 'Latest input',
      });
      expect((await service.resolve([{ ...ref, workspaceId: 'other' }]))[0].status).toBe('denied');
    } finally {
      await runtime.close();
    }
  });

  it('keeps content usable when the people source fails and retries independently', async () => {
    const { runtime } = await setup();
    const people = vi
      .fn()
      .mockRejectedValueOnce(new Error('403'))
      .mockResolvedValue([{ reference: person, title: '@octocat' }]);
    try {
      const service = createMentionService(runtime, 'w', vi.fn(), people);
      const failed = await service.query('');
      expect(failed.items.some((item) => item.reference.kind === 'record')).toBe(true);
      expect(failed.sourceErrors).toEqual(['github']);
      const success = await service.query('octo');
      expect(success.items).toEqual([{ reference: person, title: '@octocat' }]);
      expect(success.sourceErrors).toEqual([]);
      expect(await service.resolve([person])).toEqual([
        { reference: person, title: '@octocat', status: 'ready' },
      ]);
      expect(mentionKey(person)).toBe(mentionKey({ ...person, login: 'renamed' }));
    } finally {
      await runtime.close();
    }
  });

  it('paginates collaborators without repeating content and rejects a cursor from another query', async () => {
    const { runtime } = await setup();
    const users = Array.from({ length: 55 }, (_, index) => ({
      reference: { ...person, id: String(index) },
      title: `@person${index}`,
    }));
    try {
      const service = createMentionService(runtime, 'w', vi.fn(), async () => users);
      const first = await service.query('');
      const second = await service.query('', first.next);
      expect(first.items.filter((item) => item.reference.kind === 'github-user')).toHaveLength(50);
      expect(second.items).toHaveLength(5);
      expect(second.next).toBeUndefined();
      await expect(service.query('other', first.next)).rejects.toMatchObject({ code: 'invalid' });
    } finally {
      await runtime.close();
    }
  });
});

it('returns record mention summaries through the host bridge without loading target bodies', async () => {
  const { BridgeRepository, createLoopback, serveHost } = await import('@tio/host-protocol');
  const { repository, runtime } = await setup();
  const pair = createLoopback();
  const context = { sessionId: 'mentions', workspaceId: 'w' };
  const stop = serveHost(pair.host, context, repository);
  const bridge = new BridgeRepository(pair.client, context);
  try {
    await bridge.connect();
    expect((await bridge.queryMentions({ text: 'ship', limit: 10 })).items[0]).toEqual({
      reference: ref,
      title: 'Ship editor',
      description: 'Tasks',
    });
    const metadata = await bridge.readMetadata(['row']);
    expect(metadata.entries[0].object).toMatchObject({ id: 'row', title: 'Ship editor' });
    expect(metadata.entries[0].object.properties).toBeUndefined();
    expect(metadata.entries[0].object.blocks).toBeUndefined();
  } finally {
    bridge.dispose();
    stop();
    await runtime.close();
  }
});
