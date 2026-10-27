import { eligibleRepository, GitHubAdapter } from '@tio/adapter-github';
import { object, textBlock } from '@tio/core';
import { FileWorkspaceContent } from '@tio/file-storage';
import { LocalStore } from '@tio/local-store';
import { GitHubClient, GitHubProvider, GitHubError } from '@tio/provider-github';
import { MemoryProvider } from '@tio/provider-memory';
import type { FileSnapshot } from '@tio/storage';
import { SyncCore } from '@tio/sync';
import { describe, expect, it, vi } from 'vitest';

import { handleRequest, isAllowedRedirect } from '../apps/auth/src/index';
import {
  encryptState,
  decryptState,
  encryptAuthorizationGrant,
  decryptAuthorizationGrant,
} from '../apps/auth/src/state';

const endpoint = { repositoryId: 7, fullName: 'owner/tio-w', branch: 'notes', workspaceId: 'w' };
const repo = {
  id: 7,
  name: 'tio-w',
  full_name: 'owner/tio-w',
  default_branch: 'notes',
  owner: { login: 'owner' },
};
function transport(responder: (path: string, body: any, method: string) => unknown) {
  return vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const result = responder(
      new URL(input instanceof Request ? input.url : input.toString()).pathname +
        new URL(input instanceof Request ? input.url : input.toString()).search,
      init?.body ? JSON.parse(init.body as string) : undefined,
      init?.method ?? 'GET',
    );
    if (result instanceof Response) return result;
    return Response.json(result);
  }) as unknown as typeof fetch;
}
describe('GitHub files', () => {
  it('reads a pinned snapshot, preserves base tree, and publishes multiple files in one commit', async () => {
    const calls: { path: string; body: any }[] = [];
    const fetcher = transport((path, body) => {
      calls.push({ path, body });
      if (path.includes('/git/ref/')) return { object: { sha: 'original' } };
      if (path.endsWith('/git/commits/original')) return { tree: { sha: 'base' } };
      if (path.endsWith('/git/trees/base?recursive=1'))
        return { tree: [{ path: 'a', sha: 'blob-a', type: 'blob' }] };
      if (path.endsWith('/git/blobs/blob-a')) return { encoding: 'base64', content: btoa('hello') };
      if (path.endsWith('/git/blobs')) return { sha: 'new-blob' };
      if (path.endsWith('/git/trees')) return { sha: 'new-tree' };
      if (path.endsWith('/git/commits')) return { sha: 'new-commit' };
      if (path.includes('/git/refs/')) return {};
      throw new Error(path);
    });
    const provider = new GitHubProvider(new GitHubClient(async () => 'token', fetcher), endpoint);
    const snapshot = await provider.snapshot();
    expect(new TextDecoder().decode((await snapshot.files.read('a'))!)).toBe('hello');
    expect(await snapshot.files.read('missing')).toBeNull();
    expect(
      await snapshot.publish(
        new Map([
          ['a', new Uint8Array([1])],
          ['b', new Uint8Array([2])],
        ]),
      ),
    ).toBe(true);
    expect(calls.find((call) => call.path.endsWith('/git/trees'))?.body).toMatchObject({
      base_tree: 'base',
      tree: [{ path: 'a' }, { path: 'b' }],
    });
    expect(calls.find((call) => call.path.endsWith('/git/commits'))?.body.parents).toEqual([
      'original',
    ]);
    expect(calls.find((call) => call.path.includes('/git/refs/'))?.body).toEqual({
      sha: 'new-commit',
      force: false,
    });
    expect(calls.filter((call) => call.path.includes('/git/ref/'))).toHaveLength(1);
  });
  it('walks truncated trees and reuses blob SHA cache', async () => {
    const fetcher = transport((path) => {
      if (path.includes('/git/ref/')) return { object: { sha: 'head' } };
      if (path.includes('/git/commits/')) return { tree: { sha: 'root' } };
      if (path.endsWith('recursive=1')) return { tree: [], truncated: true };
      if (path.endsWith('/git/trees/root'))
        return { tree: [{ path: 'dir', type: 'tree', sha: 'sub' }] };
      if (path.endsWith('/git/trees/sub'))
        return { tree: [{ path: 'file', type: 'blob', sha: 'blob' }] };
      if (path.endsWith('/git/blobs/blob')) return { encoding: 'base64', content: btoa('value') };
      throw new Error(path);
    });
    const provider = new GitHubProvider(new GitHubClient(async () => 't', fetcher), endpoint);
    const first = await provider.snapshot();
    expect(await first.files.list('dir/')).toEqual([{ path: 'dir/file', fingerprint: 'blob' }]);
    await first.files.read('dir/file');
    await (await provider.snapshot()).files.read('dir/file');
    expect(
      vi
        .mocked(fetcher)
        .mock.calls.filter(([url]) =>
          (url instanceof Request ? url.url : url.toString()).endsWith('/git/blobs/blob'),
        ),
    ).toHaveLength(1);
  });
  it('distinguishes ref races from lost successful responses', async () => {
    for (const remote of ['other', 'new']) {
      let updated = false;
      const fetcher = transport((path) => {
        if (path.includes('/git/ref/')) return { object: { sha: updated ? remote : 'old' } };
        if (path.includes('/git/commits/')) return { tree: { sha: 'tree' } };
        if (path.includes('/git/trees/')) return { tree: [] };
        if (path.endsWith('/git/blobs')) return { sha: 'blob' };
        if (path.endsWith('/git/trees')) return { sha: 'tree2' };
        if (path.endsWith('/git/commits')) return { sha: 'new' };
        if (path.includes('/git/refs/')) {
          updated = true;
          throw new TypeError('connection lost');
        }
        if (path.includes('/compare/')) return { status: 'diverged' };
        throw new Error(path);
      });
      const snapshot = await new GitHubProvider(
        new GitHubClient(async () => 't', fetcher),
        endpoint,
      ).snapshot();
      expect(await snapshot.publish(new Map([['a', new Uint8Array([1])]]))).toBe(remote === 'new');
    }
  });
  it('does not classify rate limiting as expired credentials', async () => {
    const client = new GitHubClient(
      async () => 't',
      transport(() => new Response('', { status: 403, headers: { 'retry-after': '120' } })),
    );
    await expect(client.request('/user')).rejects.toMatchObject({
      status: 403,
      retryAt: expect.any(Number),
    });
    const adapter = new GitHubAdapter('c', 1, client, 'pat', new Map());
    expect(adapter.classifyError(new GitHubError(403, 'rate', Date.now() + 1000)).code).toBe(
      'unreachable',
    );
  });
});
it('only discovers the allowed repository names', () => {
  expect(eligibleRepository(repo)).toBe(true);
  expect(eligibleRepository({ ...repo, name: 'owner.github.io' })).toBe(true);
  expect(eligibleRepository({ ...repo, name: 'other.github.io' })).toBe(false);
  expect(eligibleRepository({ ...repo, name: 'notes' })).toBe(false);
});
class AtomicFiles extends MemoryProvider {
  publications = 0;
  reject = false;
  duringPublish?: () => Promise<void>;
  async snapshot(): Promise<FileSnapshot> {
    const copy = new MemoryProvider();
    copy.files = new Map(this.files);
    return {
      revision: 'head',
      files: copy,
      publish: async (changes) => {
        this.publications++;
        if (this.reject) return false;
        await this.duringPublish?.();
        for (const [path, bytes] of changes)
          if (bytes) this.files.set(path, bytes);
          else this.files.delete(path);
        return true;
      },
    };
  }
}
it('ACK waits for publication and preserves edits made during upload', async () => {
  const store = new LocalStore('gh-' + crypto.randomUUID());
  const files = new AtomicFiles();
  const page = object('page', 'w', { id: 'p', title: 'before', blocks: [textBlock('text')] });
  try {
    await store.put(page);
    files.reject = true;
    const sync = new SyncCore(store, new FileWorkspaceContent(files, 'w'), 'endpoint', 'w');
    await expect(sync.run()).rejects.toThrow('Remote version');
    expect((await store.get('p'))?.sync.endpoint).toBeUndefined();
    expect(files.publications).toBe(3);
    files.reject = false;
    files.duringPublish = async () => {
      await store.put({ ...page, title: 'during' });
    };
    await sync.run();
    const entry = await store.get('p');
    expect(entry?.object.title).toBe('during');
    expect(entry?.sync.endpoint.base.title).toBe('before');
    expect(entry!.revision).toBeGreaterThan(entry!.sync.endpoint.revision);
  } finally {
    store.close();
  }
});
it('remote asset metadata does not force a download, while new local assets still need bytes', async () => {
  const store = new LocalStore('assets-' + crypto.randomUUID());
  store.remoteAssets = true;
  const files = new AtomicFiles();
  const asset = object('asset', 'w', {
    id: 'a',
    filename: 'a.png',
    mime: 'image/png',
    assetPath: 'assets/a.png',
    byteSize: 1,
  });
  try {
    await new FileWorkspaceContent(files, 'w').write(asset);
    const sync = new SyncCore(store, new FileWorkspaceContent(files, 'w'), 'e', 'w');
    await sync.run();
    expect(sync.issues).toEqual([]);
    expect(await store.readAsset('a')).toBeUndefined();
    expect((await store.get('a'))?.object).toEqual(asset);
    await expect(store.put({ ...asset, id: 'b', assetPath: 'assets/b.png' })).rejects.toThrow(
      'Missing asset',
    );
  } finally {
    store.close();
  }
});
const env = {
  GITHUB_CLIENT_ID: 'id',
  GITHUB_CLIENT_SECRET: 'secret',
  GITHUB_APP_SLUG: 'tio',
  STATE_SECRET: 'state-secret',
  REDIRECT_URI_ALLOWLIST: 'https://tio.example/',
  FRONTEND_ORIGIN: 'https://tio.example',
};
it('auth envelopes validate expiry and purpose and redirect allowlist is exact', async () => {
  const state = {
    redirect_uri: 'https://tio.example/',
    client_state: 's',
    client_challenge: 'c',
    github_verifier: 'v',
    exp: Date.now() + 10000,
  };
  const encrypted = await encryptState(state, env.STATE_SECRET);
  expect((await decryptState(encrypted, env.STATE_SECRET)).client_state).toBe('s');
  await expect(decryptState(encrypted, env.STATE_SECRET, Date.now() + 20000)).rejects.toThrow(
    'expired',
  );
  const grant = await encryptAuthorizationGrant(
    { state: 's', challenge: 'c', token: { access_token: 't' }, exp: Date.now() + 10000 },
    env.STATE_SECRET,
  );
  await expect(decryptState(grant, env.STATE_SECRET)).rejects.toThrow();
  await expect(decryptAuthorizationGrant(encrypted, env.STATE_SECRET)).rejects.toThrow();
  expect(isAllowedRedirect('https://tio.example/elsewhere', env.REDIRECT_URI_ALLOWLIST)).toBe(
    false,
  );
});
it('auth rejects untrusted origins and invalid PKCE exchanges', async () => {
  expect(
    (
      await handleRequest(
        new Request('https://auth.example/api/github/refresh', {
          method: 'POST',
          headers: { Origin: 'https://evil.example' },
          body: '{}',
        }),
        env,
      )
    ).status,
  ).toBe(403);
  expect(
    (
      await handleRequest(
        new Request('https://auth.example/api/github/exchange', {
          method: 'POST',
          headers: { Origin: 'https://tio.example' },
          body: JSON.stringify({ code: 'x', state: 'x', code_verifier: 'x' }),
        }),
        env,
      )
    ).status,
  ).toBe(400);
});

it('paginates repository discovery and keeps the originally bound branch', async () => {
  const unrelated = Array.from({ length: 100 }, (_, i) => ({
    ...repo,
    id: 100 + i,
    name: `unrelated-${i}`,
  }));
  const paths: string[] = [];
  const client = new GitHubClient(
    async () => 'token',
    transport((path) => {
      paths.push(path);
      if (path.startsWith('/user/repos'))
        return path.endsWith('page=1') ? unrelated : [{ ...repo, default_branch: 'new-default' }];
      if (path.includes('/git/ref/')) return { object: { sha: 'head' } };
      if (path.includes('/git/commits/')) return { tree: { sha: 'tree' } };
      if (path.includes('/git/trees/'))
        return { tree: [{ path: 'workspaces/w/objects/w.json', sha: 'w', type: 'blob' }] };
      throw new Error(path);
    }),
  );
  const endpoints = new Map([['w', endpoint]]);
  const adapter = new GitHubAdapter('c', 1, client, 'pat', endpoints);
  const found = await adapter.discover();
  expect(found).toHaveLength(1);
  expect(found[0].workspaceId).toBe('w');
  expect(paths.some((path) => path.endsWith('/git/ref/heads/notes'))).toBe(true);
  expect(endpoints.get('w')?.branch).toBe('notes');
});
it('App discovery is constrained to installation repositories', async () => {
  const paths: string[] = [];
  const client = new GitHubClient(
    async () => 't',
    transport((path) => {
      paths.push(path);
      if (path.startsWith('/user/installations?')) return { installations: [{ id: 3 }] };
      if (path.startsWith('/user/installations/3/repositories')) return { repositories: [repo] };
      throw new Error(path);
    }),
  );
  expect(await new GitHubAdapter('c', 1, client, 'app', new Map()).repositories()).toEqual([repo]);
  expect(paths.some((path) => path.startsWith('/user/repos'))).toBe(false);
});
it('reports a lost creation response without recovery requests', async () => {
  const fetcher = transport((path, body) => {
    expect(path).toBe('/user/repos');
    expect(body).toEqual({ name: 'tio-w', private: true, auto_init: true });
    throw new TypeError('lost response');
  });
  const adapter = new GitHubAdapter(
    'c',
    1,
    new GitHubClient(async () => 't', fetcher),
    'pat',
    new Map(),
  );
  await expect(adapter.create('w')).rejects.toThrow('lost response');
  expect(fetcher).toHaveBeenCalledTimes(1);
});

it('ignores repositories without workspace markers', async () => {
  for (const empty of [false, true]) {
    const client = new GitHubClient(
      async () => 't',
      transport((path) => {
        if (path.startsWith('/user/repos?'))
          return [repo, { ...repo, id: 8, name: 'owner.github.io' }];
        if (path.includes('/git/ref/')) {
          if (empty) return new Response('', { status: 409 });
          return { object: { sha: 'head' } };
        }
        if (path.includes('/git/commits/')) return { tree: { sha: 'tree' } };
        if (path.includes('/git/trees/'))
          return { tree: [{ path: 'index.html', type: 'blob', sha: 'web' }] };
        throw new Error(path);
      }),
    );
    const found = await new GitHubAdapter('c', 1, client, 'pat', new Map()).discover();
    expect(found).toEqual([]);
  }
});

it('accepts a website repository containing a workspace marker', async () => {
  const client = new GitHubClient(
    async () => 't',
    transport((path) => {
      if (path.startsWith('/user/repos?')) return [{ ...repo, name: 'owner.github.io' }];
      if (path.includes('/git/ref/')) return { object: { sha: 'head' } };
      if (path.includes('/git/commits/')) return { tree: { sha: 'tree' } };
      if (path.includes('/git/trees/'))
        return { tree: [{ path: 'workspaces/w/objects/w.json', type: 'blob', sha: 'w' }] };
      throw new Error(path);
    }),
  );
  expect(await new GitHubAdapter('c', 1, client, 'pat', new Map()).discover()).toMatchObject([
    { workspaceId: 'w' },
  ]);
});

it('explains rejected repository creation without treating rate limits as permission failures', async () => {
  for (const limited of [false, true]) {
    const client = new GitHubClient(
      async () => 't',
      transport((path) => {
        if (path === '/user') return { login: 'owner' };
        if (path.startsWith('/repos/')) return new Response('', { status: 404 });
        return new Response('', { status: 403, headers: limited ? { 'retry-after': '60' } : {} });
      }),
    );
    const adapter = new GitHubAdapter('c', 1, client, 'app', new Map());
    if (limited)
      await expect(adapter.create('w')).rejects.toMatchObject({ retryAt: expect.any(Number) });
    else await expect(adapter.create('w')).rejects.toThrow('Repository creation');
  }
});
