import { beforeEach, afterEach, it, expect, vi } from 'vitest';

import { handleRequest } from '../apps/auth/src/index';
import { decryptState } from '../apps/auth/src/state';
const env = {
  GITHUB_CLIENT_ID: 'id',
  GITHUB_CLIENT_SECRET: 'secret',
  GITHUB_APP_SLUG: 'tio',
  STATE_SECRET: 'state-secret',
  REDIRECT_URI_ALLOWLIST: 'https://tio.example/',
  FRONTEND_ORIGIN: 'https://tio.example',
};
const encode = (bytes: Uint8Array) => Buffer.from(bytes).toString('base64url');
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});
it('completes OAuth + installation + PKCE exchange without server storage', async () => {
  const verifier = encode(crypto.getRandomValues(new Uint8Array(32)));
  const state = encode(crypto.getRandomValues(new Uint8Array(32)));
  const challenge = encode(
    new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))),
  );
  const login = new URL('https://auth.example/api/github/login');
  login.search = new URLSearchParams({
    redirect_uri: 'https://tio.example/',
    state,
    code_challenge: challenge,
  }).toString();
  const response = await handleRequest(new Request(login), env);
  const authorize = new URL(response.headers.get('Location')!);
  expect(authorize.searchParams.get('code_challenge_method')).toBe('S256');
  const githubState = authorize.searchParams.get('state')!;
  expect((await decryptState(githubState, env.STATE_SECRET)).client_state).toBe(state);
  let installed = false;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      if (url.includes('access_token'))
        return Response.json({
          access_token: 'access',
          refresh_token: 'refresh',
          expires_in: 28800,
          refresh_token_expires_in: 15552000,
        });
      return Response.json({
        total_count: installed ? 1 : 0,
        installations: installed ? [{ id: 1 }] : [],
      });
    }),
  );
  const callback = await handleRequest(
    new Request(
      `https://auth.example/api/github/callback?code=github-code&state=${encodeURIComponent(githubState)}`,
    ),
    env,
  );
  const install = new URL(callback.headers.get('Location')!);
  expect(install.pathname).toBe('/apps/tio/installations/new');
  installed = true;
  const setup = await handleRequest(
    new Request(
      `https://auth.example/api/github/callback?installation_id=1&setup_action=install&state=${encodeURIComponent(install.searchParams.get('state')!)}`,
    ),
    env,
  );
  const destination = new URL(setup.headers.get('Location')!);
  expect(destination.origin).toBe('https://tio.example');
  expect(destination.search).not.toContain('access_token');
  const exchange = (value: string) =>
    handleRequest(
      new Request('https://auth.example/api/github/exchange', {
        method: 'POST',
        headers: { Origin: 'https://tio.example' },
        body: JSON.stringify({
          code: destination.searchParams.get('code'),
          state,
          code_verifier: value,
        }),
      }),
      env,
    );
  expect((await exchange('x'.repeat(43))).status).toBe(400);
  const result = await exchange(verifier);
  expect(result.status).toBe(200);
  expect(await result.json()).toMatchObject({ access_token: 'access', refresh_token: 'refresh' });
});
it('refresh distinguishes rejected grants, temporary upstream failures and malformed inputs', async () => {
  const request = (body: unknown) =>
    new Request('https://auth.example/api/github/refresh', {
      method: 'POST',
      headers: { Origin: 'https://tio.example' },
      body: JSON.stringify(body),
    });
  expect((await handleRequest(request({ refreshToken: 42 }), env)).status).toBe(400);
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => Response.json({ error: 'bad_refresh_token' })),
  );
  expect((await handleRequest(request({ refreshToken: 'r' }), env)).status).toBe(401);
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response('', { status: 503 })),
  );
  expect((await handleRequest(request({ refreshToken: 'r' }), env)).status).toBe(502);
});
function storage() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
  };
}
beforeEach(() => {
  vi.resetModules();
});
it('browser refresh coalesces requests and persists rotated tokens with millisecond deadlines', async () => {
  const local = storage();
  vi.stubGlobal('localStorage', local);
  vi.stubGlobal('sessionStorage', storage());
  vi.stubGlobal('navigator', {
    locks: { request: async (_name: string, work: () => Promise<string>) => work() },
  });
  vi.stubEnv('VITE_GITHUB_AUTH_URL', 'https://auth.example');
  local.setItem(
    'tio.github.credentials',
    JSON.stringify({
      userId: 1,
      login: 'user',
      mode: 'app',
      accessToken: 'old',
      refreshToken: 'r1',
      expiresAt: 1,
    }),
  );
  const fetcher = vi.fn(async () =>
    Response.json({
      access_token: 'next',
      refresh_token: 'r2',
      expires_in: 3600,
      refresh_token_expires_in: 7200,
    }),
  );
  vi.stubGlobal('fetch', fetcher);
  const { accessToken, credentials } = await import('../apps/web/src/services/github-auth');
  expect(await Promise.all([accessToken(), accessToken(), accessToken()])).toEqual([
    'next',
    'next',
    'next',
  ]);
  expect(fetcher).toHaveBeenCalledTimes(1);
  expect(credentials()?.refreshToken).toBe('r2');
  expect(credentials()!.expiresAt! - Date.now()).toBeGreaterThan(3599000);
});
it('disconnect during a refresh cannot restore deleted credentials', async () => {
  const local = storage();
  vi.stubGlobal('localStorage', local);
  vi.stubGlobal('sessionStorage', storage());
  vi.stubGlobal('navigator', {});
  vi.stubEnv('VITE_GITHUB_AUTH_URL', 'https://auth.example');
  local.setItem(
    'tio.github.credentials',
    JSON.stringify({ userId: 1, mode: 'app', accessToken: 'old', refreshToken: 'r', expiresAt: 1 }),
  );
  let release!: (response: Response) => void;
  vi.stubGlobal(
    'fetch',
    () =>
      new Promise<Response>((resolve) => {
        release = resolve;
      }),
  );
  const { accessToken, clearCredentials, credentials } =
    await import('../apps/web/src/services/github-auth');
  const result = accessToken();
  clearCredentials();
  release(Response.json({ access_token: 'new', refresh_token: 'new-r', expires_in: 3600 }));
  await expect(result).rejects.toThrow('connection changed');
  expect(credentials()).toBeUndefined();
});
