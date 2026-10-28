import { object, validate } from '@tio/core';
import { decode, encode, exportZip, importZip } from '@tio/serialization';
import { expect, it } from 'vitest';

import { basePage } from '../../fixtures/objects';
it('round-trips structured icons and covers with opaque metadata', async () => {
  const page = {
    ...basePage(),
    icon: { type: 'image' as const, url: 'asset:photo', future: 1 },
    cover: {
      type: 'image' as const,
      url: 'asset:photo',
      positionY: 0.7,
      future: { retained: true },
    },
  };
  expect(decode(encode(page))).toEqual(page);
  const workspace = object('workspace', page.workspaceId, { id: page.workspaceId, name: 'Media' });
  const bytes = new Uint8Array([1, 2, 3]);
  const asset = object('asset', page.workspaceId, {
    id: 'photo',
    filename: 'photo.png',
    mime: 'image/png',
    byteSize: bytes.length,
    assetPath: 'assets/photo.png',
  });
  const backup = await importZip(await exportZip([workspace, page, asset], async () => bytes));
  expect(backup.objects.find((item) => item.id === page.id)).toEqual(page);
  expect(backup.assets.get('photo')).toEqual(bytes);
});
it('validates media variants, sources and crop positions without accepting temporary URLs', () => {
  for (const icon of [
    '🌿',
    '',
    { type: 'builtin', name: 'rocket' },
    { type: 'image', url: 'asset:a' },
  ])
    expect(() => validate({ ...basePage(), icon })).not.toThrow();
  for (const cover of [
    null,
    { type: 'preset', id: 'dawn' },
    {
      type: 'image',
      url: 'https://images.example/photo.png',
      positionY: 0.5,
      credit: { name: 'Photographer', url: 'https://example.com/author' },
    },
  ])
    expect(() => validate({ ...basePage(), cover })).not.toThrow();
  for (const icon of [
    { type: 'builtin', name: 'unknown' },
    { type: 'image', url: 'blob:temporary' },
    { type: 'image', url: 'javascript:alert(1)' },
  ])
    expect(() => validate({ ...basePage(), icon })).toThrow();
  for (const cover of [
    { type: 'preset', id: 'missing' },
    { type: 'image', url: 'asset:a', positionY: -1 },
    { type: 'image', url: 'asset:a', positionY: NaN },
    { type: 'image', url: 'data:image/png,abc', positionY: 0.5 },
  ])
    expect(() => validate({ ...basePage(), cover })).toThrow();
});
