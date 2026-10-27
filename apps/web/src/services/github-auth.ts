import { GitHubClient, GitHubError } from '@tio/provider-github';
export interface Credentials {
  userId: number;
  login: string;
  mode: 'pat' | 'app';
  accessToken: string;
  refreshToken?: string;
  expiresAt?: number;
  refreshExpiresAt?: number;
}
interface TokenPayload {
  access_token: string;
  refresh_token?: string;
  expires_in?: number;
  refresh_token_expires_in?: number;
}
const key = 'tio.github.credentials';
const attemptKey = 'tio.github.login';
export const authOrigin = import.meta.env.VITE_GITHUB_AUTH_URL as string | undefined;
export function credentials(): Credentials | undefined {
  const value = localStorage.getItem(key);
  return value ? JSON.parse(value) : undefined;
}
export function clearCredentials() {
  localStorage.removeItem(key);
  sessionStorage.removeItem(attemptKey);
}
function tokens(payload: TokenPayload) {
  if (!payload.access_token) throw new Error('GitHub did not return an access token');
  return {
    accessToken: payload.access_token,
    refreshToken: payload.refresh_token,
    expiresAt:
      payload.expires_in === undefined ? undefined : Date.now() + payload.expires_in * 1000,
    refreshExpiresAt:
      payload.refresh_token_expires_in === undefined
        ? undefined
        : Date.now() + payload.refresh_token_expires_in * 1000,
  };
}
let refreshing: Promise<string> | undefined;
export async function accessToken(): Promise<string> {
  const work = async () => {
    const saved = credentials();
    if (!saved) throw new GitHubError(401, '请重新连接 GitHub');
    if (!saved.expiresAt || saved.expiresAt > Date.now() + 60000) return saved.accessToken;
    if (!saved.refreshToken || !authOrigin || (saved.refreshExpiresAt ?? Infinity) <= Date.now())
      throw new GitHubError(401, '请重新授权 GitHub');
    const response = await fetch(`${authOrigin}/api/github/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken: saved.refreshToken }),
    });
    if (!response.ok) throw new GitHubError(response.status, 'GitHub token refresh failed');
    const next = { ...saved, ...tokens(await response.json()) };
    if (credentials()?.refreshToken !== saved.refreshToken)
      throw new GitHubError(401, 'GitHub connection changed');
    localStorage.setItem(key, JSON.stringify(next));
    return next.accessToken;
  };
  refreshing ??= (
    navigator.locks ? navigator.locks.request('tio-github-refresh', work) : work()
  ).finally(() => {
    refreshing = undefined;
  });
  return refreshing;
}
export async function connectToken(token: string, expectedUserId?: number) {
  const me = await new GitHubClient(async () => token).request<{ id: number; login: string }>(
    '/user',
  );
  if (expectedUserId !== undefined && expectedUserId !== me.id)
    throw new Error('请使用原 GitHub 账号恢复连接');
  const value: Credentials = { userId: me.id, login: me.login, mode: 'pat', accessToken: token };
  localStorage.setItem(key, JSON.stringify(value));
  return value;
}
const encode = (bytes: Uint8Array) =>
  btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
export async function loginGitHub(expectedUserId?: number) {
  if (!authOrigin) throw new Error('GitHub login is not configured');
  const verifier = encode(crypto.getRandomValues(new Uint8Array(32)));
  const state = encode(crypto.getRandomValues(new Uint8Array(32)));
  const challenge = encode(
    new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))),
  );
  sessionStorage.setItem(
    attemptKey,
    JSON.stringify({ verifier, state, expectedUserId, expiresAt: Date.now() + 35 * 60000 }),
  );
  const url = new URL('/api/github/login', authOrigin);
  url.search = new URLSearchParams({
    redirect_uri: location.origin + location.pathname,
    state,
    code_challenge: challenge,
  }).toString();
  location.assign(url);
}
export async function finishGitHubLogin() {
  const url = new URL(location.href),
    code = url.searchParams.get('code'),
    state = url.searchParams.get('state');
  if (!code || !state) return false;
  const pending = sessionStorage.getItem(attemptKey);
  history.replaceState(history.state, '', location.pathname + location.hash);
  if (!pending || !authOrigin) throw new Error('GitHub login was cancelled');
  const attempt = JSON.parse(pending);
  if (attempt.state !== state || attempt.expiresAt < Date.now())
    throw new Error('GitHub login expired');
  const response = await fetch(`${authOrigin}/api/github/exchange`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code, state, code_verifier: attempt.verifier }),
  });
  if (!response.ok) throw new Error('GitHub login exchange failed');
  const token = tokens(await response.json());
  const me = await new GitHubClient(async () => token.accessToken).request<{
    id: number;
    login: string;
  }>('/user');
  if (sessionStorage.getItem(attemptKey) !== pending) throw new Error('GitHub login was cancelled');
  if (attempt.expectedUserId !== undefined && attempt.expectedUserId !== me.id)
    throw new Error('请使用原 GitHub 账号恢复连接');
  localStorage.setItem(
    key,
    JSON.stringify({ ...token, userId: me.id, login: me.login, mode: 'app' }),
  );
  sessionStorage.removeItem(attemptKey);
  return true;
}
