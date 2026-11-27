import { GitHubError } from './index';

export type GitProvider = 'github' | 'gitee';
export const gitConnectionId = (provider: GitProvider, userId: number) => `${provider}-${userId}`;
export function gitConnection(connection?: string) {
  const match = /^(github|gitee)-([1-9][0-9]*)$/.exec(connection ?? '');
  if (!match || !Number.isSafeInteger(Number(match[2]))) return undefined;
  return { provider: match[1] as GitProvider, userId: Number(match[2]) };
}

export interface Credentials {
  provider: GitProvider;
  userId: number;
  login: string;
  avatarUrl?: string;
  mode: 'pat' | 'app';
  accessToken: string;
  refreshToken?: string;
  expiresAt?: number;
  refreshExpiresAt?: number;
}
export interface TokenPayload {
  access_token: string;
  refresh_token?: string;
  expires_in?: number;
  refresh_token_expires_in?: number;
}
export function tokens(payload: TokenPayload, now = Date.now()) {
  if (!payload.access_token) throw new GitHubError(401, 'Missing GitHub access token');
  return {
    accessToken: payload.access_token,
    refreshToken: payload.refresh_token,
    expiresAt: payload.expires_in === undefined ? undefined : now + payload.expires_in * 1000,
    refreshExpiresAt:
      payload.refresh_token_expires_in === undefined
        ? undefined
        : now + payload.refresh_token_expires_in * 1000,
  };
}

/** The caller holds the credential lock across load, refresh and save. */
export async function gitToken(
  provider: GitProvider,
  userId: number | undefined,
  host: {
    read(): Promise<Credentials | undefined>;
    write(value: Credentials): Promise<void>;
    transport: typeof fetch;
    authOrigin?: string;
    now?(): number;
  },
) {
  const saved = await host.read();
  if (saved?.provider !== provider || userId === undefined || saved.userId !== userId)
    throw new GitHubError(401, 'GitHub identity requires authorization');
  const now = host.now?.() ?? Date.now();
  if (
    !saved.expiresAt ||
    saved.expiresAt > now + (provider === 'github' ? 4 * 60 * 60 * 1000 : 5 * 60 * 1000)
  )
    return saved.accessToken;
  if (!saved.refreshToken || !host.authOrigin || (saved.refreshExpiresAt ?? Infinity) <= now)
    throw new GitHubError(401, 'GitHub identity requires authorization');
  const response = await host.transport(host.authOrigin + `/api/${provider}/refresh`, {
    method: 'POST',
    redirect: 'error',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ refreshToken: saved.refreshToken }),
  });
  if (!response.ok) throw new GitHubError(response.status, 'GitHub token refresh failed');
  const next = { ...saved, ...tokens(await response.json(), host.now?.() ?? Date.now()) };
  if (provider === 'gitee' && !next.refreshToken) {
    next.refreshToken = saved.refreshToken;
    next.refreshExpiresAt = saved.refreshExpiresAt;
  }
  const current = await host.read();
  if (
    current?.provider !== provider ||
    current.userId !== saved.userId ||
    current.refreshToken !== saved.refreshToken
  )
    throw new GitHubError(401, 'GitHub connection changed');
  await host.write(next);
  return next.accessToken;
}
