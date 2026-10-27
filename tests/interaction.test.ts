import { LocalCatalog, LocalStore } from '@tio/local-store';
import { starterWorkspace } from '@tio/workspace';
import { expect, it, vi, afterEach } from 'vitest';

import { connectToken, clearCredentials } from '../apps/web/src/services/github-auth';
import { clearHostStorage } from '../apps/web/src/services/logout';

it('creates only a named workspace and one concise rich-text page in both languages', () => {
  for (const language of ['zh', 'en'] as const) {
    const objects = starterWorkspace('  Notes  ', language);
    expect(objects.map((o) => o.type)).toEqual(['workspace', 'page']);
    expect(objects[0].name).toBe('Notes');
    expect(objects[1].workspaceId).toBe(objects[0].id);
    expect(objects[1].blocks).toHaveLength(3);
    expect(objects[1].blocks?.[0].content).toEqual(
      expect.arrayContaining([expect.objectContaining({ styles: { bold: true } })]),
    );
    expect(JSON.stringify(objects)).not.toContain('recent');
  }
  expect(() => starterWorkspace('   ')).toThrow();
});

afterEach(() => vi.unstubAllGlobals());
function storage() {
  const values: Record<string, string> = {};
  Object.defineProperties(values, {
    setItem: {
      value: (key: string, value: string) => {
        values[key] = value;
      },
    },
    getItem: { value: (key: string) => values[key] ?? null },
    removeItem: {
      value: (key: string) => {
        delete values[key];
      },
    },
  });
  return values;
}
it('clears application storage while preserving unrelated origin storage', async () => {
  vi.stubGlobal('localStorage', storage());
  vi.stubGlobal('sessionStorage', storage());
  const catalog = new LocalCatalog();
  await catalog.setting('active', 'recent-space');
  const store = new LocalStore('test');
  await store.all();
  store.close();
  await catalog.close();
  localStorage.setItem('tio.github.credentials', 'secret');
  localStorage.setItem('tio.presentation', '{}');
  localStorage.setItem('unrelated', 'keep');
  sessionStorage.setItem('tio.github.login', '{}');
  await clearHostStorage();
  expect(localStorage.getItem('tio.github.credentials')).toBeNull();
  expect(sessionStorage.getItem('tio.github.login')).toBeNull();
  expect(localStorage.getItem('unrelated')).toBe('keep');
  const reopened = new LocalCatalog();
  expect(await reopened.setting('active')).toBeUndefined();
  expect(await reopened.sessions()).toEqual([]);
  await reopened.close();
});

it('does not restore credentials from a token validation response arriving after logout', async () => {
  vi.stubGlobal('localStorage', storage());
  vi.stubGlobal('sessionStorage', storage());
  let finish!: (response: Response) => void;
  vi.stubGlobal(
    'fetch',
    () =>
      new Promise<Response>((resolve) => {
        finish = resolve;
      }),
  );
  const login = connectToken('pending-token');
  await vi.waitFor(() => expect(finish).toBeDefined());
  clearCredentials();
  finish(Response.json({ id: 1, login: 'test', avatar_url: 'https://example.com/avatar.png' }));
  await expect(login).rejects.toThrow('GitHub login was cancelled');
  expect(localStorage.getItem('tio.github.credentials')).toBeNull();
});
