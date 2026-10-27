import { ConnectionAccessError, DomainError, HostError, assertAccess, object } from '@tio/core';
import { errorMessage, setLanguage } from '@tio/i18n';
import { StorageError } from '@tio/storage';
import { describe, it, expect, afterEach } from 'vitest';

import { statusModel, statusLabel } from '../apps/web/src/features/workspace/status';
import { syncIssue } from '../packages/sync/src/core';

afterEach(() => setLanguage('zh'));
describe('semantic status presentation', () => {
  it('never describes loading or failure as saved and keeps local actions meaningful', () => {
    expect(statusLabel(statusModel('loading', { phase: 'idle' }, false, false))).toBe('正在加载');
    expect(statusModel('loading', { phase: 'idle' }, false, false).visual).toBe('busy');
    expect(statusModel('saved', { phase: 'idle' }, false, false).action).toBe('none');
    expect(statusModel('saving', { phase: 'idle' }, false, false).visual).toBe('busy');
    expect(statusModel('error', { phase: 'idle' }, false, false).action).toBe('retry-save');
    expect(statusModel('saved', { phase: 'failed' }, true, false).visual).toBe('attention');
  });
  it('prioritizes saving failures, authorization, issues and synchronization independently of locale', () => {
    const sync = {
      phase: 'failed' as const,
      access: { code: 'reauthorization-required' as const, scope: { connectionId: 'c' } },
    };
    for (const locale of ['en', 'zh'] as const) {
      setLanguage(locale);
      expect(statusModel('error', sync, true, true).action).toBe('retry-save');
      expect(statusModel('saved', sync, true, true).action).toBe('reauthorize');
      expect(statusModel('saved', { phase: 'issues' }, true, true).action).toBe('issues');
      expect(statusModel('saved', { phase: 'synced' }, true, false).action).toBe('sync');
    }
  });
  it('formats structured progress only while synchronizing', () => {
    const progress = { loaded: 3, total: 10 };
    expect(
      statusLabel(statusModel('saved', { phase: 'syncing', progress }, true, false)),
    ).toContain('3/10');
    expect(
      statusLabel(statusModel('saved', { phase: 'synced', progress }, true, false)),
    ).not.toContain('3/10');
  });
});
describe('error identities', () => {
  it('localizes by code and never classifies diagnostic prose', () => {
    for (const locale of ['en', 'zh'] as const) {
      setLanguage(locale);
      for (const code of [
        'close-tabs',
        'asset-size',
        'identity',
        'future-version',
        'missing',
      ] as const)
        expect(errorMessage(new DomainError(code, 'changed wording'))).toBe(
          errorMessage(new DomainError(code, 'other wording')),
        );
      expect(errorMessage(new Error('reauthorization-required'))).not.toBe(
        errorMessage(
          new ConnectionAccessError({
            code: 'reauthorization-required',
            scope: { connectionId: 'c' },
          }),
        ),
      );
      expect(errorMessage(new Error('unknown'))).toContain('unknown');
    }
  });
  it('retains errors and distinguishes resource denial, missing objects and connection expiry', () => {
    const error = new HostError('permission', 'anything');
    expect(syncIssue('p', error, 'p')).toMatchObject({ code: 'permission', error, id: 'p' });
    expect(syncIssue('p', new StorageError('permission', 'changed'))).toMatchObject({
      code: 'permission',
    });
    expect(syncIssue('p', new DomainError('missing'))).toMatchObject({ code: 'missing' });
    expect(
      syncIssue(
        '',
        new ConnectionAccessError({
          code: 'reauthorization-required',
          scope: { connectionId: 'c' },
          retryAt: 123,
        }),
      ),
    ).toMatchObject({ code: 'connection', retryAt: 123 });
    expect(syncIssue('', new Error('permission'))).toMatchObject({ code: 'object' });
    expect(syncIssue('', null)).toMatchObject({ code: 'object', error: null });
  });
  it('emits a typed permission error from access policy enforcement', () => {
    expect(() =>
      assertAccess(
        { version: 'v', allows: () => false },
        undefined,
        object('page', 'w', { id: 'p' }),
      ),
    ).toThrow(HostError);
  });
});

it('normalizes browser permission failures at the provider boundary with their diagnostic cause', async () => {
  const { LocalFolderProvider } = await import('@tio/provider-local-folder');
  const { FolderConnectionAdapter } = await import('@tio/adapter-local-folder');
  const cause = new DOMException('any browser wording', 'NotAllowedError');
  const handle = {
    getFileHandle: async () => {
      throw cause;
    },
  } as unknown as FileSystemDirectoryHandle;
  const provider = new LocalFolderProvider(handle);
  const failure = await provider.read('page.json').catch((error: unknown) => error);
  expect(failure).toBeInstanceOf(StorageError);
  expect(failure).toMatchObject({ code: 'permission', cause });
  const state = new FolderConnectionAdapter('folder', handle).classifyError(failure);
  expect(state.code).toBe('reauthorization-required');
  const connection = new ConnectionAccessError(state, { cause: failure });
  expect(connection.cause).toBe(failure);
});
