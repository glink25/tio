import { GitHubClient, GitHubError } from '@tio/provider-github';
import { githubToken, tokens, type Credentials } from '@tio/provider-github/credentials';
export type { Credentials } from '@tio/provider-github/credentials';
import { platform } from '../platform';
const attemptKey = 'tio.github.login';
const attempts = () => platform().auth.attempts();
export const authOrigin = () => platform().auth.origin;
let generation = 0;
let credentialWrites: Promise<unknown> = Promise.resolve();
function storeCredentials(value?: Credentials) {
  const current = generation;
  const write = credentialWrites.then(() =>
    credentialLock(async () => {
      await platform().auth.persist(value);
      if (current === generation) platform().auth.remember(value);
    }),
  );
  credentialWrites = write.catch(() => {});
  return write;
}
export function credentials(): Credentials | undefined {
  return platform().auth.read();
}
export function clearCredentials() {
  generation++;
  platform().auth.remember(undefined);
  attempts().removeItem(attemptKey);
  return storeCredentials();
}
let refreshing: Promise<string> | undefined;
const credentialLock = <T>(work: () => Promise<T>) => platform().auth.lock(work);
export async function accessToken(): Promise<string> {
  const started = generation;
  const userId = credentials()?.userId;
  const work = async () => {
    await credentialWrites;
    return credentialLock(async () => {
      const token = await githubToken(userId, {
        read: () => platform().auth.readFresh(),
        write: async (next) => {
          await platform().auth.persist(next);
          if (started === generation) platform().auth.remember(next);
        },
        transport: (...args) => fetch(...args),
        authOrigin: authOrigin(),
      });
      if (started !== generation) throw new GitHubError(401, 'GitHub connection changed');
      return token;
    });
  };
  refreshing ??= work().finally(() => {
    refreshing = undefined;
  });
  return refreshing;
}
export async function connectToken(token: string, expectedUserId?: number) {
  const started = generation;
  const me = await new GitHubClient(async () => token).request<{
    id: number;
    login: string;
    avatar_url?: string;
  }>('/user');
  if (expectedUserId !== undefined && expectedUserId !== me.id)
    throw new Error('请使用原 GitHub 账号恢复连接');
  if (started !== generation) throw new Error('GitHub login was cancelled');
  const value: Credentials = {
    userId: me.id,
    login: me.login,
    avatarUrl: me.avatar_url,
    mode: 'pat',
    accessToken: token,
  };
  await storeCredentials(value);
  return value;
}
const encode = (bytes: Uint8Array) =>
  btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
export async function loginGitHub(expectedUserId?: number) {
  const origin = authOrigin();
  if (!origin) throw new Error('GitHub login is not configured');
  const verifier = encode(crypto.getRandomValues(new Uint8Array(32)));
  const state = encode(crypto.getRandomValues(new Uint8Array(32)));
  const challenge = encode(
    new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))),
  );
  attempts().setItem(
    attemptKey,
    JSON.stringify({ verifier, state, expectedUserId, expiresAt: Date.now() + 35 * 60000 }),
  );
  const url = new URL('/api/github/login', origin);
  url.search = new URLSearchParams({
    redirect_uri: platform().auth.redirectURI(),
    state,
    code_challenge: challenge,
  }).toString();
  await platform().auth.open(url.href);
}
export const nativeCallback = (input: string) => platform().auth.acceptsCallback(input);
export async function finishGitHubLogin(callback?: string) {
  if (callback && !nativeCallback(callback)) return false;
  const url = new URL(callback ?? location.href),
    code = url.searchParams.get('code'),
    state = url.searchParams.get('state');
  if (!code || !state) return false;
  const pending = attempts().getItem(attemptKey);
  if (!callback) history.replaceState(history.state, '', location.pathname + location.hash);
  const origin = authOrigin();
  if (!pending || !origin) throw new Error('GitHub login was cancelled');
  const attempt = JSON.parse(pending);
  if (attempt.state !== state || attempt.expiresAt < Date.now())
    throw new Error('GitHub login expired');
  const response = await fetch(`${origin}/api/github/exchange`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code, state, code_verifier: attempt.verifier }),
  });
  if (!response.ok) throw new Error('GitHub login exchange failed');
  const token = tokens(await response.json());
  const me = await new GitHubClient(async () => token.accessToken).request<{
    id: number;
    login: string;
    avatar_url?: string;
  }>('/user');
  if (attempts().getItem(attemptKey) !== pending) throw new Error('GitHub login was cancelled');
  if (attempt.expectedUserId !== undefined && attempt.expectedUserId !== me.id)
    throw new Error('请使用原 GitHub 账号恢复连接');
  await storeCredentials({
    ...token,
    userId: me.id,
    login: me.login,
    avatarUrl: me.avatar_url,
    mode: 'app',
  });
  attempts().removeItem(attemptKey);
  return true;
}
