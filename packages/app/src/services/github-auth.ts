import { HostError } from '@tio/core';
import { GiteeClient } from '@tio/provider-gitee';
import { GitHubClient, GitHubError } from '@tio/provider-github';
import {
  gitToken,
  tokens,
  type Credentials,
  type GitProvider,
} from '@tio/provider-github/credentials';
export type { Credentials } from '@tio/provider-github/credentials';
import { platform } from '../platform';
const attemptKey = (provider: GitProvider) => `tio.${provider}.login`;
const client = (provider: GitProvider, token: string) =>
  provider === 'gitee' ? new GiteeClient(async () => token) : new GitHubClient(async () => token);
function validUser(id: number, login: string, expected?: number) {
  if (!Number.isSafeInteger(id) || id <= 0 || !login || (expected !== undefined && expected !== id))
    throw new GitHubError(401, 'Sign in with the original account');
}
const attempts = () => platform().auth.attempts();
export const authOrigin = () => platform().auth.origin;
let generation = 0;
let systemLoginPending = false;
let credentialWrites: Promise<unknown> = Promise.resolve();
function storeCredentials(value?: Credentials, guard?: () => void) {
  const current = generation;
  const write = credentialWrites.then(() =>
    credentialLock(async () => {
      guard?.();
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
  for (const provider of ['github', 'gitee'] as const) attempts().removeItem(attemptKey(provider));
  return storeCredentials();
}
let refreshing:
  | { provider: GitProvider; userId: number; generation: number; work: Promise<string> }
  | undefined;
const credentialLock = <T>(work: () => Promise<T>) => platform().auth.lock(work);
export async function accessToken(provider: GitProvider, userId: number): Promise<string> {
  const started = generation;
  const work = async () => {
    await credentialWrites;
    return credentialLock(async () => {
      const token = await gitToken(provider, userId, {
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
  if (
    refreshing?.provider !== provider ||
    refreshing.userId !== userId ||
    refreshing.generation !== started
  ) {
    const pending = work().finally(() => {
      if (refreshing?.work === pending) refreshing = undefined;
    });
    refreshing = { provider, userId, generation: started, work: pending };
  }
  return refreshing.work;
}
export async function connectToken(provider: GitProvider, token: string, expectedUserId?: number) {
  const started = ++generation;
  const me = await client(provider, token).request<{
    id: number;
    login: string;
    avatar_url?: string;
  }>('/user');
  validUser(me.id, me.login, expectedUserId);
  if (started !== generation) throw new Error('Sign-in was cancelled');
  const value: Credentials = {
    provider,
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
export async function loginGit(provider: GitProvider, expectedUserId?: number) {
  const origin = authOrigin();
  if (!origin) throw new Error('OAuth login is not configured');
  const verifier = encode(crypto.getRandomValues(new Uint8Array(32)));
  const state = encode(crypto.getRandomValues(new Uint8Array(32)));
  const challenge = encode(
    new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))),
  );
  const auth = platform().auth;
  if (auth.authenticate && systemLoginPending) throw new HostError('pending');
  const key = attemptKey(provider);
  attempts().setItem(
    key,
    JSON.stringify({ verifier, state, expectedUserId, expiresAt: Date.now() + 35 * 60000 }),
  );
  const pending = attempts().getItem(key);
  const url = new URL(`/api/${provider}/login`, origin);
  url.search = new URLSearchParams({
    redirect_uri: platform().auth.redirectURI(provider),
    state,
    code_challenge: challenge,
  }).toString();
  if (!auth.authenticate) {
    await auth.open(url.href);
    return 'pending' as const;
  }
  systemLoginPending = true;
  try {
    const callback = await auth.authenticate(url.href);
    if (attempts().getItem(key) !== pending || !callback) return 'cancelled' as const;
    if (nativeCallback(callback) !== provider) throw new Error('Invalid sign-in callback');
    const returned = new URL(callback);
    if (returned.searchParams.get('state') !== state) throw new Error('Invalid sign-in state');
    if (returned.searchParams.get('error') === 'access_denied') return 'cancelled' as const;
    if (!(await finishGitLogin(callback))) throw new Error('Sign-in failed');
    return 'success' as const;
  } finally {
    systemLoginPending = false;
    if (attempts().getItem(key) === pending) attempts().removeItem(key);
  }
}
export const nativeCallback = (input: string) =>
  (['github', 'gitee'] as const).find((provider) =>
    platform().auth.acceptsCallback(input, provider),
  );
export async function finishGitLogin(callback?: string) {
  const url = new URL(callback ?? location.href),
    code = url.searchParams.get('code'),
    state = url.searchParams.get('state');
  if (!code || !state) return false;
  const marker = url.searchParams.get('provider');
  const provider = callback
    ? nativeCallback(callback)
    : marker === 'gitee'
      ? 'gitee'
      : marker === null
        ? 'github'
        : undefined;
  if (!provider || (callback && (provider === 'gitee' ? marker !== 'gitee' : marker !== null)))
    return false;
  const key = attemptKey(provider);
  const pending = attempts().getItem(key);
  if (!callback) {
    for (const field of ['code', 'state', 'provider']) url.searchParams.delete(field);
    history.replaceState(history.state, '', url.pathname + url.search + url.hash);
  }
  const origin = authOrigin();
  if (!pending || !origin) throw new Error('Sign-in was cancelled');
  const attempt = JSON.parse(pending);
  if (attempt.state !== state || attempt.expiresAt < Date.now()) throw new Error('Sign-in expired');
  const response = await fetch(`${origin}/api/${provider}/exchange`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code, state, code_verifier: attempt.verifier }),
  });
  if (!response.ok) throw new Error('Sign-in exchange failed');
  const token = tokens(await response.json());
  const me = await client(provider, token.accessToken).request<{
    id: number;
    login: string;
    avatar_url?: string;
  }>('/user');
  const current = () => {
    if (attempts().getItem(key) !== pending || attempt.expiresAt < Date.now())
      throw new Error('Sign-in was cancelled');
  };
  current();
  validUser(me.id, me.login, attempt.expectedUserId);
  await storeCredentials(
    {
      ...token,
      provider,
      userId: me.id,
      login: me.login,
      avatarUrl: me.avatar_url,
      mode: 'app',
    },
    current,
  );
  if (attempts().getItem(key) === pending) attempts().removeItem(key);
  return provider;
}
