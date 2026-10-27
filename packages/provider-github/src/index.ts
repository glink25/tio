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
export class GitHubProvider implements FileStorageProvider {
  private blobs = new Map<string, Uint8Array>();
  constructor(
    readonly client: GitHubClient,
    readonly endpoint: GitHubEndpoint,
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
        const cached = this.blobs.get(sha);
        if (cached) return cached.slice();
        const blob = await this.client.request<{ content: string; encoding: string }>(
          `${this.root}/git/blobs/${sha}`,
        );
        if (blob.encoding !== 'base64') throw new Error('Unsupported GitHub blob encoding');
        const bytes = Uint8Array.from(atob(blob.content.replace(/\s/g, '')), (c) =>
          c.charCodeAt(0),
        );
        if (bytes.length <= 512 * 1024) {
          this.blobs.set(sha, bytes);
          if (this.blobs.size > 256) this.blobs.delete(this.blobs.keys().next().value!);
        }
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
        for (const [path, bytes] of changes) {
          const blob =
            bytes === null
              ? null
              : await this.client.request<{ sha: string }>(`${this.root}/git/blobs`, {
                  content: base64(bytes),
                  encoding: 'base64',
                });
          updates.push({ path, mode: '100644', type: 'blob', sha: blob?.sha ?? null });
        }
        const nextTree = await this.client.request<{ sha: string }>(`${this.root}/git/trees`, {
          base_tree: commit.tree.sha,
          tree: updates,
        });
        const next = await this.client.request<{ sha: string }>(`${this.root}/git/commits`, {
          message: 'tio: synchronize workspace',
          tree: nextTree.sha,
          parents: [head],
        });
        try {
          await this.client.request(
            `${this.root}/git/refs/heads/${encodeURIComponent(this.endpoint.branch)}`,
            { sha: next.sha, force: false },
            'PATCH',
          );
          return true;
        } catch (error) {
          const current = await this.client.request<{ object: { sha: string } }>(
            `${this.root}/git/ref/heads/${encodeURIComponent(this.endpoint.branch)}`,
          );
          if (current.object.sha === next.sha) return true;
          const comparison = await this.client.request<{ status: string }>(
            `${this.root}/compare/${next.sha}...${current.object.sha}`,
          );
          if (comparison.status === 'ahead' || comparison.status === 'identical') return true;
          if (current.object.sha !== head) return false;
          throw error;
        }
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
