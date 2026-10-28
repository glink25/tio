import { object } from '@tio/core';
import { GitHubError, type GitHubRepository } from '@tio/provider-github';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

import { githubBinding } from '../../../apps/web/src/services/github-binding';

const connection = { id: 'github-1', kind: 'github', name: 'owner' } as const;
let values: Map<string, string>;
beforeEach(() => {
  values = new Map();
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
  });
  values.set(
    'tio.github.credentials',
    JSON.stringify({ userId: 1, mode: 'app', accessToken: 't' }),
  );
});
afterEach(() => vi.unstubAllGlobals());

type Repository = {
  workspaceId: string;
  data?: string;
  paths?: string[];
  failure?: () => Response;
};
function transport(repositories: Repository[]) {
  const repos: GitHubRepository[] = repositories.map((_, i) => ({
    id: i + 10,
    name: `tio-${i}`,
    full_name: `owner/tio-${i}`,
    default_branch: 'main',
    owner: { login: 'owner' },
  }));
  const fetcher = vi.fn<typeof fetch>(async (input, init) => {
    expect(init?.method).toBe('GET');
    const path = new URL(input instanceof Request ? input.url : input.toString()).pathname;
    if (path === '/user/installations') return Response.json({ installations: [{ id: 1 }] });
    if (path === '/user/installations/1/repositories')
      return Response.json({ repositories: repos });
    const match = /^\/repositories\/(\d+)\/(.*)$/.exec(path);
    if (!match) throw new Error(`Unexpected API: ${path}`);
    const repo = repositories[Number(match[1]) - 10];
    if (repo.failure) return repo.failure();
    if (match[2].startsWith('git/ref/')) return Response.json({ object: { sha: 'head' } });
    if (match[2] === 'git/commits/head') return Response.json({ tree: { sha: 'tree' } });
    if (match[2] === 'git/trees/tree')
      return Response.json({
        tree: (
          repo.paths ?? [`workspaces/${repo.workspaceId}/objects/${repo.workspaceId}.json`]
        ).map((path) => ({ path, sha: 'blob', type: 'blob' })),
      });
    if (match[2] === 'git/blobs/blob')
      return Response.json({
        encoding: 'base64',
        content: btoa(
          repo.data ??
            JSON.stringify(
              object('workspace', repo.workspaceId, {
                id: repo.workspaceId,
                name: repo.workspaceId,
              }),
            ),
        ),
      });
    throw new Error(`Unexpected API: ${path}`);
  });
  vi.stubGlobal('fetch', fetcher);
  return fetcher;
}

it.each([0, 1, 2])(
  'filters invalid workspace content at position %i and preserves all valid repositories',
  async (position) => {
    const repos: Repository[] = [{ workspaceId: 'a' }, { workspaceId: 'b' }];
    repos.splice(position, 0, { workspaceId: 'bad', data: '{broken' });
    transport(repos);
    const binding = githubBinding(connection);
    expect((await binding.discover()).map((o) => o.id)).toEqual(['a', 'b']);
    binding.dispose?.();
  },
);

it('returns an empty list for invalid JSON, schema, identity, manifests and missing or corrupt chunks', async () => {
  const data = [
    'null',
    '{}',
    JSON.stringify(object('workspace', 'other', { id: 'other' })),
    JSON.stringify({ id: 'bad', workspaceId: 'bad', $storage: { version: 2 } }),
    JSON.stringify({
      id: 'bad',
      workspaceId: 'bad',
      $storage: { version: 1, root: 'invalid-hash' },
    }),
    JSON.stringify({
      id: 'bad',
      workspaceId: 'bad',
      $storage: { version: 1, root: 'a'.repeat(64) },
    }),
  ];
  transport(data.map((data) => ({ workspaceId: 'bad', data })));
  expect(await githubBinding(connection).discover()).toEqual([]);
});

it('ignores missing, non-workspace, multiple-workspace and duplicate-bound repository content', async () => {
  transport([
    { workspaceId: 'absent', paths: [] },
    {
      workspaceId: 'page',
      data: JSON.stringify(object('page', 'page', { id: 'page', blocks: [] })),
    },
    { workspaceId: 'multi', paths: ['workspaces/x/objects/x.json', 'workspaces/y/objects/y.json'] },
    { workspaceId: 'w' },
    { workspaceId: 'w' },
  ]);
  const found = await githubBinding(connection).discover();
  expect(found.map((o) => o.id)).toEqual(['w']);
});

it('does not let an invalid repository reserve the identity of a valid workspace', async () => {
  transport([{ workspaceId: 'w', data: '{broken' }, { workspaceId: 'w' }]);
  const binding = githubBinding(connection);
  expect((await binding.discover()).map((o) => o.id)).toEqual(['w']);
  expect(JSON.parse(values.get('tio.github.endpoints.github-1')!)[0][1].repositoryId).toBe(11);
});

it.each([401, 429, 500])(
  'propagates connection failure %i while listing repository contents',
  async (status) => {
    transport([
      {
        workspaceId: 'w',
        failure: () =>
          new Response(null, { status, headers: status === 429 ? { 'retry-after': '60' } : {} }),
      },
    ]);
    await expect(githubBinding(connection).discover()).rejects.toMatchObject({ status });
  },
);
it('propagates GitHub rate limits reported as 403', async () => {
  transport([
    {
      workspaceId: 'w',
      failure: () => new Response(null, { status: 403, headers: { 'retry-after': '60' } }),
    },
  ]);
  await expect(githubBinding(connection).discover()).rejects.toMatchObject({
    status: 403,
    retryAt: expect.any(Number),
  });
});
it('propagates network failures without classifying them as corrupt content', async () => {
  const failure = new TypeError('Network unavailable');
  transport([
    {
      workspaceId: 'w',
      failure: () => {
        throw failure;
      },
    },
  ]);
  await expect(githubBinding(connection).discover()).rejects.toBe(failure);
});
it.each([401, 429])('propagates failure %i while reading a workspace blob', async (status) => {
  const fetcher = transport([{ workspaceId: 'w' }]);
  const original = fetcher.getMockImplementation()!;
  fetcher.mockImplementation((input, init) =>
    (input instanceof Request ? input.url : input.toString()).includes('/git/blobs/')
      ? Promise.reject(new GitHubError(status, 'Read failed'))
      : original(input, init),
  );
  await expect(githubBinding(connection).discover()).rejects.toMatchObject({ status });
});

it('uses the persisted complete marker across repository reopenings and later background syncs', async () => {
  transport([{ workspaceId: 'w' }]);
  const binding = githubBinding(connection);
  await binding.discover();
  const instance = crypto.randomUUID();
  const store = binding.repository('w', instance);
  try {
    expect(binding.isContentReady?.('w')).toBe(false);
    const sync = binding.sync!('w', store);
    sync.onComplete?.();
    expect(binding.isContentReady?.('w')).toBe(true);
    binding.sync!('w', store);
    expect(binding.isContentReady?.('w')).toBe(true);
    const reopened = binding.repository('w', instance);
    try {
      expect(binding.isContentReady?.('w')).toBe(true);
    } finally {
      reopened.close();
    }
    const fresh = binding.repository('w', crypto.randomUUID());
    try {
      expect(binding.isContentReady?.('w')).toBe(false);
    } finally {
      fresh.close();
    }
  } finally {
    store.close();
    binding.dispose?.();
  }
});
