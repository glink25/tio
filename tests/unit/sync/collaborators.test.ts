import { GitHubAdapter } from '@tio/adapter-github';
import { GitHubClient, GitHubError } from '@tio/provider-github';
import { expect, it, vi } from 'vitest';

it('reads and deduplicates every collaborator page for the workspace repository', async () => {
  const transport = vi
    .fn<typeof fetch>()
    .mockResolvedValueOnce(
      Response.json(Array.from({ length: 100 }, (_, id) => ({ id, login: `user${id}` }))),
    )
    .mockResolvedValueOnce(
      Response.json([
        { id: 99, login: 'user99' },
        { id: 100, login: 'last-user' },
      ]),
    );
  const adapter = new GitHubAdapter(
    'github-1',
    1,
    new GitHubClient(async () => 'token', transport),
    'app',
    new Map([
      ['w', { workspaceId: 'w', repositoryId: 12, fullName: 'owner/tio-repo', branch: 'main' }],
    ]),
  );
  const result = await adapter.collaborators('w');
  expect(result).toHaveLength(101);
  expect(result.find((item) => item.reference.id === '100')).toMatchObject({
    reference: { workspaceId: 'w', kind: 'github-user', id: '100', login: 'last-user' },
  });
  expect(
    transport.mock.calls.map(([url]) =>
      typeof url === 'string' ? url : url instanceof URL ? url.href : url.url,
    ),
  ).toEqual([
    'https://api.github.com/repos/owner/tio-repo/collaborators?affiliation=all&per_page=100&page=1',
    'https://api.github.com/repos/owner/tio-repo/collaborators?affiliation=all&per_page=100&page=2',
  ]);
});
it('preserves structured authorization and rate-limit failures', async () => {
  for (const status of [401, 403, 429]) {
    const client = new GitHubClient(
      async () => 'token',
      vi
        .fn<typeof fetch>()
        .mockResolvedValue(
          new Response(null, { status, headers: status === 429 ? { 'retry-after': '60' } : {} }),
        ),
    );
    const adapter = new GitHubAdapter(
      'github-1',
      1,
      client,
      'pat',
      new Map([
        ['w', { workspaceId: 'w', repositoryId: 12, fullName: 'owner/repo', branch: 'main' }],
      ]),
    );
    await expect(adapter.collaborators('w')).rejects.toBeInstanceOf(GitHubError);
    await expect(adapter.collaborators('w')).rejects.toMatchObject({ status });
  }
});
