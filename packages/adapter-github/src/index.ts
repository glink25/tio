import {
  ConnectionAccessError,
  type ConnectionAdapter,
  type ConnectionAccessState,
} from '@tio/core';
import {
  GitHubClient,
  GitHubError,
  GitHubProvider,
  type GitHubEndpoint,
  type GitHubRepository,
} from '@tio/provider-github';
export function eligibleRepository(repo: GitHubRepository) {
  return (
    repo.name.startsWith('tio-') ||
    repo.name.toLowerCase() === `${repo.owner.login}.github.io`.toLowerCase()
  );
}
export class GitHubRepositoryCreationError extends GitHubError {
  constructor() {
    super(
      403,
      'GitHub 拒绝创建仓库：请检查 Repository creation 写权限并接受安装权限更新，然后重新登录。',
    );
  }
}
export class GitHubAdapter implements ConnectionAdapter {
  readonly supportsSync = true;
  private listeners = new Set<(state: ConnectionAccessState) => void>();
  constructor(
    readonly connectionId: string,
    readonly userId: number,
    readonly client: GitHubClient,
    readonly mode: 'pat' | 'app' | (() => 'pat' | 'app'),
    readonly endpoints: Map<string, GitHubEndpoint>,
    readonly reauthorize?: () => Promise<'success' | 'cancelled'>,
  ) {}
  subscribe(listener: (state: ConnectionAccessState) => void) {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }
  classifyError(error: unknown): ConnectionAccessState {
    if (error instanceof ConnectionAccessError) return error.state;
    return {
      code:
        error instanceof GitHubError
          ? error.retryAt
            ? 'unreachable'
            : error.status === 401
              ? 'reauthorization-required'
              : [403, 404, 422].includes(error.status)
                ? 'forbidden'
                : 'unreachable'
          : 'unreachable',
      scope: { connectionId: this.connectionId },
      ...(error instanceof GitHubError && error.retryAt ? { retryAt: error.retryAt } : {}),
    };
  }
  async getAccessState(workspaceId?: string): Promise<ConnectionAccessState> {
    try {
      const me = await this.client.request<{ id: number }>('/user');
      if (me.id !== this.userId)
        return { code: 'reauthorization-required', scope: { connectionId: this.connectionId } };
      const endpoint = workspaceId && this.endpoints.get(workspaceId);
      if (endpoint) await this.client.request(`/repositories/${endpoint.repositoryId}`);
      return {
        code: 'available',
        scope: { connectionId: this.connectionId, ...(workspaceId ? { workspaceId } : {}) },
      };
    } catch (error) {
      return {
        ...this.classifyError(error),
        scope: { connectionId: this.connectionId, ...(workspaceId ? { workspaceId } : {}) },
      };
    }
  }
  workspaceLinks(workspaceId: string) {
    const endpoint = this.endpoints.get(workspaceId);
    if (!endpoint) throw new GitHubError(404, 'GitHub workspace is not bound');
    const repository = endpoint.fullName;
    const base = `https://github.com/${repository.split('/').map(encodeURIComponent).join('/')}`;
    return { repository, delete: base + '/settings', share: base + '/settings/access' };
  }
  async collaborators(workspaceId: string): Promise<import('@tio/core').MentionCandidate[]> {
    const endpoint = this.endpoints.get(workspaceId);
    if (!endpoint) throw new GitHubError(404, 'GitHub workspace is not bound');
    const users = await this.client.pages<{ id: number; login: string }>(
      `/repos/${endpoint.fullName.split('/').map(encodeURIComponent).join('/')}/collaborators?affiliation=all`,
    );
    return [...new Map(users.map((user) => [user.id, user])).values()]
      .sort((a, b) => a.login.localeCompare(b.login))
      .map((user) => ({
        reference: { workspaceId, kind: 'github-user', id: String(user.id), login: user.login },
        title: `@${user.login}`,
        description: endpoint.fullName,
      }));
  }
  async repositories() {
    let repos: GitHubRepository[];
    if ((typeof this.mode === 'function' ? this.mode() : this.mode) === 'app') {
      const installations = await this.client.pages<{ id: number }>(
        '/user/installations',
        'installations',
      );
      repos = (
        await Promise.all(
          installations.map((item) =>
            this.client.pages<GitHubRepository>(
              `/user/installations/${item.id}/repositories`,
              'repositories',
            ),
          ),
        )
      ).flat();
    } else repos = await this.client.pages<GitHubRepository>('/user/repos');
    return [...new Map(repos.filter(eligibleRepository).map((repo) => [repo.id, repo])).values()];
  }
  async discover() {
    const result: {
      repo: GitHubRepository;
      workspaceId?: string;
      endpoint?: GitHubEndpoint;
      problem?: string;
    }[] = [];
    for (const repo of await this.repositories()) {
      const existing = [...this.endpoints.values()].find((item) => item.repositoryId === repo.id);
      const endpoint = {
        repositoryId: repo.id,
        fullName: repo.full_name,
        branch: existing?.branch ?? repo.default_branch,
        workspaceId: '',
      };
      try {
        const files = await new GitHubProvider(this.client, endpoint).list('workspaces/');
        const ids = files.flatMap((file) => {
          const match = /^workspaces\/([\w-]+)\/objects\/\1\.json$/.exec(file.path);
          return match ? [match[1]] : [];
        });
        if (ids.length > 1) {
          result.push({ repo, problem: 'Multiple workspaces in one repository' });
          continue;
        }
        if (ids[0]) {
          const bound = this.endpoints.get(ids[0]);
          if (bound && bound.repositoryId !== repo.id) {
            result.push({
              repo,
              problem: 'Workspace identity is already bound to another repository',
            });
            continue;
          }
        }
        if (ids[0])
          result.push({
            repo,
            workspaceId: ids[0],
            endpoint: { ...endpoint, workspaceId: ids[0] },
          });
      } catch (error) {
        if (error instanceof GitHubError && !error.retryAt) {
          if (error.status === 409) continue;
          if ([403, 404, 422].includes(error.status)) {
            result.push({ repo, problem: error.message });
            continue;
          }
        }
        throw error;
      }
    }
    return result;
  }
  async create(workspaceId: string) {
    let repo: GitHubRepository;
    try {
      repo = await this.client.request<GitHubRepository>('/user/repos', {
        name: `tio-${workspaceId}`,
        private: true,
        auto_init: true,
      });
    } catch (error) {
      if (error instanceof GitHubError && error.status === 403 && !error.retryAt)
        throw new GitHubRepositoryCreationError();
      throw error;
    }
    const endpoint = {
      repositoryId: repo.id,
      fullName: repo.full_name,
      branch: repo.default_branch,
      workspaceId,
    };
    this.endpoints.set(workspaceId, endpoint);
    return endpoint;
  }
}
