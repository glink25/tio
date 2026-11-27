import { segments, StorageError, type FileStorageProvider } from '@tio/storage';

export class GiteeError extends Error {
  constructor(
    readonly status: number,
    readonly retryAt?: number,
  ) {
    super(`Gitee HTTP ${status}`);
  }
}

export interface GiteeEndpoint {
  repositoryId: number;
  fullName: string;
  branch: string;
  workspaceId: string;
}

export interface GiteeRepository {
  id: number;
  name: string;
  full_name: string;
  default_branch: string;
  owner: { login: string };
  permission?: { push?: boolean };
  archived?: boolean;
}

export const giteeEndpointsKey = (connection: string) => `tio.gitee.endpoints.${connection}`;
export const giteeRepoPath = (name: string) => segments(name).map(encodeURIComponent).join('/');

export class GiteeClient {
  private retryAt = 0;
  constructor(
    private token: () => Promise<string>,
    private transport: typeof fetch = (...args) => fetch(...args),
  ) {}

  async request<T>(
    path: string,
    body?: unknown,
    method = body === undefined ? 'GET' : 'POST',
  ): Promise<T> {
    if (this.retryAt > Date.now()) throw new GiteeError(429, this.retryAt);
    const response = await this.transport('https://gitee.com/api/v5' + path, {
      method,
      redirect: 'error',
      cache: 'no-store',
      headers: {
        Accept: 'application/json',
        Authorization: `token ${await this.token()}`,
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    if (!response.ok) {
      const retry = response.headers.get('retry-after');
      const reset = response.headers.get('x-ratelimit-reset');
      const limited =
        response.status === 429 || response.headers.get('x-ratelimit-remaining') === '0';
      const retryAt = retry
        ? /^\d+$/.test(retry)
          ? Date.now() + Number(retry) * 1000
          : Date.parse(retry)
        : limited && reset
          ? Number(reset) * 1000
          : 0;
      this.retryAt = retryAt > Date.now() ? retryAt : limited ? Date.now() + 60_000 : 0;
      throw new GiteeError(response.status, this.retryAt || undefined);
    }
    return response.status === 204 || method === 'DELETE'
      ? (undefined as T)
      : ((await response.json()) as T);
  }

  async pages<T>(path: string): Promise<T[]> {
    const result: T[] = [];
    for (let page = 1; ; page++) {
      const batch = await this.request<T[]>(`${path}?per_page=100&page=${page}`);
      result.push(...batch);
      if (batch.length < 100) return result;
    }
  }
}

interface Tree {
  tree: { path: string; type: string; sha: string }[];
  truncated?: boolean;
}

export interface GiteeBlobCache {
  getBlob(sha: string): Promise<Uint8Array | undefined>;
  putBlob(sha: string, bytes: Uint8Array): Promise<void>;
}

export class GiteeProvider implements FileStorageProvider {
  readonly attachmentPolicy = { maxFileBytes: 10 * 1024 * 1024, maxImageBytes: 10 * 1024 * 1024 };
  private listing?: ReturnType<GiteeProvider['files']>;
  private observed = new Map<string, string | null>();

  constructor(
    readonly client: GiteeClient,
    readonly endpoint: GiteeEndpoint,
    private cache?: GiteeBlobCache,
  ) {}

  get root() {
    return '/repos/' + giteeRepoPath(this.endpoint.fullName);
  }
  async repository() {
    const repo = await this.client.request<GiteeRepository>(this.root);
    if (repo.id !== this.endpoint.repositoryId) throw new GiteeError(404);
    return repo;
  }
  async canWrite() {
    const repo = await this.repository();
    return repo.permission?.push === true && !repo.archived;
  }
  private async files() {
    await this.repository();
    const branch = encodeURIComponent(this.endpoint.branch);
    const root = await this.client.request<Tree>(`${this.root}/git/trees/${branch}?recursive=1`);
    const files: { path: string; fingerprint: string }[] = [];
    const collect = async (tree: Tree, prefix: string, walk: boolean) => {
      if (tree.truncated) throw new StorageError('io', 'Gitee tree is incomplete');
      for (const entry of tree.tree) {
        const path = prefix + entry.path;
        if (entry.type === 'blob') files.push({ path, fingerprint: entry.sha });
        if (walk && entry.type === 'tree')
          await collect(
            await this.client.request<Tree>(`${this.root}/git/trees/${entry.sha}`),
            path + '/',
            true,
          );
      }
    };
    if (root.truncated)
      await collect(await this.client.request<Tree>(`${this.root}/git/trees/${branch}`), '', true);
    else await collect(root, '', false);
    return files;
  }
  async list(prefix: string) {
    this.listing ??= this.files().finally(() => {
      this.listing = undefined;
    });
    return (await this.listing).filter(({ path }) => path.startsWith(prefix));
  }
  private path(path: string) {
    if (!path.startsWith(`workspaces/${this.endpoint.workspaceId}/`))
      throw new StorageError('invalid', 'Gitee workspace mismatch');
    return `${this.root}/contents/${encodeURIComponent(segments(path).join('/'))}`;
  }
  private async current(path: string) {
    const url = this.path(path);
    await this.repository();
    try {
      const file = await this.client.request<{ sha?: string; type?: string }>(
        `${url}?ref=${encodeURIComponent(this.endpoint.branch)}`,
      );
      if (!file.sha || (file.type && file.type !== 'file'))
        throw new StorageError('invalid', 'Gitee contents response is not a file');
      return file.sha;
    } catch (error) {
      if (!(error instanceof GiteeError) || error.status !== 404 || error.retryAt) throw error;
      // A contents 404 alone cannot distinguish a missing file from a missing branch.
      return (await this.list(path)).find((file) => file.path === path)?.fingerprint ?? null;
    }
  }
  async read(path: string) {
    const sha = await this.current(path);
    this.observed.set(path, sha);
    if (!sha) return null;
    const cached = await this.cache?.getBlob(sha);
    if (cached) return cached.slice();
    const blob = await this.client.request<{ content: string; encoding: string }>(
      `${this.root}/git/blobs/${sha}`,
    );
    if (blob.encoding !== 'base64')
      throw new StorageError('invalid', 'Unsupported Gitee blob encoding');
    const data = Uint8Array.from(atob(blob.content.replace(/\s/g, '')), (char) =>
      char.charCodeAt(0),
    );
    await this.cache?.putBlob(sha, data);
    return data;
  }
  private async change(path: string, data?: Uint8Array) {
    const current = await this.current(path);
    const expected = this.observed.get(path);
    if (expected !== undefined && current !== expected) throw new GiteeError(409);
    const markers = (await this.list('workspaces/')).flatMap(
      ({ path }) => /^workspaces\/([\w-]+)\/objects\/\1\.json$/.exec(path)?.[1] ?? [],
    );
    if (markers.some((id) => id !== this.endpoint.workspaceId)) throw new GiteeError(422);
    if (!data && !current) return;
    let binary = '';
    if (data)
      for (let i = 0; i < data.length; i += 8192)
        binary += String.fromCharCode(...data.subarray(i, i + 8192));
    await this.client.request(
      this.path(path),
      {
        branch: this.endpoint.branch,
        message: 'tio: synchronize workspace',
        ...(current ? { sha: current } : {}),
        ...(data ? { content: btoa(binary) } : {}),
      },
      data ? (current ? 'PUT' : 'POST') : 'DELETE',
    );
    this.observed.delete(path);
  }
  write(path: string, data: Uint8Array) {
    return this.change(path, data);
  }
  delete(path: string) {
    return this.change(path);
  }
}
