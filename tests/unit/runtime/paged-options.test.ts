import { describe, expect, it, vi } from 'vitest';

import { PagedOptions, type OptionsPage } from '../../../packages/ui/src/paged-options';

describe('paged choices', () => {
  it('appends stable identities, prevents concurrent loads and stops at the end', async () => {
    const publish = vi.fn();
    const pager = new PagedOptions<{ id: string; title?: string }>(
      (item) => item.id,
      publish,
      vi.fn(),
    );
    await pager.load(async () => ({ items: [{ id: 'a' }], next: 'next' }));
    let resolve!: (page: OptionsPage<{ id: string; title?: string }>) => void;
    const load = vi.fn(
      () =>
        new Promise<OptionsPage<{ id: string; title?: string }>>((done) => {
          resolve = done;
        }),
    );
    const pending = pager.load(load, true);
    await pager.load(load, true);
    expect(load).toHaveBeenCalledTimes(1);
    expect(load).toHaveBeenCalledWith('next');
    resolve({ items: [{ id: 'a', title: 'Updated' }, { id: 'b' }] });
    await pending;
    expect(publish.mock.lastCall?.[0]).toEqual({
      items: [{ id: 'a', title: 'Updated' }, { id: 'b' }],
      loading: false,
      failed: false,
      next: undefined,
    });
    await pager.load(load, true);
    expect(load).toHaveBeenCalledTimes(1);
  });
  it('ignores responses and errors from an old query generation', async () => {
    const publish = vi.fn(),
      error = vi.fn();
    const pager = new PagedOptions<string>((item) => item, publish, error);
    let resolve!: (page: OptionsPage<string>) => void;
    const pending = pager.load(
      () =>
        new Promise((done) => {
          resolve = done;
        }),
    );
    pager.reset();
    await pager.load(async () => ({ items: ['new'] }));
    resolve({ items: ['old'], sourceErrors: ['content'] });
    await pending;
    expect(publish.mock.lastCall?.[0].items).toEqual(['new']);
    expect(error).not.toHaveBeenCalled();
  });
  it('retains items after failure, notifies once and only resumes after reset', async () => {
    const publish = vi.fn(),
      error = vi.fn();
    const pager = new PagedOptions<string>((item) => item, publish, error);
    await pager.load(async () => ({ items: ['first'], next: 'next' }));
    const fail = vi.fn().mockRejectedValue(new Error('offline'));
    await pager.load(fail, true);
    await pager.load(fail, true);
    expect(error).toHaveBeenCalledTimes(1);
    expect(fail).toHaveBeenCalledTimes(1);
    expect(publish.mock.lastCall?.[0]).toMatchObject({
      items: ['first'],
      failed: true,
      loading: false,
    });
    pager.reset();
    await pager.load(async () => ({ items: ['reopened'] }));
    expect(publish.mock.lastCall?.[0].items).toEqual(['reopened']);
  });
  it('keeps partial source results and blocks further automatic requests', async () => {
    const publish = vi.fn(),
      error = vi.fn();
    const pager = new PagedOptions<string>((item) => item, publish, error);
    await pager.load(async () => ({ items: ['content'], next: 'next', sourceErrors: ['github'] }));
    expect(publish.mock.lastCall?.[0]).toEqual({
      items: ['content'],
      failed: true,
      loading: false,
      next: undefined,
    });
    expect(error).toHaveBeenCalledTimes(1);
  });
});
