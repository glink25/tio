import { object } from '@tio/core';
import { exportZip, importZip } from '@tio/serialization';
import { zipSync, strToU8 } from 'fflate';
import { expect, it } from 'vitest';
it('rejects unknown archive versions and missing format instead of importing partially', async () => {
  await expect(importZip(zipSync({ 'data.json': strToU8('{}') }))).rejects.toThrow(
    'Missing archive format',
  );
  await expect(
    importZip(zipSync({ 'tio-export.json': strToU8('{"format":"tio","version":2}') })),
  ).rejects.toThrow('Unsupported archive format');
});
it('checks aggregate declared sizes before allocating decompressed content', async () => {
  const zip = zipSync({
    'tio-export.json': strToU8('{}'),
    a: strToU8('a'),
    b: strToU8('b'),
    c: strToU8('c'),
  });
  const view = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
  for (let i = 0; i < zip.length - 46; i++)
    if (view.getUint32(i, true) === 0x02014b50) view.setUint32(i + 24, 80 * 1024 * 1024, true);
  await expect(importZip(zip)).rejects.toThrow('Archive exceeds extraction limits');
});
it('exports and restores the single current logical format asynchronously', async () => {
  const workspace = object('workspace', 'w', { id: 'w', name: 'Portable' });
  const page = object('page', 'w', { id: 'p', blocks: [], extra: { keep: true } });
  expect(
    (await importZip(await exportZip([workspace, page], async () => undefined))).objects,
  ).toEqual([workspace, page]);
});
