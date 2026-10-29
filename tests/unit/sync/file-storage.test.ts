import { object, textBlock } from '@tio/core';
import { FileWorkspaceContent } from '@tio/file-storage';
import { MemoryProvider } from '@tio/provider-memory';
import { pathFor } from '@tio/serialization';
import { expect, it, vi } from 'vitest';

import { hash } from '../../../packages/file-storage/src/chunks';
const limit = 1024;
const setup = () => {
  const files = new MemoryProvider();
  return { files, content: new FileWorkspaceContent(files, 'w', { maxFileBytes: limit }) };
};

it('normalizes malformed stored content without swallowing transport errors', async () => {
  const { files, content } = setup();
  const path = 'workspaces/w/objects/w.json';
  for (const bytes of [
    new TextEncoder().encode('{broken'),
    new Uint8Array([0xff]),
    new TextEncoder().encode('null'),
    new TextEncoder().encode(
      JSON.stringify(object('workspace', 'w', { id: 'w', schemaVersion: 2 })),
    ),
  ]) {
    await files.write(path, bytes);
    await expect(content.read('w')).rejects.toMatchObject({
      code: 'invalid',
      cause: expect.any(Error),
    });
  }
  const chunk = new TextEncoder().encode('not-json');
  const root = await hash(chunk);
  await files.write(
    path,
    new TextEncoder().encode(
      JSON.stringify({ id: 'w', workspaceId: 'w', $storage: { version: 1, root } }),
    ),
  );
  await files.write(`workspaces/w/chunks/${root.slice(0, 2)}/${root}.json`, chunk);
  await expect(content.read('w')).rejects.toMatchObject({ code: 'invalid' });
  const read = files.read.bind(files);
  const failure = new TypeError('Network unavailable');
  vi.spyOn(files, 'read').mockImplementation((path) =>
    path.includes('/chunks/') ? Promise.reject(failure) : read(path),
  );
  await expect(content.read('w')).rejects.toBe(failure);
});
it('bounds JSON data and index files, preserving huge strings, Unicode and arbitrary subtrees', async () => {
  const { files, content } = setup();
  const page = object('page', 'w', {
    id: 'p',
    blocks: [textBlock('中文👨‍👩‍👧‍👦\\\"\n'.repeat(500))],
    extra: Object.fromEntries(
      Array.from({ length: 300 }, (_, i) => ['key' + i, { unknown: [i, true, null] }]),
    ),
  });
  await content.write(page);
  expect(files.files.size).toBeGreaterThan(20);
  expect([...files.files.values()].every((bytes) => bytes.length <= limit)).toBe(true);
  expect(await new FileWorkspaceContent(files, 'w', { maxFileBytes: limit }).read('p')).toEqual(
    page,
  );
});
it('publishes the head last, retains the previous object after a failed upload, and retries', async () => {
  const { files, content } = setup();
  const page = object('page', 'w', { id: 'p', blocks: [] });
  await content.write(page);
  const next = { ...page, blocks: Array.from({ length: 30 }, (_, i) => textBlock('Text ' + i)) };
  let writes = 0;
  files.beforeWrite = async () => {
    if (++writes === 4) throw new Error('network failure');
  };
  await expect(content.write(next)).rejects.toThrow('network failure');
  expect(await content.read('p')).toEqual(page);
  files.beforeWrite = undefined;
  await content.write(next);
  expect(await content.read('p')).toEqual(next);
  const paths: string[] = [];
  files.beforeWrite = async (path) => {
    paths.push(path);
  };
  await content.write(next);
  expect(paths).toEqual([pathFor(next)]);
});
it('a head write failure never exposes an incomplete generation', async () => {
  const { files, content } = setup();
  const page = object('page', 'w', { id: 'p', blocks: [] });
  await content.write(page);
  files.beforeWrite = async (path) => {
    if (path === pathFor(page)) throw new Error('head failure');
  };
  await expect(content.write({ ...page, blocks: [textBlock('new'.repeat(1000))] })).rejects.toThrow(
    'head failure',
  );
  expect(await content.read('p')).toEqual(page);
});
it('missing or corrupt chunks fail explicitly without falling back to stale content', async () => {
  const { files, content } = setup();
  await content.write(
    object('page', 'w', { id: 'p', blocks: [textBlock('content'.repeat(1000))] }),
  );
  const path = [...files.files.keys()].find((p) => p.includes('/chunks/'))!;
  const original = files.files.get(path)!;
  files.files.delete(path);
  await expect(content.read('p')).rejects.toThrow('Missing chunk');
  files.files.set(path, original.slice(0, -1));
  await expect(content.read('p')).rejects.toThrow('Invalid chunk');
});
it('reuses unchanged block chunks when editing a large document', async () => {
  const { files, content } = setup();
  const page = object('page', 'w', {
    id: 'p',
    blocks: Array.from({ length: 100 }, (_, i) => ({ ...textBlock('Text ' + i), id: 'b' + i })),
  });
  await content.write(page);
  const initial = files.files.size;
  page.blocks![50].content = [{ type: 'text', text: 'changed', styles: {} }];
  await content.write(page);
  expect(files.files.size - initial).toBeLessThan(initial / 4);
  expect(await content.read('p')).toEqual(page);
});

it('applies the file provider attachment policy to direct repository and content writes', async () => {
  const { FileRepository } = await import('@tio/file-storage');
  const files = new MemoryProvider();
  Object.assign(files.attachmentPolicy, { maxFileBytes: 8, maxImageBytes: 4 });
  const content = new FileWorkspaceContent(files, 'w');
  const repository = new FileRepository(content, 'w', {
    load: async () => undefined,
    save: async () => {},
  });
  const asset = object('asset', 'w', {
    id: 'asset',
    filename: 'a.bin',
    mime: 'application/octet-stream',
    byteSize: 8,
    assetPath: 'assets/a.bin',
  });
  expect(repository.attachmentPolicy).toEqual(files.attachmentPolicy);
  await repository.stageAsset('asset', {
    name: 'a.bin',
    mime: 'application/octet-stream',
    bytes: new Uint8Array(8),
  });
  await content.writeAsset(asset, new Uint8Array(8));
  await expect(
    repository.stageAsset('too-large', { name: 'a.bin', mime: '', bytes: new Uint8Array(9) }),
  ).rejects.toMatchObject({ code: 'asset-size', details: { maxBytes: 8 } });
  await expect(content.writeAsset(asset, new Uint8Array(9))).rejects.toMatchObject({
    code: 'asset-size',
    details: { maxBytes: 8 },
  });
});
