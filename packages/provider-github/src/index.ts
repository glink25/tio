import type { FileStorageProvider, FileSnapshot } from '@tio/storage';

export class GitHubError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly retryAt?: number,
  ) {
    super(message);
  }
}
export interface GitHubRepository {
  id: number;
  name: string;
  full_name: string;
  default_branch: string;
  owner: { login: string };
  permissions?: { push?: boolean };
  archived?: boolean;
}
export interface GitHubEndpoint {
  repositoryId: number;
  fullName: string;
  branch: string;
  workspaceId: string;
}
export class GitHubClient {
  private retryAt = 0;
  constructor(
    readonly token: () => Promise<string>,
    private transport: typeof fetch = (...args) => fetch(...args),
  ) {}
  async request<T>(
    path: string,
    body?: unknown,
    method = body === undefined ? 'GET' : 'POST',
  ): Promise<T> {
    if (this.retryAt > Date.now()) throw new GitHubError(429, 'GitHub rate limit', this.retryAt);
    const response = await this.transport('https://api.github.com' + path, {
      method,
      ...(method === 'GET' ? { cache: 'no-store' as const } : {}),
      headers: {
        Authorization: `Bearer ${await this.token()}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2026-03-10',
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    if (!response.ok) {
      const retry = response.headers.get('retry-after');
      const reset =
        response.headers.get('x-ratelimit-remaining') === '0'
          ? response.headers.get('x-ratelimit-reset')
          : null;
      this.retryAt = retry ? Date.now() + Number(retry) * 1000 : reset ? Number(reset) * 1000 : 0;
      throw new GitHubError(
        response.status,
        `GitHub: ${response.status} ${response.statusText}`,
        retry ? Date.now() + Number(retry) * 1000 : reset ? Number(reset) * 1000 : undefined,
      );
    }
    return response.status === 204 ? (undefined as T) : (response.json() as Promise<T>);
  }
  async pages<T>(path: string, key?: string): Promise<T[]> {
    const result: T[] = [];
    for (let page = 1; ; page++) {
      const data = await this.request<T[] | Record<string, T[]>>(
        `${path}${path.includes('?') ? '&' : '?'}per_page=100&page=${page}`,
      );
      const values = key ? (data as Record<string, T[]>)[key] : (data as T[]);
      result.push(...values);
      if (values.length < 100) return result;
    }
  }
}
interface TreeEntry {
  path: string;
  sha: string;
  type: string;
}
interface Tree {
  sha: string;
  tree: TreeEntry[];
  truncated?: boolean;
}
function base64(bytes: Uint8Array) {
  let value = '';
  for (const byte of bytes) value += String.fromCharCode(byte);
  return btoa(value);
}
/** Remote observations only: never store optimistic local edits in this cache. */
export interface GitHubSnapshotState {
  head: string;
  tree: string;
  entries: [string, string][];
}
export interface GitHubCache {
  getSnapshot(): Promise<GitHubSnapshotState | undefined>;
  setSnapshot(snapshot: GitHubSnapshotState): Promise<void>;
  getBlob(sha: string): Promise<Uint8Array | undefined>;
  putBlob(sha: string, bytes: Uint8Array): Promise<void>;
}
async function gitBlobSha(bytes: Uint8Array) {
  const header = new TextEncoder().encode(`blob ${bytes.byteLength}\0`);
  const data = new Uint8Array(header.length + bytes.length);
  data.set(header);
  data.set(bytes, header.length);
  const digest = await crypto.subtle.digest('SHA-1', data);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}
export class GitHubProvider implements FileStorageProvider {
  private blobs = new Map<string, Uint8Array>();
  private observed?: GitHubSnapshotState;
  private async remember(sha: string, bytes: Uint8Array) {
    await this.cache?.putBlob(sha, bytes);
    if (bytes.length <= 512 * 1024) {
      this.blobs.set(sha, bytes.slice());
      if (this.blobs.size > 256) this.blobs.delete(this.blobs.keys().next().value!);
    }
  }
  constructor(
    readonly client: GitHubClient,
    readonly endpoint: GitHubEndpoint,
    private cache?: GitHubCache,
  ) {}
  private get root() {
    return `/repositories/${this.endpoint.repositoryId}`;
  }
  async canWrite() {
    const repo = await this.client.request<GitHubRepository>(this.root);
    return !!repo.permissions?.push && !repo.archived;
  }
  async snapshot(): Promise<FileSnapshot> {
    const ref = await this.client.request<{ object: { sha: string } }>(
      `${this.root}/git/ref/heads/${encodeURIComponent(this.endpoint.branch)}`,
    );
    const head = ref.object.sha;
    let state = (await this.cache?.getSnapshot()) ?? this.observed;
    if (state?.head !== head) {
      const commit = await this.client.request<{ tree: { sha: string } }>(
        `${this.root}/git/commits/${head}`,
      );
      const tree = await this.client.request<Tree>(
        `${this.root}/git/trees/${commit.tree.sha}?recursive=1`,
      );
      const entries = new Map<string, string>();
      const walk = async (sha: string, prefix: string) => {
        const subtree = await this.client.request<Tree>(`${this.root}/git/trees/${sha}`);
        if (subtree.truncated) throw new Error('GitHub tree is incomplete');
        for (const item of subtree.tree) {
          if (item.type === 'tree') await walk(item.sha, prefix + item.path + '/');
          else if (item.type === 'blob') entries.set(prefix + item.path, item.sha);
        }
      };
      if (tree.truncated) await walk(commit.tree.sha, '');
      else for (const item of tree.tree) if (item.type === 'blob') entries.set(item.path, item.sha);
      state = { head, tree: commit.tree.sha, entries: [...entries] };
      await this.cache?.setSnapshot(state);
    }
    this.observed = state;
    const treeSha = state.tree;
    const entries = new Map(state.entries);
    let permission: Promise<boolean> | undefined;
    const files: FileStorageProvider = {
      canWrite: () => (permission ??= this.canWrite()),
      list: async (prefix) =>
        [...entries]
          .filter(([path]) => path.startsWith(prefix))
          .map(([path, fingerprint]) => ({ path, fingerprint })),
      read: async (path) => {
        const sha = entries.get(path);
        if (!sha) return null;
        const cached = this.blobs.get(sha) ?? (await this.cache?.getBlob(sha));
        if (cached) return cached.slice();
        const blob = await this.client.request<{ content: string; encoding: string }>(
          `${this.root}/git/blobs/${sha}`,
        );
        if (blob.encoding !== 'base64') throw new Error('Unsupported GitHub blob encoding');
        const bytes = Uint8Array.from(atob(blob.content.replace(/\s/g, '')), (c) =>
          c.charCodeAt(0),
        );
        await this.remember(sha, bytes);
        return bytes.slice();
      },
      write: async () => {
        throw new Error('Snapshot is read-only');
      },
      delete: async () => {
        throw new Error('Snapshot is read-only');
      },
    };
    return {
      files,
      revision: head,
      publish: async (changes) => {
        if (!changes.size) return true;
        const markers = [...entries.keys()].flatMap((path) => {
          const match = /^workspaces\/([\w-]+)\/objects\/\1\.json$/.exec(path);
          return match ? [match[1]] : [];
        });
        if (markers.some((id) => id !== this.endpoint.workspaceId))
          throw new GitHubError(422, 'Repository already contains another workspace');
        const updates = [];
        const uploaded = new Map<string, Uint8Array>();
        const nextEntries = new Map(entries);
        for (const [path, bytes] of changes) {
          if (bytes === null ? !entries.has(path) : (await gitBlobSha(bytes)) === entries.get(path))
            continue;
          const blob =
            bytes === null
              ? null
              : await this.client.request<{ sha: string }>(`${this.root}/git/blobs`, {
                  content: base64(bytes),
                  encoding: 'base64',
                });
          updates.push({ path, mode: '100644', type: 'blob', sha: blob?.sha ?? null });
          if (blob && bytes) {
            nextEntries.set(path, blob.sha);
            uploaded.set(blob.sha, bytes.slice());
          } else nextEntries.delete(path);
        }
        if (!updates.length) return true;
        const nextTree = await this.client.request<{ sha: string }>(`${this.root}/git/trees`, {
          base_tree: treeSha,
          tree: updates,
        });
        const next = await this.client.request<{ sha: string }>(`${this.root}/git/commits`, {
          message: 'tio: synchronize workspace',
          tree: nextTree.sha,
          parents: [head],
        });
        const confirm = async () => {
          for (const [sha, bytes] of uploaded) await this.remember(sha, bytes);
          const published = { head: next.sha, tree: nextTree.sha, entries: [...nextEntries] };
          await this.cache?.setSnapshot(published);
          this.observed = published;
          return true;
        };
        try {
          await this.client.request(
            `${this.root}/git/refs/heads/${encodeURIComponent(this.endpoint.branch)}`,
            { sha: next.sha, force: false },
            'PATCH',
          );
        } catch (error) {
          const current = await this.client.request<{ object: { sha: string } }>(
            `${this.root}/git/ref/heads/${encodeURIComponent(this.endpoint.branch)}`,
          );
          if (current.object.sha === next.sha) return confirm();
          const comparison = await this.client.request<{ status: string }>(
            `${this.root}/compare/${next.sha}...${current.object.sha}`,
          );
          if (comparison.status === 'ahead' || comparison.status === 'identical') return confirm();
          if (current.object.sha !== head) return false;
          throw error;
        }
        return confirm();
      },
    };
  }
  async list(prefix: string) {
    return (await this.snapshot()).files.list(prefix);
  }
  async read(path: string) {
    return (await this.snapshot()).files.read(path);
  }
  async write(path: string, data: Uint8Array) {
    if (!(await (await this.snapshot()).publish(new Map([[path, data]]))))
      throw new Error('Remote version conflict');
  }
  async delete(path: string) {
    if (!(await (await this.snapshot()).publish(new Map([[path, null]]))))
      throw new Error('Remote version conflict');
  }
}
