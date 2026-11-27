import { GiteeAdapter } from '@tio/adapter-gitee';
import { object, textBlock } from '@tio/core';
import { FileWorkspaceContent } from '@tio/file-storage';
import { GiteeClient, GiteeProvider } from '@tio/provider-gitee';
import { gitToken } from '@tio/provider-github/credentials';
import { describe, expect, it, vi } from 'vitest';

const root = '/api/v5/repos/owner/tio-w';
const marker = 'workspaces/w/objects/w.json';
const page = 'workspaces/w/objects/page.json';
const chunk = 'workspaces/w/chunks/chunk.json';
const endpoint = { repositoryId: 10, fullName: 'owner/tio-w', branch: 'main', workspaceId: 'w' };
const repo = {
  id: 10,
  name: 'tio-w',
  full_name: endpoint.fullName,
  default_branch: 'main',
  owner: { login: 'owner' },
  permission: { push: true },
};

function server() {
  const files = new Map([[marker, 'b2xk']]);
  const writes: string[] = [];
  let rejectPath: string | undefined;
  const transport: typeof fetch = async (input, options) => {
    const url = new URL(input instanceof Request ? input.url : input);
    const path = decodeURIComponent(url.pathname);
    if (path === '/api/v5/user/repos') return Response.json([repo]);
    if (path === root) return Response.json(repo);
    if (path.startsWith(root + '/git/trees/'))
      return Response.json({
        tree: [...files].map(([path, sha]) => ({ path, sha, type: 'blob' })),
      });
    if (path.startsWith(root + '/git/blobs/'))
      return Response.json({
        encoding: 'base64',
        content: path.slice((root + '/git/blobs/').length),
      });
    if (!path.startsWith(root + '/contents/')) throw new Error('Unexpected request');
    const file = path.slice((root + '/contents/').length);
    const current = files.get(file);
    if (!options?.method || options.method === 'GET')
      return current ? Response.json({ sha: current }) : new Response(null, { status: 404 });
    if (file === rejectPath) return new Response(null, { status: 503 });
    if (typeof options.body !== 'string') throw new Error('Missing JSON request');
    const body = JSON.parse(options.body);
    if (current !== body.sha) return new Response(null, { status: 409 });
    writes.push(file);
    if (options.method === 'DELETE') files.delete(file);
    else files.set(file, body.content);
    return Response.json({});
  };
  const client = new GiteeClient(async () => 'test-token', transport);
  return {
    client,
    files,
    writes,
    fail: (path?: string) => {
      rejectPath = path;
    },
  };
}

describe('Gitee storage', () => {
  it('discovers a sole marker and rejects foreign or already-bound workspaces', async () => {
    const { client, files } = server();
    const endpoints = new Map();
    const adapter = new GiteeAdapter('gitee-1', 1, client, endpoints, async () => 'cancelled');
    expect(await adapter.discover()).toMatchObject([{ workspaceId: 'w', endpoint }]);
    endpoints.set('w', { ...endpoint, repositoryId: 11 });
    expect(await adapter.discover()).toEqual([]);
    endpoints.clear();
    files.set('workspaces/foreign/objects/foreign.json', 'b2xk');
    expect(await adapter.discover()).toEqual([]);
    const provider = new GiteeProvider(client, endpoint);
    await expect(provider.write(page, new Uint8Array([1]))).rejects.toMatchObject({ status: 422 });
    await expect(provider.read('workspaces/foreign/objects/foreign.json')).rejects.toMatchObject({
      code: 'invalid',
    });
  });

  it('preserves bytes, rejects stale SHAs, and can retry a failed object head after writing a chunk', async () => {
    const { client, files, writes, fail } = server();
    const provider = new GiteeProvider(client, endpoint);
    const bytes = new Uint8Array([0, 128, 255]);
    await provider.read(marker);
    files.set(marker, 'bmV3');
    await expect(provider.write(marker, bytes)).rejects.toMatchObject({ status: 409 });
    expect(files.get(marker)).toBe('bmV3');

    await provider.write(chunk, bytes);
    fail(page);
    await expect(provider.write(page, bytes)).rejects.toMatchObject({ status: 503 });
    expect(files.has(page)).toBe(false);
    const reopened = new GiteeProvider(client, endpoint);
    expect(await reopened.read(chunk)).toEqual(bytes);
    fail();
    await reopened.write(page, bytes);
    expect(writes).toEqual([chunk, page]);
    expect(await reopened.read(page)).toEqual(bytes);
    await reopened.delete(page);
    expect(await reopened.read(page)).toBeNull();
  });

  it('publishes an actual chunked object only after its immutable nodes are durable', async () => {
    const { client, files, writes, fail } = server();
    const target = object('page', 'w', { id: 'page', blocks: [textBlock('你好🦊'.repeat(800))] });
    const open = () =>
      new FileWorkspaceContent(new GiteeProvider(client, endpoint), 'w', { maxFileBytes: 1024 });
    fail(page);
    await expect(open().write(target)).rejects.toMatchObject({ status: 503 });
    expect(files.has(page)).toBe(false);
    expect(writes.length).toBeGreaterThan(1);
    expect(writes.every((path) => path.startsWith('workspaces/w/chunks/'))).toBe(true);
    const previousWrites = writes.length;
    fail();
    await open().write(target);
    expect(writes.slice(previousWrites)).toEqual([page]);
    expect(await open().read(target.id)).toEqual(target);
  });

  it('refreshes only the matching saved Gitee account', async () => {
    const write = vi.fn();
    const transport = vi.fn(async () =>
      Response.json({ access_token: 'new', expires_in: 7200, refresh_token: 'rotated' }),
    );
    const host = {
      read: async () => ({
        provider: 'gitee' as const,
        userId: 7,
        login: 'owner',
        mode: 'app' as const,
        accessToken: 'old',
        expiresAt: 1000,
        refreshToken: 'refresh',
      }),
      write,
      transport,
      authOrigin: 'https://worker.example',
      now: () => 1000,
    };
    await expect(gitToken('github', 7, host)).rejects.toMatchObject({ status: 401 });
    await expect(gitToken('gitee', 8, host)).rejects.toMatchObject({ status: 401 });
    expect(transport).not.toHaveBeenCalled();
    expect(await gitToken('gitee', 7, host)).toBe('new');
    expect(transport).toHaveBeenCalledWith(
      'https://worker.example/api/gitee/refresh',
      expect.anything(),
    );
    expect(write).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 7, refreshToken: 'rotated', refreshExpiresAt: undefined }),
    );
  });
});
