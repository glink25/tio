import {
  ConnectionAccessError,
  type ConnectionAccessState,
  type ConnectionAdapter,
  type MentionCandidate,
} from '@tio/core';
import {
  GiteeError,
  GiteeProvider,
  giteeRepoPath,
  type GiteeClient,
  type GiteeEndpoint,
  type GiteeRepository,
} from '@tio/provider-gitee';

export function giteeAccessError(connectionId: string, error: unknown): ConnectionAccessState {
  if (error instanceof ConnectionAccessError) return error.state;
  const status = error instanceof GiteeError && !error.retryAt ? error.status : 0;
  return {
    code:
      status === 401
        ? 'reauthorization-required'
        : [403, 404, 422].includes(status)
          ? 'forbidden'
          : 'unreachable',
    scope: { connectionId },
    ...(error instanceof GiteeError && error.retryAt ? { retryAt: error.retryAt } : {}),
  };
}

export class GiteeAdapter implements ConnectionAdapter {
  readonly supportsSync = true;
  constructor(
    readonly connectionId: string,
    readonly userId: number,
    readonly client: GiteeClient,
    readonly endpoints: Map<string, GiteeEndpoint>,
    readonly reauthorize: () => Promise<'success' | 'cancelled'>,
  ) {}
  subscribe() {
    return () => {};
  }
  classifyError(error: unknown) {
    return giteeAccessError(this.connectionId, error);
  }
  async getAccessState(workspaceId?: string): Promise<ConnectionAccessState> {
    const scope = { connectionId: this.connectionId, workspaceId };
    try {
      const me = await this.client.request<{ id: number }>('/user');
      if (me.id !== this.userId) throw new GiteeError(401);
      const endpoint = workspaceId && this.endpoints.get(workspaceId);
      if (endpoint) await new GiteeProvider(this.client, endpoint).repository();
      return { code: 'available', scope };
    } catch (error) {
      const state = this.classifyError(error);
      return state.code === 'reauthorization-required' ? state : { ...state, scope };
    }
  }
  private endpoint(workspaceId: string) {
    const endpoint = this.endpoints.get(workspaceId);
    if (!endpoint) throw new GiteeError(404);
    return endpoint;
  }
  workspaceLinks(workspaceId: string) {
    const repository = this.endpoint(workspaceId).fullName;
    const url = 'https://gitee.com/' + giteeRepoPath(repository);
    return { repository, delete: url + '/settings#remove', share: url + '/team' };
  }
  async collaborators(workspaceId: string): Promise<MentionCandidate[]> {
    const endpoint = this.endpoint(workspaceId);
    const provider = new GiteeProvider(this.client, endpoint);
    await provider.repository();
    const users = await this.client.pages<{ id: number; login: string }>(
      provider.root + '/collaborators',
    );
    return [...new Map(users.map((user) => [user.id, user])).values()]
      .sort((a, b) => a.login.localeCompare(b.login))
      .map((user) => ({
        reference: { workspaceId, kind: 'gitee-user', id: String(user.id), login: user.login },
        title: `@${user.login}`,
        description: endpoint.fullName,
      }));
  }
  async discover() {
    const repos = await this.client.pages<GiteeRepository>('/user/repos');
    const found: {
      repo: GiteeRepository;
      workspaceId: string;
      endpoint: GiteeEndpoint;
      problem?: string;
    }[] = [];
    for (const repo of new Map(repos.map((repo) => [repo.id, repo])).values()) {
      const existing = [...this.endpoints.values()].find((item) => item.repositoryId === repo.id);
      if (
        !existing &&
        !repo.name.startsWith('tio-') &&
        repo.name.toLowerCase() !== `${repo.owner.login}.gitee.io`.toLowerCase()
      )
        continue;
      const endpoint = {
        repositoryId: repo.id,
        fullName: repo.full_name,
        branch: existing?.branch ?? repo.default_branch,
        workspaceId: '',
      };
      if (!endpoint.branch) continue;
      try {
        const files = await new GiteeProvider(this.client, endpoint).list('workspaces/');
        const ids = files.flatMap(
          ({ path }) => /^workspaces\/([\w-]+)\/objects\/\1\.json$/.exec(path)?.[1] ?? [],
        );
        if (ids.length !== 1) continue;
        const workspaceId = ids[0];
        if (existing && existing.workspaceId !== workspaceId) continue;
        found.push({ repo, workspaceId, endpoint: { ...endpoint, workspaceId } });
      } catch (error) {
        if (
          error instanceof GiteeError &&
          !error.retryAt &&
          [403, 404, 409, 422].includes(error.status)
        )
          continue;
        throw error;
      }
    }
    return found.filter(({ workspaceId, repo }) => {
      const bound = this.endpoints.get(workspaceId);
      return !bound || bound.repositoryId === repo.id;
    });
  }
  async create(workspaceId: string) {
    const repo = await this.client.request<GiteeRepository>('/user/repos', {
      name: `tio-${workspaceId}`,
      private: true,
      auto_init: true,
    });
    if (!repo.default_branch) throw new GiteeError(422);
    this.endpoints.set(workspaceId, {
      repositoryId: repo.id,
      fullName: repo.full_name,
      branch: repo.default_branch,
      workspaceId,
    });
  }
}
