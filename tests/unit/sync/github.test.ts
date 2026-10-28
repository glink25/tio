import { createHash } from 'node:crypto';

import { object, textBlock } from '@tio/core';
import { FileWorkspaceContent } from '@tio/file-storage';
import { LocalStore, RemoteFileCache } from '@tio/local-store';
import { GitHubClient, GitHubProvider, type GitHubSnapshotState } from '@tio/provider-github';
import { MemoryProvider } from '@tio/provider-memory';
import type { FileSnapshot } from '@tio/storage';
import { SyncCore } from '@tio/sync';
import { describe, expect, it, vi } from 'vitest';

const endpoint = { repositoryId: 7, fullName: 'owner/tio-w', branch: 'notes', workspaceId: 'w' };
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

// Exercise the real provider/cache/core together: the existing small transport tests
// cannot detect cross-reload downloads, redundant commits, or stale remote baselines.
function gitServer() {
  const blobs = new Map<string, Uint8Array>();
  const trees = new Map<string, Map<string, string>>();
  const commits = new Map<string, { tree: string; parent?: string }>();
  const calls: { path: string; body: any; method: string }[] = [];
  let sequence = 0;
  let head = '';
  let beforeRef: (() => void) | undefined;
  let loseResponse = false;
  let failBlob: string | undefined;
  const blob = (bytes: Uint8Array) => {
    const sha = createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex');
    blobs.set(sha, bytes.slice());
    return sha;
  };
  const seed = (changes: Map<string, Uint8Array | null>) => {
    const entries = new Map(head ? trees.get(commits.get(head)!.tree) : []);
    for (const [path, bytes] of changes)
      if (bytes === null) entries.delete(path);
      else entries.set(path, blob(bytes));
    const tree = `tree-${++sequence}`;
    trees.set(tree, entries);
    const next = `commit-${++sequence}`;
    commits.set(next, { tree, parent: head });
    head = next;
  };
  seed(new Map());
  const fetcher = transport((path, body, method) => {
    calls.push({ path, body, method });
    const suffix = path.replace('/repositories/7', '');
    if (!suffix) return { permissions: { push: true } };
    if (suffix.startsWith('/git/ref/')) return { object: { sha: head } };
    if (suffix.startsWith('/git/commits/'))
      return { tree: { sha: commits.get(suffix.split('/').at(-1)!)!.tree } };
    if (suffix.startsWith('/git/trees/')) {
      const sha = suffix.split('/').at(-1)!.split('?')[0];
      return {
        sha,
        tree: [...trees.get(sha)!].map(([path, sha]) => ({ path, sha, type: 'blob' })),
      };
    }
    if (suffix.startsWith('/git/blobs/')) {
      const sha = suffix.split('/').at(-1)!;
      if (sha === failBlob) throw new TypeError('offline');
      return { encoding: 'base64', content: Buffer.from(blobs.get(sha)!).toString('base64') };
    }
    if (suffix === '/git/blobs')
      return { sha: blob(new Uint8Array(Buffer.from(body.content, 'base64'))) };
    if (suffix === '/git/trees') {
      const entries = new Map(trees.get(body.base_tree));
      for (const item of body.tree)
        if (item.sha === null) entries.delete(item.path);
        else entries.set(item.path, item.sha);
      const sha = `tree-${++sequence}`;
      trees.set(sha, entries);
      return { sha };
    }
    if (suffix === '/git/commits') {
      const sha = `commit-${++sequence}`;
      commits.set(sha, { tree: body.tree, parent: body.parents[0] });
      return { sha };
    }
    if (suffix.startsWith('/git/refs/')) {
      const hook = beforeRef;
      beforeRef = undefined;
      hook?.();
      if (commits.get(body.sha)!.parent !== head) return new Response('', { status: 422 });
      head = body.sha;
      if (loseResponse) throw new TypeError('lost response');
      return {};
    }
    if (suffix.startsWith('/compare/')) {
      const [base, current] = suffix.split('/').at(-1)!.split('...');
      let ancestor: string | undefined = current;
      while (ancestor && ancestor !== base) ancestor = commits.get(ancestor)?.parent;
      return { status: ancestor === base ? 'ahead' : 'diverged' };
    }
    throw new Error(path);
  });
  return {
    calls,
    seed,
    blob,
    client: new GitHubClient(async () => 't', fetcher),
    beforeRef(hook: () => void) {
      beforeRef = hook;
    },
    loseResponse() {
      loseResponse = true;
    },
    failBlob(sha: string | undefined) {
      failBlob = sha;
    },
    files() {
      return new Map(
        [...trees.get(commits.get(head)!.tree)!].map(([path, sha]) => [path, blobs.get(sha)!]),
      );
    },
    head: () => head,
  };
}
const utf8 = (text: string) => new TextEncoder().encode(text);
function durableCache() {
  const dbName = 'github-cache-' + crypto.randomUUID();
  const namespace = ['github-1', '7', 'notes', 'w'];
  return {
    dbName,
    namespace,
    open: () => new RemoteFileCache<GitHubSnapshotState>(namespace, dbName),
  };
}

it('persists SHA snapshots and all fetched bytes across reloads, downloading only remote differences', async () => {
  const server = gitServer();
  const data = new Map(Array.from({ length: 260 }, (_, i) => [`file-${i}`, utf8(String(i))]));
  data.set('large', utf8('x'.repeat(600 * 1024)));
  data.set('asset', utf8('on demand'));
  server.seed(data);
  const cache = durableCache();
  const first = await new GitHubProvider(server.client, endpoint, cache.open()).snapshot();
  for (const [path, bytes] of data)
    if (path !== 'asset') expect(await first.files.read(path)).toEqual(bytes);
  server.calls.length = 0;
  const second = await new GitHubProvider(server.client, endpoint, cache.open()).snapshot();
  for (const [path, bytes] of data)
    if (path !== 'asset') expect(await second.files.read(path)).toEqual(bytes);
  expect(server.calls.map((call) => call.path)).toEqual(['/repositories/7/git/ref/heads/notes']);
  server.seed(
    new Map([
      ['file-4', utf8('changed')],
      ['new', utf8('new')],
      ['file-5', null],
    ]),
  );
  server.calls.length = 0;
  const third = await new GitHubProvider(server.client, endpoint, cache.open()).snapshot();
  for (const { path } of await third.files.list(''))
    if (path !== 'asset') await third.files.read(path);
  expect(await third.files.read('file-5')).toBeNull();
  expect(server.calls.filter((c) => c.path.includes('/git/blobs/'))).toHaveLength(2);
  expect(await third.files.read('asset')).toEqual(utf8('on demand'));
});

it('deduplicates bytes before uploading and persists successful publication without redownloading', async () => {
  const server = gitServer();
  const unchanged = utf8('中文🙂');
  server.seed(
    new Map([
      ['same', unchanged],
      ['remove', utf8('old')],
      ['README.md', utf8('keep')],
    ]),
  );
  const cache = durableCache();
  const provider = new GitHubProvider(server.client, endpoint, cache.open());
  const snapshot = await provider.snapshot();
  server.calls.length = 0;
  expect(
    await snapshot.publish(
      new Map([
        ['same', unchanged],
        ['absent', null],
      ]),
    ),
  ).toBe(true);
  expect(server.calls).toHaveLength(0);
  expect(
    await snapshot.publish(
      new Map([
        ['same', unchanged],
        ['new', utf8('latest')],
        ['remove', null],
      ]),
    ),
  ).toBe(true);
  expect(server.calls.filter((c) => c.path.endsWith('/git/blobs'))).toHaveLength(1);
  expect(server.calls.filter((c) => c.path.endsWith('/git/commits'))).toHaveLength(1);
  expect(
    server.calls.find((c) => c.path.endsWith('/git/trees'))!.body.tree.map((v: any) => v.path),
  ).toEqual(['new', 'remove']);
  expect(server.files().get('README.md')).toEqual(utf8('keep'));
  expect((await cache.open().getSnapshot())!.head).toBe(server.head());
  server.calls.length = 0;
  const reloaded = await new GitHubProvider(server.client, endpoint, cache.open()).snapshot();
  expect(await reloaded.files.read('new')).toEqual(utf8('latest'));
  expect(await reloaded.files.read('remove')).toBeNull();
  expect(server.calls).toHaveLength(1);
});

it('isolates durable caches and retries missing bytes without recording failed downloads', async () => {
  const server = gitServer();
  server.seed(new Map([['a', utf8('remote')]]));
  const cache = durableCache();
  const snapshot = await new GitHubProvider(server.client, endpoint, cache.open()).snapshot();
  const sha = (await snapshot.files.list(''))[0].fingerprint!;
  server.failBlob(sha);
  await expect(snapshot.files.read('a')).rejects.toThrow('offline');
  expect(await cache.open().getBlob(sha)).toBeUndefined();
  server.failBlob(undefined);
  const reloaded = await new GitHubProvider(server.client, endpoint, cache.open()).snapshot();
  expect(await reloaded.files.read('a')).toEqual(utf8('remote'));
  for (let i = 0; i < cache.namespace.length; i++) {
    const namespace = [...cache.namespace];
    namespace[i] += '-other';
    const isolated = new RemoteFileCache<GitHubSnapshotState>(namespace, cache.dbName);
    expect(await isolated.getSnapshot()).toBeUndefined();
    expect(await isolated.getBlob(sha)).toBeUndefined();
  }
});

it('advances the published baseline only after a confirmed ref, including lost responses', async () => {
  for (const race of [false, true]) {
    const server = gitServer();
    const cache = durableCache();
    const snapshot = await new GitHubProvider(server.client, endpoint, cache.open()).snapshot();
    if (race) server.beforeRef(() => server.seed(new Map([['external', utf8('keep')]])));
    else server.loseResponse();
    expect(await snapshot.publish(new Map([['a', utf8('local')]]))).toBe(!race);
    const observed = (await cache.open().getSnapshot())!;
    expect(observed.head).toBe(race ? snapshot.revision : server.head());
    if (race) expect(observed.entries).toEqual([]);
    else expect(await cache.open().getBlob(observed.entries[0][1])).toEqual(utf8('local'));
  }
});

it('coalesces local revisions, merges a remote race, and leaves edits during publication dirty', async () => {
  const server = gitServer();
  const cache = durableCache();
  const store = new LocalStore('coalesce-' + crypto.randomUUID());
  const page = object('page', 'w', {
    id: 'p',
    title: 'initial',
    blocks: [],
    extra: { opaque: [1, 'keep'] },
  });
  const other = object('page', 'w', { id: 'q', title: 'other', blocks: [] });
  const content = new FileWorkspaceContent(
    new GitHubProvider(server.client, endpoint, cache.open()),
    'w',
  );
  const sync = new SyncCore(store, content, 'e', 'w');
  try {
    await store.put(page);
    await store.put(other);
    await sync.run();
    server.calls.length = 0;
    for (let i = 0; i < 5; i++) await store.put({ ...page, title: `local-${i}` });
    await store.put({ ...other, title: 'other-final' });
    await sync.run();
    expect(server.calls.filter((c) => c.path.endsWith('/git/commits'))).toHaveLength(1);
    expect(
      JSON.parse(new TextDecoder().decode(server.files().get('workspaces/w/objects/p.json'))).title,
    ).toBe('local-4');
    server.calls.length = 0;
    await sync.run();
    expect(server.calls.filter((c) => c.method !== 'GET')).toHaveLength(0);
    await store.put({ ...page, title: 'before-upload' });
    server.beforeRef(() =>
      server.seed(
        new Map([
          [
            'workspaces/w/objects/p.json',
            utf8(
              JSON.stringify({
                ...page,
                title: 'local-4',
                extra: { opaque: [1, 'keep'], remote: true },
              }),
            ),
          ],
        ]),
      ),
    );
    await sync.run();
    expect((await store.get('p'))!.object).toMatchObject({
      title: 'before-upload',
      extra: { opaque: [1, 'keep'], remote: true },
    });
    const cached = cache.open();
    const save = cached.setSnapshot.bind(cached);
    vi.spyOn(cached, 'setSnapshot').mockImplementation(async (state) => {
      if (state.head !== (await cached.getSnapshot())?.head)
        await store.put({ ...(await store.get('p'))!.object, title: 'during-upload' });
      await save(state);
    });
    await store.put({ ...(await store.get('p'))!.object, title: 'publish-me' });
    await new SyncCore(
      store,
      new FileWorkspaceContent(new GitHubProvider(server.client, endpoint, cached), 'w'),
      'e',
      'w',
    ).run();
    const entry = (await store.get('p'))!;
    expect(entry.object.title).toBe('during-upload');
    expect(entry.sync.e.base.title).toBe('publish-me');
    expect(entry.revision).toBeGreaterThan(entry.sync.e.revision);
  } finally {
    store.close();
  }
});

it('downloads only changed chunks and detects a changed child even when its object manifest is unchanged', async () => {
  const files = new MemoryProvider();
  const writer = new FileWorkspaceContent(files, 'w', { maxFileBytes: 1024 });
  const page = object('page', 'w', {
    id: 'p',
    title: 'chunked',
    blocks: Array.from({ length: 40 }, (_, i) => textBlock(`Block ${i}: ` + 'text '.repeat(30))),
    unknown: { nested: ['preserve', 42] },
  });
  await writer.write(page);
  const server = gitServer();
  server.seed(new Map(files.files));
  const cache = durableCache();
  const read = async () => {
    const content = new FileWorkspaceContent(
      new GitHubProvider(server.client, endpoint, cache.open()),
      'w',
      { maxFileBytes: 1024 },
    );
    const snapshot = await content.snapshot!();
    await snapshot.content.list();
    return snapshot.content.read('p');
  };
  expect(await read()).toEqual(page);
  const previous = new Map(files.files);
  const updated = { ...page, title: 'changed' };
  await writer.write(updated);
  const changes = new Map(
    [...files.files].filter(
      ([path, bytes]) => !previous.has(path) || !Buffer.from(previous.get(path)!).equals(bytes),
    ),
  );
  server.seed(changes);
  server.calls.length = 0;
  expect(await read()).toEqual(updated);
  expect(server.calls.filter((c) => c.path.includes('/git/blobs/'))).toHaveLength(changes.size);
  const child = [...changes.keys()].find((path) => path.includes('/chunks/'))!;
  server.seed(new Map([[child, utf8('{"kind":"value","value":"corrupted"}')]]));
  server.calls.length = 0;
  await expect(read()).rejects.toMatchObject({ code: 'invalid' });
  expect(server.calls.filter((c) => c.path.includes('/git/blobs/'))).toHaveLength(1);
});
